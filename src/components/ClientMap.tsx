'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Fuel, LocateFixed, RefreshCw } from 'lucide-react';

import {
  getStationDetails,
  getStationsInBounds,
  type StationBoundsInput,
  type StationDetailRecord,
  type StationMapRecord,
} from '@/app/actions/stations';
import { syncFuelData } from '@/app/actions/sync';
import StationDrawer from './StationDrawer';

const MapComponent = dynamic(() => import('./Map'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 z-0 flex h-screen w-full items-center justify-center bg-gray-50">
      Loading map...
    </div>
  ),
});

interface ClientMapProps {
  initialStations: StationMapRecord[];
  totalStationCount: number;
}

type UserLocation = {
  lat: number;
  lng: number;
};

export default function ClientMap({ initialStations, totalStationCount }: ClientMapProps) {
  const router = useRouter();
  const [fuelType, setFuelType] = useState<'unleaded' | 'diesel'>('unleaded');
  const [selectedStation, setSelectedStation] = useState<StationDetailRecord | null>(null);
  const [stations, setStations] = useState(initialStations);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [loadingStation, setLoadingStation] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [matchingStationCount, setMatchingStationCount] = useState(initialStations.length);
  const lastBoundsKeyRef = useRef<string | null>(null);
  const viewportRequestIdRef = useRef(0);
  const hasAttemptedAutoLocateRef = useRef(false);

  const hasStations = stations.length > 0;
  const stationSummary = useMemo(() => {
    if (!hasStations) {
      return 'Run the first sync to load stations onto the map';
    }

    if (matchingStationCount === totalStationCount) {
      return `Showing ${stations.length} of ${totalStationCount} stations`;
    }

    return `Showing ${stations.length} of ${matchingStationCount} stations in this area`;
  }, [hasStations, matchingStationCount, stations.length, totalStationCount]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    setSyncError(null);

    try {
      const result = await syncFuelData();

      if (result.success) {
        setSyncMessage(result.message);
        setStations(initialStations);
        router.refresh();
      } else {
        setSyncError(result.error);
      }
    } catch {
      setSyncError('Unexpected error while syncing fuel data.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleStationSelect = async (stationId: string) => {
    setLoadingStation(true);

    try {
      const station = await getStationDetails(stationId);
      setSelectedStation(station);
      setIsDrawerOpen(true);
    } catch (error) {
      console.error('Failed to load station details', error);
      setSyncError('Could not load station details.');
    } finally {
      setLoadingStation(false);
    }
  };

  const requestUserLocation = useCallback((options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setSyncError('Geolocation is not supported by this browser.');
      }
      return;
    }

    setIsLocating(true);
    if (!options?.silent) {
      setSyncError(null);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setIsLocating(false);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : 'Could not determine your location.';

        if (!options?.silent) {
          setSyncError(message);
        }
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }, []);

  const handleLocateUser = () => {
    requestUserLocation();
  };

  useEffect(() => {
    if (hasAttemptedAutoLocateRef.current) {
      return;
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
        if (status.state === 'granted') {
          requestUserLocation({ silent: true });
        }
      })
      .catch(() => {
        // Ignore unsupported permission-query implementations and keep manual location.
      });
  }, [requestUserLocation]);

  const handleViewportChange = useCallback(async (bounds: StationBoundsInput) => {
    const boundsKey = [
      bounds.south.toFixed(4),
      bounds.west.toFixed(4),
      bounds.north.toFixed(4),
      bounds.east.toFixed(4),
    ].join(':');

    if (lastBoundsKeyRef.current === boundsKey) {
      return;
    }

    lastBoundsKeyRef.current = boundsKey;
    const requestId = ++viewportRequestIdRef.current;
    setLoadingStations(true);
    setSyncError(null);

    try {
      const result = await getStationsInBounds(bounds);
      if (requestId !== viewportRequestIdRef.current) {
        return;
      }

      setStations(result.stations);
      setMatchingStationCount(result.matchingStationCount);
    } catch (error) {
      if (requestId !== viewportRequestIdRef.current) {
        return;
      }

      console.error('Failed to load visible stations', error);
      setSyncError('Could not load stations for the current map view.');
    } finally {
      if (requestId === viewportRequestIdRef.current) {
        setLoadingStations(false);
      }
    }
  }, []);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-0 right-0 top-0 z-10 p-4 pointer-events-none">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="pointer-events-auto flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <Fuel className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">UK Fuel Prices</h1>
                <p className="text-sm text-gray-500">{stationSummary}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-gray-100 p-1">
                <span className="pl-2 pr-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Fuel
                </span>
                <button
                  onClick={() => setFuelType('unleaded')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    fuelType === 'unleaded'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Unleaded
                </button>
                <button
                  onClick={() => setFuelType('diesel')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    fuelType === 'diesel'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Diesel
                </button>
              </div>

              <button
                onClick={handleLocateUser}
                disabled={isLocating}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                title="Use my location"
              >
                <LocateFixed className={`h-4 w-4 ${isLocating ? 'animate-pulse' : ''}`} />
                {isLocating ? 'Locating...' : 'My location'}
              </button>

              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                title="Sync data"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : hasStations ? 'Refresh' : 'Initial sync'}
              </button>
            </div>
          </div>

          {(syncMessage || syncError) && (
            <div
              className={`pointer-events-auto rounded-2xl px-4 py-3 text-sm shadow-lg ${
                syncError
                  ? 'border border-red-200 bg-red-50 text-red-700'
                  : 'border border-green-200 bg-green-50 text-green-700'
              }`}
            >
              {syncError ?? syncMessage}
            </div>
          )}
        </div>
      </div>

      <MapComponent
        stations={stations}
        fuelType={fuelType}
        focusLocation={userLocation}
        onStationSelect={handleStationSelect}
        onViewportChange={handleViewportChange}
      />

      {hasStations && (
        <div className="absolute bottom-6 right-6 z-20 pointer-events-auto">
          <div className="flex flex-col gap-2 rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-lg backdrop-blur-sm">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Price Guide</h3>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span className="text-sm font-medium text-gray-700">Cheapest 20%</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-sm font-medium text-gray-700">Average</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-sm font-medium text-gray-700">Most Expensive</span>
            </div>
          </div>
        </div>
      )}

      {!hasStations && !isSyncing && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-100 bg-white/90 p-8 text-center shadow-2xl backdrop-blur-md">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <Fuel className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">No station data yet</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              Pull the latest forecourt and price batches from the official Fuel Finder API to
              populate the map and unlock the station drawer history.
            </p>
            <button
              onClick={handleSync}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-700 hover:shadow-lg active:scale-95"
            >
              <RefreshCw className="h-4 w-4" />
              Start first sync
            </button>
          </div>
        </div>
      )}

      {loadingStation && (
        <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-gray-100 bg-white/95 px-5 py-3 text-sm font-medium text-gray-700 shadow-xl backdrop-blur-sm transition-all">
          <div className="flex h-5 w-5 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
          <span>Loading details...</span>
        </div>
      )}

      {loadingStations && (
        <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-100 bg-white/95 px-5 py-3 text-sm font-medium text-gray-700 shadow-xl backdrop-blur-sm transition-all">
          <div className="flex h-5 w-5 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
          <span>Updating map...</span>
        </div>
      )}

      <StationDrawer
        station={selectedStation}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        fuelType={fuelType}
      />
    </div>
  );
}
