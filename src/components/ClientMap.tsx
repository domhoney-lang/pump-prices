'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Fuel, RefreshCw } from 'lucide-react';

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

export default function ClientMap({ initialStations, totalStationCount }: ClientMapProps) {
  const router = useRouter();
  const [fuelType, setFuelType] = useState<'unleaded' | 'diesel'>('unleaded');
  const [selectedStation, setSelectedStation] = useState<StationDetailRecord | null>(null);
  const [stations, setStations] = useState(initialStations);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [loadingStation, setLoadingStation] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [matchingStationCount, setMatchingStationCount] = useState(initialStations.length);

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

  const handleViewportChange = async (bounds: StationBoundsInput) => {
    setLoadingStations(true);
    setSyncError(null);

    try {
      const result = await getStationsInBounds(bounds);
      setStations(result.stations);
      setMatchingStationCount(result.matchingStationCount);
    } catch (error) {
      console.error('Failed to load visible stations', error);
      setSyncError('Could not load stations for the current map view.');
    } finally {
      setLoadingStations(false);
    }
  };

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
              <div className="flex rounded-xl bg-gray-100 p-1">
                <button
                  onClick={() => setFuelType('unleaded')}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    fuelType === 'unleaded'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Unleaded
                </button>
                <button
                  onClick={() => setFuelType('diesel')}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    fuelType === 'diesel'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Diesel
                </button>
              </div>

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
        onStationSelect={handleStationSelect}
        onViewportChange={handleViewportChange}
      />

      {!hasStations && !isSyncing && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-gray-200 bg-white/95 p-6 text-center shadow-2xl backdrop-blur">
            <h2 className="text-xl font-semibold text-gray-900">No station data yet</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Pull the latest forecourt and price batches from the official Fuel Finder API to
              populate the map and unlock the station drawer history.
            </p>
            <button
              onClick={handleSync}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
              Start first sync
            </button>
          </div>
        </div>
      )}

      {loadingStation && (
        <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-blue-600 shadow-lg">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>Loading details...</span>
        </div>
      )}

      {loadingStations && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-blue-600 shadow-lg">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>Loading stations in view...</span>
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
