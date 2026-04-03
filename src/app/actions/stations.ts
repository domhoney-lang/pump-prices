'use server';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

const MAP_STATION_LIMIT = 500;

export type StationMapRecord = Prisma.StationGetPayload<{
  include: {
    currentPrices: true;
    prices: {
      orderBy: {
        timestamp: 'desc';
      };
      take: 10;
    };
  };
}>;

export type StationDetailRecord = Prisma.StationGetPayload<{
  include: {
    currentPrices: true;
    prices: {
      orderBy: {
        timestamp: 'desc';
      };
    };
  };
}>;

export type StationsPageData = {
  stations: StationMapRecord[];
  totalStationCount: number;
  visibleStationCount: number;
};

export async function getStations() {
  const [stations, totalStationCount] = await prisma.$transaction([
    prisma.station.findMany({
      include: {
        currentPrices: {
          orderBy: {
            fuelType: 'asc',
          },
        },
        prices: {
          orderBy: {
            timestamp: 'desc',
          },
          take: 10,
        },
      },
      take: MAP_STATION_LIMIT,
    }),
    prisma.station.count(),
  ]);

  return {
    stations,
    totalStationCount,
    visibleStationCount: stations.length,
  } satisfies StationsPageData;
}

export async function getStationDetails(id: string) {
  const station = await prisma.station.findUnique({
    where: { id },
    include: {
      currentPrices: {
        orderBy: {
          fuelType: 'asc',
        },
      },
      prices: {
        orderBy: {
          timestamp: 'desc',
        },
      },
    },
  });

  return station;
}
