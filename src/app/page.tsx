import ClientMap from '@/components/ClientMap';
import { getStations } from './actions/stations';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const initialData = await getStations();

  return (
    <main className="h-dvh w-full relative">
      <ClientMap initialStations={initialData.stations} totalStationCount={initialData.totalStationCount} />
    </main>
  );
}
