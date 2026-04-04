import ClientMap from '@/components/ClientMap';
import { getStations } from './actions/stations';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const initialData = await getStations();

  return (
    <main className="h-dvh w-full relative">
      <ClientMap
        initialStations={initialData.stations}
        totalStationCount={initialData.totalStationCount}
        initialMatchingStationCount={initialData.matchingStationCount}
        initialIsCapped={initialData.isCapped}
        stationLimit={initialData.stationLimit}
        initialSelectionMode={initialData.selectionMode}
        initialPriceBenchmark={initialData.priceBenchmark}
        initialNationalPriceBenchmark={initialData.nationalPriceBenchmark}
        initialBestNearby={initialData.bestNearby}
      />
    </main>
  );
}
