'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Fuel, List, LocateFixed, Search, X } from 'lucide-react';

import {
  searchLocation,
  searchLocations,
  type LocationSearchResult,
} from '@/app/actions/locations';
import {
  getStationDetails,
  getStationsInBounds,
  type StationBoundsInput,
  type StationDetailRecord,
  type StationMapRecord,
} from '@/app/actions/stations';
import NearbyStationsList from './NearbyStationsList';
import StationDrawer from './StationDrawer';

const MapComponent = dynamic(async () => (await import('./Map')).default, {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 z-0 flex h-dvh w-full items-center justify-center bg-gray-50">
      Loading map...
    </div>
  ),
});

interface ClientMapProps {
  initialStations: StationMapRecord[];
  totalStationCount: number;
  initialMatchingStationCount: number;
  initialIsCapped: boolean;
  stationLimit: number;
  initialSelectionMode: 'recent' | 'nearest' | 'spread';
}

type UserLocation = {
  lat: number;
  lng: number;
};

type ErrorBanner = {
  id: 'search' | 'geolocation' | 'station-load' | 'station-detail';
  title: string;
  message: string;
};

const FOCUS_REFRESH_COOLDOWN_MS = 60_000;
const LOCATION_SUGGESTION_DEBOUNCE_MS = 250;

function getGeolocationErrorMessage(error: GeolocationPositionError) {
  if (!window.isSecureContext) {
    return 'Location works only on HTTPS or http://localhost. Open the app on localhost and try again.';
  }

  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was denied.';
    case error.POSITION_UNAVAILABLE:
      return 'Your browser could not determine a position. Check system location services and try again.';
    case error.TIMEOUT:
      return 'Location request timed out. Try again once your device has a network or GPS fix.';
    default:
      return error.message || 'Could not determine your location.';
  }
}

export default function ClientMap({
  initialStations,
  totalStationCount,
  initialMatchingStationCount,
  initialIsCapped,
  stationLimit,
  initialSelectionMode,
}: ClientMapProps) {
  const router = useRouter();
  const [fuelType, setFuelType] = useState<'unleaded' | 'diesel'>('unleaded');
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationDetailRecord | null>(null);
  const [stations, setStations] = useState(initialStations);
  const [stationCatalogCount, setStationCatalogCount] = useState(totalStationCount);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [loadingStation, setLoadingStation] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [focusLocation, setFocusLocation] = useState<UserLocation | null>(null);
  const [focusedLocationLabel, setFocusedLocationLabel] = useState<string | null>(null);
  const [viewportCenter, setViewportCenter] = useState<UserLocation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSearchResult[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [locationSuggestionMessage, setLocationSuggestionMessage] = useState<string | null>(null);
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);
  const [isNearbyListOpen, setIsNearbyListOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [stationLoadError, setStationLoadError] = useState<string | null>(null);
  const [stationDetailError, setStationDetailError] = useState<string | null>(null);
  const [matchingStationCount, setMatchingStationCount] = useState(initialMatchingStationCount);
  const [isStationResultsCapped, setIsStationResultsCapped] = useState(
    initialIsCapped && initialMatchingStationCount !== totalStationCount,
  );
  const [stationSelectionMode, setStationSelectionMode] = useState(initialSelectionMode);
  const lastBoundsKeyRef = useRef<string | null>(null);
  const lastBoundsRef = useRef<StationBoundsInput | null>(null);
  const viewportRequestIdRef = useRef(0);
  const suggestionRequestIdRef = useRef(0);
  const blurHideSuggestionsTimeoutRef = useRef<number | null>(null);
  const hasAttemptedAutoLocateRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);

  const hasStations = stations.length > 0;
  const hasAnyStationData = stationCatalogCount > 0;
  const stationSummary = useMemo(() => {
    if (!hasAnyStationData) {
      return 'Station data will appear after the next scheduled sync';
    }

    if (matchingStationCount === 0) {
      return focusLocation
        ? 'No nearby stations in the current map area'
        : 'No stations in the current map area';
    }

    if (matchingStationCount > stations.length) {
      return `Showing ${stations.length} of ${matchingStationCount} stations in this area`;
    }

    if (matchingStationCount === stationCatalogCount) {
      return `Showing ${stations.length} of ${stationCatalogCount} stations`;
    }

    return `Showing ${stations.length} of ${matchingStationCount} stations in this area`;
  }, [focusLocation, hasAnyStationData, matchingStationCount, stationCatalogCount, stations.length]);

  const cappedStationsMessage = useMemo(() => {
    if (!isStationResultsCapped || loadingStations || matchingStationCount <= stations.length) {
      return null;
    }

    const visibleCount = Math.min(stationLimit, stations.length);

    if (stationSelectionMode === 'spread') {
      return `Showing a representative ${visibleCount} of ${matchingStationCount} stations in this area. Zoom in for more detail.`;
    }

    return `Showing the nearest ${visibleCount} of ${matchingStationCount} stations in this area. Zoom in for more detail.`;
  }, [
    isStationResultsCapped,
    loadingStations,
    matchingStationCount,
    stationLimit,
    stations.length,
    stationSelectionMode,
  ]);

  const errorBanners = useMemo<ErrorBanner[]>(() => {
    return [
      searchError
        ? { id: 'search', title: 'Search issue', message: searchError }
        : null,
      geolocationError
        ? { id: 'geolocation', title: 'Location issue', message: geolocationError }
        : null,
      stationLoadError
        ? { id: 'station-load', title: 'Map update issue', message: stationLoadError }
        : null,
      stationDetailError
        ? { id: 'station-detail', title: 'Station details issue', message: stationDetailError }
        : null,
    ].filter((banner): banner is ErrorBanner => banner !== null);
  }, [geolocationError, searchError, stationDetailError, stationLoadError]);

  const noViewportStationsMessage = useMemo(() => {
    if (!hasAnyStationData || loadingStations || matchingStationCount > 0 || focusLocation) {
      return null;
    }

    return 'No stations are visible in this map area. Pan or zoom out to load more stations.';
  }, [focusLocation, hasAnyStationData, loadingStations, matchingStationCount]);

  const mobileNearbyListPosition = hasStations
    ? isNearbyListOpen
      ? 'bottom-40 opacity-100'
      : 'pointer-events-none bottom-36 translate-y-2 opacity-0'
    : isNearbyListOpen
      ? 'bottom-24 opacity-100'
      : 'pointer-events-none bottom-20 translate-y-2 opacity-0';

  useEffect(() => {
    if (!viewportCenter) {
      setIsNearbyListOpen(false);
    }
  }, [viewportCenter]);

  useEffect(() => {
    setStations(initialStations);
    setMatchingStationCount(initialMatchingStationCount);
    setStationCatalogCount(totalStationCount);
    setIsStationResultsCapped(initialIsCapped && initialMatchingStationCount !== totalStationCount);
    setStationSelectionMode(initialSelectionMode);
  }, [
    initialIsCapped,
    initialMatchingStationCount,
    initialSelectionMode,
    initialStations,
    totalStationCount,
  ]);

  const handleStationSelect = useCallback(async (stationId: string) => {
    setActiveStationId(stationId);
    setLoadingStation(true);
    setStationDetailError(null);

    try {
      const station: StationDetailRecord | null = await getStationDetails(stationId);
      if (!station) {
        setActiveStationId(null);
        setSelectedStation(null);
        setIsDrawerOpen(false);
        setStationDetailError('Station details are unavailable right now.');
        return;
      }

      setSelectedStation(station);
      setIsDrawerOpen(true);
    } catch (error) {
      console.error('Failed to load station details', error);
      setActiveStationId(null);
      setStationDetailError('Could not load station details.');
    } finally {
      setLoadingStation(false);
    }
  }, []);

  const requestUserLocation = useCallback((options?: { silent?: boolean; enableHighAccuracy?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setGeolocationError('Geolocation is not supported by this browser.');
      }
      return;
    }

    // Prefer a coarse lookup first because mobile browsers can often resolve it
    // faster and more reliably than a GPS-grade fix.
    const isHighAccuracy = options?.enableHighAccuracy ?? false;

    // Only set loading state on the first attempt.
    if (!isHighAccuracy) {
      setIsLocating(true);
      if (!options?.silent) {
        setGeolocationError(null);
      }
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFocusLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setFocusedLocationLabel('Your location');
        setSearchQuery('');
        setLocationSuggestions([]);
        setLocationSuggestionMessage(null);
        setShowLocationSuggestions(false);
        setGeolocationError(null);
        setIsLocating(false);
      },
      (error) => {
        // If the coarse lookup fails, retry once with high accuracy.
        if (
          !isHighAccuracy &&
          (error.code === error.POSITION_UNAVAILABLE || error.code === error.TIMEOUT)
        ) {
          console.warn('Coarse geolocation failed, retrying with high accuracy...', error.message);
          requestUserLocation({ ...options, enableHighAccuracy: true });
          return;
        }

        const message = getGeolocationErrorMessage(error);

        console.warn('Geolocation lookup failed', {
          code: error.code,
          message: error.message,
          secureContext: window.isSecureContext,
        });

        if (!options?.silent) {
          setGeolocationError(message);
        }
        setIsLocating(false);
      },
      {
        enableHighAccuracy: isHighAccuracy,
        timeout: isHighAccuracy ? 15000 : 8000,
        maximumAge: isHighAccuracy ? 60000 : 300000,
      },
    );
  }, []);

  const handleLocateUser = () => {
    requestUserLocation();
  };

  const applyFocusLocation = useCallback((location: LocationSearchResult) => {
    setFocusLocation({
      lat: location.lat,
      lng: location.lng,
    });
    setFocusedLocationLabel(location.label);
    setSearchQuery(location.label);
    setLocationSuggestions([]);
    setLocationSuggestionMessage(null);
    setShowLocationSuggestions(false);
    setSearchError(null);
    setGeolocationError(null);
    setStationLoadError(null);
    setIsMobileSearchExpanded(false);
  }, []);

  const handleLocationSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery.length < 2) {
      setSearchError('Enter at least 2 characters to search.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const result = await searchLocation(trimmedQuery);

      if (result.error) {
        setSearchError(result.error);
        return;
      }

      if (!result.result) {
        setSearchError('No matching address, postcode, or area was found.');
        return;
      }

      applyFocusLocation(result.result);
    } catch (error) {
      console.error('Failed to search for a location', error);
      setSearchError('Location search is unavailable right now.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLocationSuggestionSelect = (location: LocationSearchResult) => {
    applyFocusLocation(location);
  };

  useEffect(() => {
    let isActive = true;

    if (hasAttemptedAutoLocateRef.current) {
      return () => {
        isActive = false;
      };
    }

    hasAttemptedAutoLocateRef.current = true;

    if (
      typeof navigator === 'undefined' ||
      !('geolocation' in navigator) ||
      !('permissions' in navigator)
    ) {
      return;
    }

    const permissions = navigator.permissions as Permissions;

    permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (isActive && status.state === 'granted') {
          requestUserLocation({ silent: true });
        }
      })
      .catch(() => {
        // Ignore unsupported permission-query implementations and keep manual location.
      });

    return () => {
      isActive = false;
    };
  }, [requestUserLocation]);

  useEffect(() => {
    return () => {
      if (blurHideSuggestionsTimeoutRef.current !== null) {
        window.clearTimeout(blurHideSuggestionsTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery.length < 2) {
      suggestionRequestIdRef.current += 1;
      setLocationSuggestions([]);
      setLocationSuggestionMessage(null);
      setIsLoadingSuggestions(false);
      return;
    }

    const requestId = ++suggestionRequestIdRef.current;
    const timeoutId = window.setTimeout(async () => {
      if (cancelled) {
        return;
      }

      setIsLoadingSuggestions(true);

      try {
        const result = await searchLocations(trimmedQuery);

        if (cancelled || requestId !== suggestionRequestIdRef.current) {
          return;
        }

        if (result.error) {
          setLocationSuggestions([]);
          setLocationSuggestionMessage(result.error);
          return;
        }

        const suggestions = result.results ?? [];
        setLocationSuggestions(suggestions);
        setLocationSuggestionMessage(
          suggestions.length === 0 ? 'No matching address, postcode, or area found.' : null,
        );
      } catch (error) {
        if (cancelled || requestId !== suggestionRequestIdRef.current) {
          return;
        }

        console.error('Failed to load location suggestions', error);
        setLocationSuggestions([]);
        setLocationSuggestionMessage('Location suggestions are unavailable right now.');
      } finally {
        if (!cancelled && requestId === suggestionRequestIdRef.current) {
          setIsLoadingSuggestions(false);
        }
      }
    }, LOCATION_SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  useEffect(() => {
    const maybeRefreshOnFocus = () => {
      if (document.visibilityState !== 'visible' || loadingStations) {
        return;
      }

      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < FOCUS_REFRESH_COOLDOWN_MS) {
        return;
      }

      lastAutoRefreshAtRef.current = now;

      const bounds = lastBoundsRef.current;
      if (!bounds) {
        router.refresh();
        return;
      }

      const requestId = ++viewportRequestIdRef.current;
      setLoadingStations(true);
      setStationLoadError(null);

      void getStationsInBounds(bounds)
        .then((result) => {
          if (requestId !== viewportRequestIdRef.current) {
            return;
          }

          setStations(result.stations);
          setStationCatalogCount(result.totalStationCount);
          setMatchingStationCount(result.matchingStationCount);
          setIsStationResultsCapped(result.isCapped);
          setStationSelectionMode(result.selectionMode);
        })
        .catch((error) => {
          if (requestId !== viewportRequestIdRef.current) {
            return;
          }

          console.error('Failed to refresh visible stations', error);
          setStationLoadError('Could not refresh stations after returning to the app.');
        })
        .finally(() => {
          if (requestId === viewportRequestIdRef.current) {
            setLoadingStations(false);
          }
        });
    };

    window.addEventListener('focus', maybeRefreshOnFocus);
    document.addEventListener('visibilitychange', maybeRefreshOnFocus);

    return () => {
      window.removeEventListener('focus', maybeRefreshOnFocus);
      document.removeEventListener('visibilitychange', maybeRefreshOnFocus);
    };
  }, [loadingStations, router]);

  const handleViewportChange = useCallback(async (bounds: StationBoundsInput) => {
    const boundsKey = [
      bounds.south.toFixed(4),
      bounds.west.toFixed(4),
      bounds.north.toFixed(4),
      bounds.east.toFixed(4),
    ].join(':');
    lastBoundsRef.current = bounds;
    setViewportCenter({
      lat: bounds.centerLat,
      lng: bounds.centerLng,
    });

    if (lastBoundsKeyRef.current === boundsKey) {
      return;
    }

    lastBoundsKeyRef.current = boundsKey;
    const requestId = ++viewportRequestIdRef.current;
    setLoadingStations(true);
    setStationLoadError(null);

    try {
      const result = await getStationsInBounds(bounds);
      if (requestId !== viewportRequestIdRef.current) {
        return;
      }

      setStations(result.stations);
      setStationCatalogCount(result.totalStationCount);
      setMatchingStationCount(result.matchingStationCount);
      setIsStationResultsCapped(result.isCapped);
      setStationSelectionMode(result.selectionMode);
    } catch (error) {
      if (requestId !== viewportRequestIdRef.current) {
        return;
      }

      console.error('Failed to load visible stations', error);
      setStationLoadError('Could not load stations for the current map view.');
    } finally {
      if (requestId === viewportRequestIdRef.current) {
        setLoadingStations(false);
      }
    }
  }, []);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-3 pb-4 pt-3 sm:p-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          <div className="pointer-events-auto rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-md p-3 shadow-lg sm:p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex w-full items-start justify-between gap-3 lg:w-auto lg:justify-start">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-blue-100 p-2">
                    <Fuel className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="font-bold text-gray-900">Pump Prices</h1>
                    <p className="text-sm text-gray-500">{stationSummary}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileSearchExpanded((prev) => !prev)}
                  className={`shrink-0 rounded-xl p-2.5 transition-colors sm:hidden ${
                    isMobileSearchExpanded
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  aria-label={isMobileSearchExpanded ? 'Close search' : 'Open search'}
                  aria-expanded={isMobileSearchExpanded}
                >
                  {isMobileSearchExpanded ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
                </button>
              </div>

              <div
                className={`w-full flex-col gap-2 lg:min-w-[26rem] lg:max-w-xl ${
                  isMobileSearchExpanded ? 'flex' : 'hidden sm:flex'
                }`}
              >
                <div className="relative">
                  <div className="flex w-full flex-col gap-2">
                    <div className="hidden w-full items-center gap-2 rounded-xl bg-gray-100 p-1 sm:flex">
                      <span className="pl-2 pr-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Fuel
                      </span>
                      <button
                        onClick={() => setFuelType('unleaded')}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                          fuelType === 'unleaded'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Unleaded
                      </button>
                      <button
                        onClick={() => setFuelType('diesel')}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                          fuelType === 'diesel'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Diesel
                      </button>
                    </div>

                    <form className="flex items-center gap-2" onSubmit={handleLocationSearch}>
                      <button
                        type="button"
                        onClick={handleLocateUser}
                        disabled={isLocating}
                        className="hidden shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
                        title="Use my location"
                      >
                        <LocateFixed className={`h-4 w-4 ${isLocating ? 'animate-pulse' : ''}`} />
                        <span>{isLocating ? 'Locating...' : 'My location'}</span>
                      </button>

                      <label className="sr-only" htmlFor="location-search">
                        Search for an address, postcode, or area
                      </label>
                      <input
                        id="location-search"
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onFocus={() => {
                          if (blurHideSuggestionsTimeoutRef.current !== null) {
                            window.clearTimeout(blurHideSuggestionsTimeoutRef.current);
                            blurHideSuggestionsTimeoutRef.current = null;
                          }
                          setShowLocationSuggestions(true);
                        }}
                        onBlur={() => {
                          blurHideSuggestionsTimeoutRef.current = window.setTimeout(() => {
                            setShowLocationSuggestions(false);
                          }, 120);
                        }}
                        placeholder="Search location"
                        autoComplete="street-address"
                        autoCapitalize="words"
                        spellCheck={false}
                        enterKeyHint="search"
                        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="submit"
                        disabled={isSearching}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Search className={`h-4 w-4 ${isSearching ? 'animate-pulse' : ''}`} />
                        <span>{isSearching ? 'Searching...' : 'Search'}</span>
                      </button>
                    </form>
                  </div>

                  {showLocationSuggestions && searchQuery.trim().length >= 2 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-gray-200 bg-white/80 backdrop-blur-md shadow-xl">
                      {isLoadingSuggestions ? (
                        <div className="px-4 py-3 text-sm text-gray-500">Searching places...</div>
                      ) : locationSuggestions.length > 0 ? (
                        <div className="max-h-72 overflow-y-auto py-1">
                          {locationSuggestions.map((suggestion) => (
                            <button
                              key={`${suggestion.lat}:${suggestion.lng}:${suggestion.label}`}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleLocationSuggestionSelect(suggestion)}
                              className="block w-full px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-blue-50 hover:text-gray-900"
                            >
                              <span className="line-clamp-2">{suggestion.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : locationSuggestionMessage ? (
                        <div className="px-4 py-3 text-sm text-gray-500">
                          {locationSuggestionMessage}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {focusedLocationLabel && (
                  <p className="truncate text-xs text-gray-500">
                    Focused on <span className="font-medium text-gray-700">{focusedLocationLabel}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {errorBanners.map((banner) => (
            <div
              key={banner.id}
              className="pointer-events-auto rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-700 shadow-lg backdrop-blur-md"
            >
              <span className="font-semibold text-red-800">{banner.title}:</span> {banner.message}
            </div>
          ))}

          {cappedStationsMessage && (
            <div className="pointer-events-auto rounded-2xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-800 shadow-lg backdrop-blur-md">
              {cappedStationsMessage}
            </div>
          )}
        </div>
      </div>

      <MapComponent
        stations={stations}
        fuelType={fuelType}
        focusLocation={focusLocation}
        selectedStationId={activeStationId}
        onStationSelect={handleStationSelect}
        onViewportChange={handleViewportChange}
      />

      <NearbyStationsList
        stations={stations}
        fuelType={fuelType}
        listOrigin={viewportCenter}
        loading={loadingStations}
        selectedStationId={activeStationId}
        onStationSelect={handleStationSelect}
        className={`absolute left-3 right-3 z-20 max-h-[36dvh] overflow-hidden transition-all duration-200 ${mobileNearbyListPosition} sm:left-6 sm:right-auto sm:w-full sm:max-w-sm sm:max-h-none sm:translate-y-0 ${
          isNearbyListOpen ? 'sm:bottom-6' : 'sm:bottom-2'
        }`}
      />

      {hasStations && (
        <div className="pointer-events-none absolute bottom-24 left-3 right-3 z-20 sm:hidden">
          <div className="pointer-events-auto rounded-2xl border border-gray-100 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Price Guide
              </h3>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-3 w-3 shrink-0 rounded-full bg-emerald-500"></div>
                  <span className="truncate text-xs font-medium text-gray-700">Cheapest 20%</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-3 w-3 shrink-0 rounded-full bg-amber-500"></div>
                  <span className="truncate text-xs font-medium text-gray-700">Average</span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-3 w-3 shrink-0 rounded-full bg-rose-500"></div>
                  <span className="truncate text-xs font-medium text-gray-700">Most Expensive</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Controls */}
      <div className="pointer-events-none absolute bottom-6 left-3 right-3 z-20 flex gap-3 sm:hidden">
        <div className="pointer-events-auto flex flex-1 items-center gap-1 rounded-2xl border border-gray-100 bg-white/80 p-1.5 shadow-lg backdrop-blur-md">
          <button
            onClick={() => setFuelType('unleaded')}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              fuelType === 'unleaded'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            Unleaded
          </button>
          <button
            onClick={() => setFuelType('diesel')}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              fuelType === 'diesel'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            Diesel
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsNearbyListOpen((prev) => !prev)}
          disabled={!viewportCenter}
          className={`pointer-events-auto flex shrink-0 items-center justify-center rounded-2xl border px-4 shadow-lg backdrop-blur-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isNearbyListOpen
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-gray-100 bg-white/80 text-gray-700 hover:bg-white/90'
          }`}
          title={
            viewportCenter
              ? isNearbyListOpen
                ? 'Hide nearby stations'
                : 'Show nearby stations'
              : 'Move the map to load nearby stations'
          }
          aria-pressed={isNearbyListOpen}
          aria-label={isNearbyListOpen ? 'Hide nearby stations' : 'Show nearby stations'}
        >
          <List className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleLocateUser}
          disabled={isLocating}
          className="pointer-events-auto flex shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white/80 px-4 shadow-lg backdrop-blur-md transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          title="Use my location"
        >
          <LocateFixed className={`h-5 w-5 text-gray-700 ${isLocating ? 'animate-pulse' : ''}`} />
        </button>
      </div>

      {viewportCenter && (
        <div className="pointer-events-none absolute bottom-6 left-6 z-20 hidden sm:block">
          <button
            type="button"
            onClick={() => setIsNearbyListOpen((prev) => !prev)}
            className={`pointer-events-auto inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-md transition-colors ${
              isNearbyListOpen
                ? 'border-blue-200 bg-blue-50/90 text-blue-700'
                : 'border-gray-100 bg-white/80 text-gray-700 hover:bg-white/90'
            }`}
            aria-pressed={isNearbyListOpen}
          >
            <List className="h-4 w-4" />
            <span>{isNearbyListOpen ? 'Hide nearby' : 'Show nearby'}</span>
          </button>
        </div>
      )}

      {hasStations && (
        <div className="pointer-events-auto absolute bottom-24 left-3 right-3 z-20 hidden sm:block sm:bottom-6 sm:left-auto sm:right-6">
          <div className="mx-auto flex w-full max-w-lg items-center gap-4 rounded-2xl border border-gray-100 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-md sm:mx-0 sm:w-auto sm:max-w-none">
            <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Price Guide
            </h3>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-3 w-3 shrink-0 rounded-full bg-emerald-500"></div>
                <span className="truncate text-xs font-medium text-gray-700 sm:text-sm">
                  Cheapest 20%
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-3 w-3 shrink-0 rounded-full bg-amber-500"></div>
                <span className="truncate text-xs font-medium text-gray-700 sm:text-sm">
                  Average
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-3 w-3 shrink-0 rounded-full bg-rose-500"></div>
                <span className="truncate text-xs font-medium text-gray-700 sm:text-sm">
                  Most Expensive
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasAnyStationData && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-100 bg-white/80 p-8 text-center shadow-2xl backdrop-blur-md">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <Fuel className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">No station data yet</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              Station data is imported automatically on a schedule. Once the next sync completes,
              prices and station history will appear here.
            </p>
          </div>
        </div>
      )}

      {noViewportStationsMessage && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-100 bg-white/90 p-6 text-center shadow-xl backdrop-blur-md">
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">No stations in view</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">{noViewportStationsMessage}</p>
          </div>
        </div>
      )}

      {loadingStation && (
        <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-gray-100 bg-white/80 px-5 py-3 text-sm font-medium text-gray-700 shadow-xl backdrop-blur-md transition-all">
          <div className="flex h-5 w-5 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
          <span>Loading details...</span>
        </div>
      )}

      {loadingStations && (
        <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-100 bg-white/80 px-5 py-3 text-sm font-medium text-gray-700 shadow-xl backdrop-blur-md transition-all">
          <div className="flex h-5 w-5 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
          <span>Updating map...</span>
        </div>
      )}

      <StationDrawer
        station={selectedStation}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setActiveStationId(null);
          setSelectedStation(null);
          setStationDetailError(null);
        }}
        fuelType={fuelType}
        focusLocation={focusLocation}
      />
    </div>
  );
}
