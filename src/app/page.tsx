import ClientMap from '@/components/ClientMap';
import { getStations } from './actions/stations';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const initialStations = await getStations();

  return (
    <main className="h-screen w-full relative">
      <ClientMap initialStations={initialStations} />
    </main>
  );
}
