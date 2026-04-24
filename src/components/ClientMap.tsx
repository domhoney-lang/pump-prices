'use client';

/*
Changelog:
- Added best-nearby guidance, nearby-station sorting, and richer station detail insights.
- Split searched map focus from actual user location so the blue dot only represents geolocation.
- Unified price colors across the map, drawer, and nearby list, and improved mobile search behavior.
*/

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Fuel, Info, List, LocateFixed, Search, X } from 'lucide-react';
import { Area, AreaChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { Drawer } from 'vaul';

import {
  searchLocation,
  searchLocations,
  type LocationSearchResult,
} from '@/app/actions/locations';
import {
  type BestNearby,
  getStationDetails,
  getStationsInBounds,
  type NationalPriceBenchmark,
  type PriceBenchmark,
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
  initialPriceBenchmark?: PriceBenchmark | null;
  initialNationalPriceBenchmark?: NationalPriceBenchmark | null;
  initialBestNearby?: BestNearby | null;
}

type UserLocation = {
  lat: number;
  lng: number;
};

type MapFocusTarget = UserLocation & {
  zoom?: number;
};

type ErrorBanner = {
  id: 'search' | 'geolocation' | 'station-load' | 'station-detail';
  title: string;
  message: string;
};

type OverlayRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const FOCUS_REFRESH_COOLDOWN_MS = 60_000;
const LOCATION_SUGGESTION_DEBOUNCE_MS = 250;
const MAP_LOADING_MIN_VISIBLE_MS = 300;
const MAP_LOADING_SHOW_DELAY_MS = 150;
const MOBILE_PRICE_GUIDE_STORAGE_KEY = 'pump-prices:mobile-price-guide:v1';
const MOBILE_BOTTOM_CONTROLS_BOTTOM_PX = 24;
const MOBILE_OVERLAY_STACK_GAP_PX = 16;
const USER_LOCATION_ACTIVE_RADIUS_MILES = 0.25;
const USER_LOCATION_FOCUS_ZOOM = 13;
const priceGuideDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function areOverlayRectsEqual(left: OverlayRect[], right: OverlayRect[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((rect, index) => {
    const other = right[index];

    return (
      rect.left === other.left &&
      rect.top === other.top &&
      rect.right === other.right &&
      rect.bottom === other.bottom
    );
  });
}

function areMobileOverlayHeightsEqual(
  left: { bottomControls: number; priceGuide: number; bestNearby: number },
  right: { bottomControls: number; priceGuide: number; bestNearby: number },
) {
  return (
    left.bottomControls === right.bottomControls &&
    left.priceGuide === right.priceGuide &&
    left.bestNearby === right.bestNearby
  );
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMiles(origin: UserLocation, destination: UserLocation) {
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(destination.lat - origin.lat);
  const lngDelta = toRadians(destination.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getCompassDirection(origin: UserLocation, destination: UserLocation) {
  const latDelta = destination.lat - origin.lat;
  const lngDelta = destination.lng - origin.lng;
  const northSouth = latDelta >= 0 ? 'north' : 'south';
  const eastWest = lngDelta >= 0 ? 'east' : 'west';
  const latMagnitude = Math.abs(latDelta);
  const lngMagnitude = Math.abs(lngDelta);

  if (latMagnitude < 0.005) {
    return eastWest;
  }

  if (lngMagnitude < 0.005) {
    return northSouth;
  }

  return `${northSouth}-${eastWest}`;
}

function getDirectionArrow(direction: string) {
  switch (direction) {
    case 'north':
      return '↑';
    case 'north-east':
      return '↗';
    case 'east':
      return '→';
    case 'south-east':
      return '↘';
    case 'south':
      return '↓';
    case 'south-west':
      return '↙';
    case 'west':
      return '←';
    default:
      return '↖';
  }
}

function formatPriceGuideDate(date: string) {
  return priceGuideDateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

function renderLatestSparklineDot(
  latestPointDate: string,
  fuelType: 'unleaded' | 'diesel',
  props: {
    cx?: number;
    cy?: number;
    payload?: { date?: string };
  },
) {
  const { cx, cy, payload } = props;

  if (typeof cx !== 'number' || typeof cy !== 'number' || payload?.date !== latestPointDate) {
    return null;
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#dbeafe" />
      <circle cx={cx} cy={cy} r={3.25} fill={fuelType === 'diesel' ? '#1d4ed8' : '#2563eb'} />
      <circle cx={cx} cy={cy} r={1.75} fill="#ffffff" />
    </g>
  );
}

function PriceGuideSparkline({
  fuelType,
  nationalPriceBenchmark,
}: {
  fuelType: 'unleaded' | 'diesel';
  nationalPriceBenchmark: NationalPriceBenchmark | null;
}) {
  const history = nationalPriceBenchmark?.fuelHistory[fuelType] ?? [];
  const latestPoint = history.at(-1) ?? null;
  const firstPoint = history[0] ?? null;
  const historyPrices = history.map((point) => point.averagePrice);
  const historyMinPrice = historyPrices.length > 0 ? Math.min(...historyPrices) : null;
  const historyMaxPrice = historyPrices.length > 0 ? Math.max(...historyPrices) : null;
  const historySpread =
    historyMinPrice !== null && historyMaxPrice !== null
      ? Math.max(historyMaxPrice - historyMinPrice, 0.6)
      : null;
  const domainPadding = historySpread !== null ? Math.max(historySpread * 0.2, 0.15) : null;
  const yDomain =
    historyMinPrice !== null && historyMaxPrice !== null && domainPadding !== null
      ? [historyMinPrice - domainPadding, historyMaxPrice + domainPadding]
      : ['auto', 'auto'];
  const trendDelta =
    latestPoint && firstPoint ? latestPoint.averagePrice - firstPoint.averagePrice : null;
  const trendText =
    trendDelta === null
      ? null
      : Math.abs(trendDelta) < 0.05
        ? 'Flat over 30 days'
        : `${trendDelta > 0 ? 'Up' : 'Down'} ${Math.abs(trendDelta).toFixed(1)}p`;
  const trendBadgeClassName =
    trendDelta === null || Math.abs(trendDelta) < 0.05
      ? 'border-gray-200 bg-gray-50 text-gray-600'
      : trendDelta > 0
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  const lineStroke = fuelType === 'diesel' ? '#1d4ed8' : '#2563eb';

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            UK {fuelType}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
            {latestPoint ? `${latestPoint.averagePrice.toFixed(1)}p` : 'N/A'}
          </p>
          <p className="mt-1 text-xs text-gray-500">30-day average</p>
        </div>
        {trendText ? (
          <div
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${trendBadgeClassName}`}
          >
            {trendText}
          </div>
        ) : null}
      </div>

      {history.length > 0 ? (
        <>
          <div className="mt-3 h-20 w-full" aria-label={`30-day UK ${fuelType} average price trend`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
                <defs>
                  <linearGradient id={`price-guide-gradient-${fuelType}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineStroke} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={lineStroke} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={yDomain} />
                <Area
                  type="monotone"
                  dataKey="averagePrice"
                  stroke="none"
                  fill={`url(#price-guide-gradient-${fuelType})`}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="averagePrice"
                  stroke={lineStroke}
                  strokeWidth={2.75}
                  dot={(props) =>
                    latestPoint ? renderLatestSparklineDot(latestPoint.date, fuelType, props) : null
                  }
                  activeDot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <span>{formatPriceGuideDate(history[0].date)}</span>
            <span className="truncate font-medium">30-day UK daily avg</span>
            <span>{formatPriceGuideDate(history.at(-1)?.date ?? history[0].date)}</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-gray-500">UK trend data is unavailable right now.</p>
      )}
    </div>
  );
}

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
  initialPriceBenchmark = null,
  initialNationalPriceBenchmark = null,
  initialBestNearby = null,
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
  const [showMapLoadingIndicator, setShowMapLoadingIndicator] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [mapFocusLocation, setMapFocusLocation] = useState<MapFocusTarget | null>(null);
  const [mapFocusLabel, setMapFocusLabel] = useState<string | null>(null);
  const [viewportCenter, setViewportCenter] = useState<UserLocation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSearchResult[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [locationSuggestionMessage, setLocationSuggestionMessage] = useState<string | null>(null);
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);
  const [isMobilePriceGuideVisible, setIsMobilePriceGuideVisible] = useState(true);
  const [openBestNearbyKey, setOpenBestNearbyKey] = useState<string | null>(null);
  const [hasLoadedMobilePriceGuidePreference, setHasLoadedMobilePriceGuidePreference] =
    useState(false);
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
  const [priceBenchmark, setPriceBenchmark] = useState<PriceBenchmark | null>(initialPriceBenchmark);
  const [nationalPriceBenchmark, setNationalPriceBenchmark] = useState<NationalPriceBenchmark | null>(
    initialNationalPriceBenchmark,
  );
  const [bestNearby, setBestNearby] = useState<BestNearby | null>(initialBestNearby);
  const [bestNearbyIsObscured, setBestNearbyIsObscured] = useState(false);
  const [mapObstructionRects, setMapObstructionRects] = useState<OverlayRect[]>([]);
  const [mobileOverlayHeights, setMobileOverlayHeights] = useState({
    bottomControls: 0,
    priceGuide: 0,
    bestNearby: 0,
  });
  const lastBoundsKeyRef = useRef<string | null>(null);
  const lastBoundsRef = useRef<StationBoundsInput | null>(null);
  const viewportRequestIdRef = useRef(0);
  const suggestionRequestIdRef = useRef(0);
  const blurHideSuggestionsTimeoutRef = useRef<number | null>(null);
  const loadingIndicatorHideTimeoutRef = useRef<number | null>(null);
  const loadingIndicatorShowTimeoutRef = useRef<number | null>(null);
  const loadingIndicatorShownAtRef = useRef(0);
  const locationSearchInputRef = useRef<HTMLInputElement | null>(null);
  const hasAttemptedAutoLocateRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const desktopNearbyListRef = useRef<HTMLElement | null>(null);
  const mobileNearbySheetRef = useRef<HTMLDivElement | null>(null);
  const mobileBestNearbyRef = useRef<HTMLDivElement | null>(null);
  const mobilePriceGuideRef = useRef<HTMLDivElement | null>(null);
  const mobileBottomControlsRef = useRef<HTMLDivElement | null>(null);
  const desktopNearbyToggleRef = useRef<HTMLDivElement | null>(null);
  const desktopPriceGuideRef = useRef<HTMLDivElement | null>(null);

  const hasStations = stations.length > 0;
  const hasAnyStationData = stationCatalogCount > 0;
  const activeBestNearby = bestNearby?.[fuelType] ?? null;
  const bestNearbyNeedsAttention =
    activeBestNearby !== null && (!activeBestNearby.inViewport || bestNearbyIsObscured);
  const showOffscreenBestNearbyAlert =
    bestNearbyNeedsAttention && !loadingStations;
  const bestNearbyHiddenByChrome =
    activeBestNearby !== null && activeBestNearby.inViewport && bestNearbyIsObscured;
  const bestNearbyDirection =
    activeBestNearby && viewportCenter
      ? getCompassDirection(viewportCenter, {
          lat: activeBestNearby.lat,
          lng: activeBestNearby.lng,
        })
      : null;
  const currentBestNearbyKey = activeBestNearby ? `${fuelType}:${activeBestNearby.stationId}` : null;
  const isCurrentBestNearbyOpen =
    currentBestNearbyKey !== null && openBestNearbyKey === currentBestNearbyKey;
  const isFocusedOnUserLocation =
    userLocation !== null &&
    viewportCenter !== null &&
    mapFocusLabel === 'Your location' &&
    getDistanceMiles(userLocation, viewportCenter) <= USER_LOCATION_ACTIVE_RADIUS_MILES;
  const distanceReferenceLocation = userLocation ?? mapFocusLocation;
  const nearbyListOrigin = distanceReferenceLocation ?? viewportCenter;
  const nearbyListOriginLabel = userLocation
    ? 'your location'
    : mapFocusLocation
      ? 'the selected location'
      : 'the map center';
  const nearbyFuelSummary = priceBenchmark?.fuelSummaries[fuelType] ?? null;
  const nationalFuelSummary = nationalPriceBenchmark?.fuelSummaries[fuelType] ?? null;
  const stationSummary = useMemo<ReactNode>(() => {
    if (!hasAnyStationData) {
      return 'Station data will appear after the next scheduled sync';
    }

    if (matchingStationCount === 0) {
      return mapFocusLocation
        ? 'No nearby stations in the current map area'
        : 'No stations in the current map area';
    }

    const fuelLabel = fuelType === 'diesel' ? 'diesel' : 'unleaded';

    if (!nearbyFuelSummary || nearbyFuelSummary.averagePrice === null) {
      return `Local avg ${fuelLabel} is unavailable`;
    }

    const localSummaryText = `Local ${fuelLabel} avg ${nearbyFuelSummary.averagePrice.toFixed(1)}p (${nearbyFuelSummary.stationCount} nearby)`;

    if (!nationalFuelSummary || nationalFuelSummary.averagePrice === null) {
      return localSummaryText;
    }

    const nationalDifference = nearbyFuelSummary.averagePrice - nationalFuelSummary.averagePrice;

    if (Math.abs(nationalDifference) < 0.05) {
      return (
        <>
          <span className="block">{localSummaryText}</span>
          <span className="mt-1 inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            Matches UK average
          </span>
        </>
      );
    }

    const isAboveNationalAverage = nationalDifference > 0;
    const comparisonClassName = isAboveNationalAverage
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
    const comparisonArrow = isAboveNationalAverage ? '↑' : '↓';
    const comparisonText = `${comparisonArrow} ${Math.abs(nationalDifference).toFixed(1)}p ${
      isAboveNationalAverage ? 'above' : 'below'
    } UK average`;

    return (
      <>
        <span className="block">{localSummaryText}</span>
        <span
          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${comparisonClassName}`}
        >
          {comparisonText}
        </span>
      </>
    );
  }, [
    fuelType,
    hasAnyStationData,
    mapFocusLocation,
    matchingStationCount,
    nationalFuelSummary,
    nearbyFuelSummary,
  ]);

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
    if (!hasAnyStationData || loadingStations || matchingStationCount > 0 || mapFocusLocation) {
      return null;
    }

    return 'No stations are visible in this map area. Pan or zoom out to load more stations.';
  }, [hasAnyStationData, loadingStations, mapFocusLocation, matchingStationCount]);

  const showMobilePriceGuide = hasStations && isMobilePriceGuideVisible;
  const showMobileBestNearbyButton = activeBestNearby !== null && bestNearbyNeedsAttention;
  const showMobileBestNearbyCard = showMobileBestNearbyButton && isCurrentBestNearbyOpen;
  const showMobilePriceGuideCard = showMobilePriceGuide && !isNearbyListOpen;
  const showMobileBestNearbyNotice = showMobileBestNearbyCard && !isNearbyListOpen;
  const showMobileBottomControls = !isNearbyListOpen;
  const showDesktopBestNearbyButton = showOffscreenBestNearbyAlert;
  const showDesktopBestNearbyCard = showDesktopBestNearbyButton && isCurrentBestNearbyOpen;
  const mobilePriceGuideBottomPx =
    MOBILE_BOTTOM_CONTROLS_BOTTOM_PX +
    mobileOverlayHeights.bottomControls +
    MOBILE_OVERLAY_STACK_GAP_PX;
  const mobileBestNearbyBottomPx = showMobilePriceGuideCard
    ? mobilePriceGuideBottomPx +
      mobileOverlayHeights.priceGuide +
      MOBILE_OVERLAY_STACK_GAP_PX
    : MOBILE_BOTTOM_CONTROLS_BOTTOM_PX +
      mobileOverlayHeights.bottomControls +
      MOBILE_OVERLAY_STACK_GAP_PX;
  const mobilePriceGuideStyle = {
    '--mobile-price-guide-bottom': `${mobilePriceGuideBottomPx}px`,
  } as CSSProperties;
  const mobileBestNearbyStyle = {
    '--mobile-best-nearby-bottom': `${mobileBestNearbyBottomPx}px`,
  } as CSSProperties;

  const updateMobileOverlayHeights = useCallback(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 640) {
      setMobileOverlayHeights((currentHeights) =>
        areMobileOverlayHeightsEqual(currentHeights, {
          bottomControls: 0,
          priceGuide: 0,
          bestNearby: 0,
        })
          ? currentHeights
          : {
              bottomControls: 0,
              priceGuide: 0,
              bestNearby: 0,
            },
      );
      return;
    }

    const nextHeights = {
      bottomControls: Math.round(
        mobileBottomControlsRef.current?.getBoundingClientRect().height ?? 0,
      ),
      priceGuide:
        showMobilePriceGuideCard && mobilePriceGuideRef.current
          ? Math.round(mobilePriceGuideRef.current.getBoundingClientRect().height)
          : 0,
      bestNearby:
        showMobileBestNearbyNotice && mobileBestNearbyRef.current
          ? Math.round(mobileBestNearbyRef.current.getBoundingClientRect().height)
          : 0,
    };

    setMobileOverlayHeights((currentHeights) =>
      areMobileOverlayHeightsEqual(currentHeights, nextHeights)
        ? currentHeights
        : nextHeights,
    );
  }, [showMobileBestNearbyNotice, showMobilePriceGuideCard]);

  const updateMapObstructionRects = useCallback(() => {
    const mapContainer = mapContainerRef.current;

    if (!mapContainer || typeof window === 'undefined') {
      setMapObstructionRects([]);
      return;
    }

    const containerRect = mapContainer.getBoundingClientRect();
    const nextRects: OverlayRect[] = [];

    const addRect = (element: HTMLElement | null) => {
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();

      if (rect.width < 1 || rect.height < 1) {
        return;
      }

      const left = Math.max(0, rect.left - containerRect.left);
      const top = Math.max(0, rect.top - containerRect.top);
      const right = Math.min(containerRect.width, rect.right - containerRect.left);
      const bottom = Math.min(containerRect.height, rect.bottom - containerRect.top);

      if (right <= left || bottom <= top) {
        return;
      }

      nextRects.push({ left, top, right, bottom });
    };

    addRect(topChromeRef.current);

    const isDesktop = window.innerWidth >= 640;

    if (isDesktop) {
      if (viewportCenter) {
        addRect(desktopNearbyListRef.current);
        addRect(desktopNearbyToggleRef.current);
      }

      if (hasStations) {
        addRect(desktopPriceGuideRef.current);
      }
    } else {
      if (viewportCenter && isNearbyListOpen) {
        addRect(mobileNearbySheetRef.current);
      } else {
        if (showMobileBestNearbyNotice) {
          addRect(mobileBestNearbyRef.current);
        }

        if (showMobilePriceGuideCard) {
          addRect(mobilePriceGuideRef.current);
        }

        if (showMobileBottomControls) {
          addRect(mobileBottomControlsRef.current);
        }
      }
    }

    setMapObstructionRects((currentRects) =>
      areOverlayRectsEqual(currentRects, nextRects) ? currentRects : nextRects,
    );
  }, [
    hasStations,
    isNearbyListOpen,
    showMobileBestNearbyNotice,
    showMobileBottomControls,
    showMobilePriceGuideCard,
    viewportCenter,
  ]);

  useLayoutEffect(() => {
    updateMapObstructionRects();

    if (typeof window === 'undefined') {
      return;
    }

    const observedElements = [
      mapContainerRef.current,
      topChromeRef.current,
      desktopNearbyListRef.current,
      mobileNearbySheetRef.current,
      mobileBestNearbyRef.current,
      mobilePriceGuideRef.current,
      mobileBottomControlsRef.current,
      desktopNearbyToggleRef.current,
      desktopPriceGuideRef.current,
    ].filter((element): element is HTMLElement => element !== null);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateMapObstructionRects();
          });

    for (const element of observedElements) {
      resizeObserver?.observe(element);
    }

    window.addEventListener('resize', updateMapObstructionRects);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMapObstructionRects);
    };
  }, [updateMapObstructionRects]);

  useLayoutEffect(() => {
    updateMobileOverlayHeights();

    if (typeof window === 'undefined') {
      return;
    }

    const observedElements = [
      mobileBestNearbyRef.current,
      mobilePriceGuideRef.current,
      mobileBottomControlsRef.current,
    ].filter((element): element is HTMLDivElement => element !== null);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateMobileOverlayHeights();
          });

    for (const element of observedElements) {
      resizeObserver?.observe(element);
    }

    window.addEventListener('resize', updateMobileOverlayHeights);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMobileOverlayHeights);
    };
  }, [updateMobileOverlayHeights]);

  useEffect(() => {
    if (!viewportCenter) {
      setIsNearbyListOpen(false);
    }
  }, [viewportCenter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (loadingStations) {
      if (loadingIndicatorHideTimeoutRef.current !== null) {
        window.clearTimeout(loadingIndicatorHideTimeoutRef.current);
        loadingIndicatorHideTimeoutRef.current = null;
      }

      if (!showMapLoadingIndicator && loadingIndicatorShowTimeoutRef.current === null) {
        loadingIndicatorShowTimeoutRef.current = window.setTimeout(() => {
          loadingIndicatorShownAtRef.current = Date.now();
          setShowMapLoadingIndicator(true);
          loadingIndicatorShowTimeoutRef.current = null;
        }, MAP_LOADING_SHOW_DELAY_MS);
      }

      return;
    }

    if (loadingIndicatorShowTimeoutRef.current !== null) {
      window.clearTimeout(loadingIndicatorShowTimeoutRef.current);
      loadingIndicatorShowTimeoutRef.current = null;
    }

    if (!showMapLoadingIndicator) {
      return;
    }

    const elapsed = Date.now() - loadingIndicatorShownAtRef.current;
    const remaining = Math.max(0, MAP_LOADING_MIN_VISIBLE_MS - elapsed);

    loadingIndicatorHideTimeoutRef.current = window.setTimeout(() => {
      setShowMapLoadingIndicator(false);
      loadingIndicatorHideTimeoutRef.current = null;
    }, remaining);

    return () => {
      if (loadingIndicatorHideTimeoutRef.current !== null) {
        window.clearTimeout(loadingIndicatorHideTimeoutRef.current);
        loadingIndicatorHideTimeoutRef.current = null;
      }
    };
  }, [loadingStations, showMapLoadingIndicator]);

  useEffect(() => {
    return () => {
      if (loadingIndicatorShowTimeoutRef.current !== null) {
        window.clearTimeout(loadingIndicatorShowTimeoutRef.current);
      }

      if (loadingIndicatorHideTimeoutRef.current !== null) {
        window.clearTimeout(loadingIndicatorHideTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      setIsMobilePriceGuideVisible(
        window.localStorage.getItem(MOBILE_PRICE_GUIDE_STORAGE_KEY) !== 'hidden',
      );
    } catch {
      setIsMobilePriceGuideVisible(true);
    } finally {
      setHasLoadedMobilePriceGuidePreference(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedMobilePriceGuidePreference || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(
        MOBILE_PRICE_GUIDE_STORAGE_KEY,
        isMobilePriceGuideVisible ? 'visible' : 'hidden',
      );
    } catch {
      // Ignore storage access issues and keep the in-memory preference.
    }
  }, [hasLoadedMobilePriceGuidePreference, isMobilePriceGuideVisible]);

  useEffect(() => {
    if (!activeBestNearby) {
      setBestNearbyIsObscured(false);
    }
  }, [activeBestNearby]);

  useEffect(() => {
    if (!currentBestNearbyKey || !bestNearbyNeedsAttention) {
      setOpenBestNearbyKey(null);
      return;
    }

    if (openBestNearbyKey !== null && openBestNearbyKey !== currentBestNearbyKey) {
      setOpenBestNearbyKey(null);
    }
  }, [bestNearbyNeedsAttention, currentBestNearbyKey, openBestNearbyKey]);

  useEffect(() => {
    setStations(initialStations);
    setMatchingStationCount(initialMatchingStationCount);
    setStationCatalogCount(totalStationCount);
    setIsStationResultsCapped(initialIsCapped && initialMatchingStationCount !== totalStationCount);
    setStationSelectionMode(initialSelectionMode);
    setPriceBenchmark(initialPriceBenchmark);
    setNationalPriceBenchmark(initialNationalPriceBenchmark);
    setBestNearby(initialBestNearby);
  }, [
    initialIsCapped,
    initialBestNearby,
    initialMatchingStationCount,
    initialNationalPriceBenchmark,
    initialPriceBenchmark,
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
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setUserLocation(location);
        setMapFocusLocation({ ...location, zoom: USER_LOCATION_FOCUS_ZOOM });
        setMapFocusLabel('Your location');
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
          requestUserLocation({ ...options, enableHighAccuracy: true });
          return;
        }

        const message = getGeolocationErrorMessage(error);

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
    setMapFocusLocation({
      lat: location.lat,
      lng: location.lng,
      zoom: undefined,
    });
    setMapFocusLabel(location.label);
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
    if (!isMobileSearchExpanded) {
      return;
    }

    const focusInput = window.setTimeout(() => {
      locationSearchInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusInput);
    };
  }, [isMobileSearchExpanded]);

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

      void getStationsInBounds(bounds, {
        includeNationalBenchmark: true,
      })
        .then((result) => {
          if (requestId !== viewportRequestIdRef.current) {
            return;
          }

          setStations(result.stations);
          setStationCatalogCount(result.totalStationCount);
          setMatchingStationCount(result.matchingStationCount);
          setIsStationResultsCapped(result.isCapped);
          setStationSelectionMode(result.selectionMode);
          if (result.priceBenchmark) {
            setPriceBenchmark(result.priceBenchmark);
          }
          if (result.bestNearby) {
            setBestNearby(result.bestNearby);
          }
          if (result.nationalPriceBenchmark !== undefined) {
            setNationalPriceBenchmark(result.nationalPriceBenchmark);
          }
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
      const result = await getStationsInBounds(bounds, {
        includeNearbyBenchmark: true,
        includeNationalBenchmark: true,
      });
      if (requestId !== viewportRequestIdRef.current) {
        return;
      }

      setStations(result.stations);
      setStationCatalogCount(result.totalStationCount);
      setMatchingStationCount(result.matchingStationCount);
      setIsStationResultsCapped(result.isCapped);
      setStationSelectionMode(result.selectionMode);
      if (result.priceBenchmark) {
        setPriceBenchmark(result.priceBenchmark);
      }
      if (result.bestNearby) {
        setBestNearby(result.bestNearby);
      }
      if (result.nationalPriceBenchmark !== undefined) {
        setNationalPriceBenchmark(result.nationalPriceBenchmark);
      }
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

  const handleShowBestNearby = useCallback(() => {
    if (!activeBestNearby) {
      return;
    }

    setMapFocusLocation({
      lat: activeBestNearby.lat,
      lng: activeBestNearby.lng,
      zoom: 14,
    });
    setMapFocusLabel(`${activeBestNearby.brand || 'Nearby station'} (${fuelType})`);
    setOpenBestNearbyKey(null);
  }, [activeBestNearby, fuelType]);

  const handleCloseBestNearby = useCallback(() => {
    setOpenBestNearbyKey(null);
  }, []);

  const handleToggleBestNearby = useCallback(() => {
    if (!currentBestNearbyKey) {
      return;
    }

    setOpenBestNearbyKey((openKey) =>
      openKey === currentBestNearbyKey ? null : currentBestNearbyKey,
    );
  }, [currentBestNearbyKey]);

  const bestNearbySummary = activeBestNearby ? (
    <>
      Best nearby {fuelType} is <span className="font-semibold">{activeBestNearby.price.toFixed(1)}p</span>{' '}
      at <span className="font-semibold">{activeBestNearby.brand || 'Unknown Brand'}</span>,{' '}
      {activeBestNearby.distanceMiles < 10
        ? `${activeBestNearby.distanceMiles.toFixed(1)} mi away`
        : `${Math.round(activeBestNearby.distanceMiles)} mi away`}
      {bestNearbyHiddenByChrome ? (
        ', but it is tucked behind the map controls.'
      ) : bestNearbyDirection ? (
        <>
          , <span className="font-semibold">{getDirectionArrow(bestNearbyDirection)}</span> just{' '}
          {bestNearbyDirection} of this view.
        </>
      ) : (
        ', just outside this view.'
      )}
    </>
  ) : null;

  return (
    <div ref={mapContainerRef} className="relative h-full w-full">
      {showMapLoadingIndicator && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 sm:left-4 sm:right-4 sm:top-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/50 backdrop-blur-sm">
            <div className="h-full w-1/3 rounded-full bg-blue-600 animate-[map-loading_1.2s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-3 pb-4 pt-3 sm:p-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          <div ref={topChromeRef} className="flex flex-col gap-3">
            <div className="pointer-events-auto rounded-2xl border border-gray-100 bg-white/80 p-3 shadow-lg backdrop-blur-md sm:p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex w-full items-start justify-between gap-3 lg:w-auto lg:justify-start">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-blue-100 p-2">
                      <Fuel className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="font-bold text-gray-900">Pump Prices</h1>
                      <div className="mt-0.5 text-sm text-gray-500">{stationSummary}</div>
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
                  } ${showLocationSuggestions ? 'relative z-20' : ''}`}
                >
                  <div className="relative">
                    <div className="flex w-full flex-col gap-2">
                      <div className="hidden w-full items-center gap-2 rounded-xl bg-gray-100 p-1 sm:flex">
                        <span className="pl-2 pr-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Fuel
                        </span>
                        <button
                          onClick={() => setFuelType('unleaded')}
                          className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                            fuelType === 'unleaded'
                              ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-transparent text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Unleaded
                        </button>
                        <button
                          onClick={() => setFuelType('diesel')}
                          className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
                            fuelType === 'diesel'
                              ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-transparent text-gray-500 hover:text-gray-700'
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
                          className={`hidden shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex ${
                            isFocusedOnUserLocation || isLocating
                              ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                          title="Use my location"
                        >
                          <LocateFixed className={`h-4 w-4 ${isLocating ? 'animate-pulse' : ''}`} />
                          <span>{isLocating ? 'Locating...' : 'My location'}</span>
                        </button>

                        <label className="sr-only" htmlFor="location-search">
                          Search for an address, postcode, or area
                        </label>
                        <input
                          ref={locationSearchInputRef}
                          id="location-search"
                          type="search"
                          value={searchQuery}
                          onChange={(event) => {
                            if (blurHideSuggestionsTimeoutRef.current !== null) {
                              window.clearTimeout(blurHideSuggestionsTimeoutRef.current);
                              blurHideSuggestionsTimeoutRef.current = null;
                            }

                            setSearchQuery(event.target.value);
                            setShowLocationSuggestions(true);
                          }}
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
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-gray-200 bg-white/80 shadow-xl backdrop-blur-md">
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

                  {mapFocusLabel && (
                    <p className="truncate text-xs text-gray-500">
                      Focused on <span className="font-medium text-gray-700">{mapFocusLabel}</span>
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
      </div>

      <MapComponent
        stations={stations}
        fuelType={fuelType}
        priceBenchmark={priceBenchmark}
        mapFocusLocation={mapFocusLocation}
        userLocation={userLocation}
        selectedStationId={activeStationId}
        bestNearbyLocation={
          activeBestNearby
            ? {
                lat: activeBestNearby.lat,
                lng: activeBestNearby.lng,
              }
            : null
        }
        obstructionRects={mapObstructionRects}
        onStationSelect={handleStationSelect}
        onViewportChange={handleViewportChange}
        onBestNearbyVisibilityChange={setBestNearbyIsObscured}
      />

      <NearbyStationsList
        stations={stations}
        fuelType={fuelType}
        priceBenchmark={priceBenchmark}
        listOrigin={nearbyListOrigin}
        originLabel={nearbyListOriginLabel}
        loading={loadingStations}
        selectedStationId={activeStationId}
        onStationSelect={handleStationSelect}
        containerRef={desktopNearbyListRef}
        className={`pointer-events-none absolute bottom-6 left-6 z-20 hidden w-full max-w-sm overflow-hidden transition-all duration-200 sm:block ${
          isNearbyListOpen ? 'sm:pointer-events-auto sm:opacity-100' : 'sm:translate-y-2 sm:opacity-0'
        }`}
      />

      <Drawer.Root open={Boolean(viewportCenter) && isNearbyListOpen} onOpenChange={setIsNearbyListOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-30 bg-slate-950/18 backdrop-blur-[1px] sm:hidden" />
          <Drawer.Content
            ref={mobileNearbySheetRef}
            className="fixed inset-x-0 bottom-0 z-40 flex h-[60dvh] max-h-[78dvh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl outline-none sm:hidden"
          >
            <div className="border-b border-gray-100 px-5 pb-3 pt-3">
              <div className="relative flex items-center justify-center">
                <div className="h-1.5 w-12 rounded-full bg-gray-200" />
                <button
                  type="button"
                  onClick={() => setIsNearbyListOpen(false)}
                  className="absolute right-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
                  aria-label="Close nearby stations"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <NearbyStationsList
              stations={stations}
              fuelType={fuelType}
              priceBenchmark={priceBenchmark}
              listOrigin={nearbyListOrigin}
              originLabel={nearbyListOriginLabel}
              loading={loadingStations}
              selectedStationId={activeStationId}
              onStationSelect={(stationId) => {
                setIsNearbyListOpen(false);
                void handleStationSelect(stationId);
              }}
              variant="sheet"
              className="min-h-0 flex-1"
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {showMobileBestNearbyNotice && activeBestNearby && (
        <div
          ref={mobileBestNearbyRef}
          style={mobileBestNearbyStyle}
          className="pointer-events-none absolute bottom-[var(--mobile-best-nearby-bottom)] left-3 right-3 z-20 sm:hidden"
        >
          <div className="pointer-events-auto rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-lg backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                  Best Nearby
                </h3>
                <p className="mt-2">{bestNearbySummary}</p>
              </div>
              <button
                type="button"
                onClick={handleCloseBestNearby}
                className="rounded-full p-1 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                aria-label="Hide best nearby"
                title="Hide best nearby"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleShowBestNearby}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
            >
              Show on map
            </button>
          </div>
        </div>
      )}

      {showMobilePriceGuideCard && (
        <div
          ref={mobilePriceGuideRef}
          style={mobilePriceGuideStyle}
          className="pointer-events-none absolute bottom-[var(--mobile-price-guide-bottom)] left-3 right-3 z-20 sm:hidden"
        >
          <div className="pointer-events-auto rounded-2xl border border-gray-100 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Price Guide
              </h3>
              <button
                type="button"
                onClick={() => setIsMobilePriceGuideVisible(false)}
                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Hide price guide"
                title="Hide price guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="flex min-w-0 items-center justify-center gap-1.5 text-center">
                <div className="h-3 w-3 shrink-0 rounded-full bg-emerald-500"></div>
                <span className="text-xs font-medium leading-4 text-gray-700">Cheapest nearby</span>
              </div>
              <div className="flex min-w-0 items-center justify-center gap-1.5 text-center">
                <div className="h-3 w-3 shrink-0 rounded-full bg-amber-500"></div>
                <span className="text-xs font-medium leading-4 text-gray-700">Average</span>
              </div>
              <div className="flex min-w-0 items-center justify-center gap-1.5 text-center">
                <div className="h-3 w-3 shrink-0 rounded-full bg-rose-500"></div>
                <span className="text-xs font-medium leading-4 text-gray-700">Most Expensive</span>
              </div>
            </div>
            <PriceGuideSparkline
              fuelType={fuelType}
              nationalPriceBenchmark={nationalPriceBenchmark}
            />
          </div>
        </div>
      )}

      {/* Mobile Bottom Controls */}
      {showMobileBottomControls && (
        <div
          ref={mobileBottomControlsRef}
          className="pointer-events-none absolute bottom-6 left-3 right-3 z-20 flex gap-3 sm:hidden"
        >
          <div className="pointer-events-auto flex flex-1 items-center gap-1 rounded-2xl border border-gray-100 bg-white/80 p-1.5 shadow-lg backdrop-blur-md">
            <button
              onClick={() => setFuelType('unleaded')}
              className={`flex-1 rounded-xl border px-2.5 py-2 text-[13px] font-medium transition-colors ${
                fuelType === 'unleaded'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              Unleaded
            </button>
            <button
              onClick={() => setFuelType('diesel')}
              className={`flex-1 rounded-xl border px-2.5 py-2 text-[13px] font-medium transition-colors ${
                fuelType === 'diesel'
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              Diesel
            </button>
          </div>

          {showMobileBestNearbyButton && (
            <button
              type="button"
              onClick={handleToggleBestNearby}
              className={`pointer-events-auto flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl border px-4 shadow-lg backdrop-blur-md transition-colors ${
                bestNearbyNeedsAttention
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-gray-100 bg-white/80 text-gray-700 hover:bg-white/90'
              }`}
              title={showMobileBestNearbyCard ? 'Hide best nearby' : 'Show best nearby'}
              aria-pressed={showMobileBestNearbyCard}
              aria-expanded={showMobileBestNearbyCard}
              aria-label={showMobileBestNearbyCard ? 'Hide best nearby' : 'Show best nearby'}
            >
              <Fuel className="h-5 w-5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsMobilePriceGuideVisible((prev) => !prev)}
            className={`pointer-events-auto flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl border px-4 shadow-lg backdrop-blur-md transition-colors ${
              isMobilePriceGuideVisible
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-100 bg-white/80 text-gray-700 hover:bg-white/90'
            }`}
            title={isMobilePriceGuideVisible ? 'Hide price guide' : 'Show price guide'}
            aria-pressed={isMobilePriceGuideVisible}
            aria-label={isMobilePriceGuideVisible ? 'Hide price guide' : 'Show price guide'}
          >
            <Info className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setIsNearbyListOpen((prev) => !prev)}
            disabled={!viewportCenter}
            className={`pointer-events-auto flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl border px-4 shadow-lg backdrop-blur-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
            aria-expanded={isNearbyListOpen}
            aria-label={isNearbyListOpen ? 'Hide nearby stations' : 'Show nearby stations'}
          >
            <List className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleLocateUser}
            disabled={isLocating}
            className={`pointer-events-auto flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl border px-4 shadow-lg backdrop-blur-md transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isFocusedOnUserLocation || isLocating
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-100 bg-white/80 text-gray-700 hover:bg-white/90'
            }`}
            title="Use my location"
          >
            <LocateFixed className={`h-5 w-5 ${isLocating ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      )}

      {viewportCenter && (
        <div
          ref={desktopNearbyToggleRef}
          className="pointer-events-none absolute bottom-6 left-6 z-20 hidden sm:block"
        >
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
        <div
          ref={desktopPriceGuideRef}
          className="absolute bottom-24 left-3 right-3 z-20 hidden sm:flex sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:justify-end sm:gap-3"
        >
          {showDesktopBestNearbyButton && activeBestNearby && (
            <>
              {showDesktopBestNearbyCard ? (
                <div className="pointer-events-auto max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-lg backdrop-blur-md">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                          Best nearby
                        </h3>
                        <button
                          type="button"
                          onClick={handleCloseBestNearby}
                          className="rounded-full p-1 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                          aria-label="Hide best nearby"
                          title="Hide best nearby"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-2 min-w-0">{bestNearbySummary}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleShowBestNearby}
                      className="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                    >
                      Show on map
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleBestNearby}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50/90 px-4 py-3 text-sm font-medium text-blue-700 shadow-lg backdrop-blur-md transition-colors hover:bg-blue-100"
                  aria-expanded={showDesktopBestNearbyCard}
                  aria-label="Show best nearby"
                >
                  <Fuel className="h-4 w-4" />
                  <span>Best nearby</span>
                </button>
              )}
            </>
          )}

          <div className="pointer-events-auto mx-auto flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-gray-100 bg-white/80 px-4 py-3 shadow-lg backdrop-blur-md sm:mx-0 sm:w-[28rem] sm:max-w-[28rem]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Price Guide
            </h3>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-3 w-3 shrink-0 rounded-full bg-emerald-500"></div>
                <span className="truncate text-xs font-medium text-gray-700 sm:text-sm">
                  Cheapest nearby
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
            <PriceGuideSparkline
              fuelType={fuelType}
              nationalPriceBenchmark={nationalPriceBenchmark}
            />
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

      <StationDrawer
        station={selectedStation}
        stations={stations}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setActiveStationId(null);
          setSelectedStation(null);
          setStationDetailError(null);
        }}
        fuelType={fuelType}
        priceBenchmark={priceBenchmark}
        nationalPriceBenchmark={nationalPriceBenchmark}
        focusLocation={distanceReferenceLocation}
      />
    </div>
  );
}
