'use server';

import { prisma } from '@/lib/prisma';

export async function getStations() {
  // Fetch stations with their latest prices.
  // In a real app, this should probably be restricted by bounding box.
  const stations = await prisma.station.findMany({
    include: {
      prices: {
        orderBy: {
          timestamp: 'desc',
        },
        // We just need the most recent price per fuel type, but taking 20 is a heuristic to get recent ones
        take: 10,
      },
    },
    take: 500, // Limit for performance in this demo
  });

  return stations;
}

export async function getStationDetails(id: string) {
  const station = await prisma.station.findUnique({
    where: { id },
    include: {
      prices: {
        orderBy: {
          timestamp: 'desc',
        },
      },
    },
  });

  return station;
}
