'use server';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type StationMapRecord = Prisma.StationGetPayload<{
  include: {
    currentPrices: true;
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

export async function getStations() {
  const stations = await prisma.station.findMany({
    include: {
      currentPrices: {
        orderBy: {
          fuelType: 'asc',
        },
      },
    },
    take: 500,
  });

  return stations;
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
