'use server';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

const MAP_STATION_LIMIT = 500;
const stationMapInclude = {
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
} satisfies Prisma.StationInclude;

const stationDetailInclude = {
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
} satisfies Prisma.StationInclude;

export type StationMapRecord = Prisma.StationGetPayload<{
  include: typeof stationMapInclude;
}>;

export type StationDetailRecord = Prisma.StationGetPayload<{
  include: typeof stationDetailInclude;
}>;

export type StationsPageData = {
  stations: StationMapRecord[];
  totalStationCount: number;
  visibleStationCount: number;
  matchingStationCount: number;
};

export type StationBoundsInput = {
  south: number;
  west: number;
  north: number;
  east: number;
};

function buildBoundsWhere(bounds?: StationBoundsInput): Prisma.StationWhereInput | undefined {
  if (!bounds) {
    return undefined;
  }

  return {
    lat: {
      gte: bounds.south,
      lte: bounds.north,
    },
    lng: {
      gte: bounds.west,
      lte: bounds.east,
    },
  };
}

async function loadStations(bounds?: StationBoundsInput) {
  const where = buildBoundsWhere(bounds);
  const [stations, totalStationCount, matchingStationCount] = await prisma.$transaction([
    prisma.station.findMany({
      where,
      include: stationMapInclude,
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'asc' },
      ],
      take: MAP_STATION_LIMIT,
    }),
    prisma.station.count(),
    prisma.station.count({ where }),
  ]);

  return {
    stations,
    totalStationCount,
    visibleStationCount: stations.length,
    matchingStationCount,
  } satisfies StationsPageData;
}

export async function getStations() {
  return loadStations();
}

export async function getStationsInBounds(bounds: StationBoundsInput) {
  return loadStations(bounds);
}

export async function getStationDetails(id: string): Promise<StationDetailRecord | null> {
  const station = await prisma.station.findUnique({
    where: { id },
    include: stationDetailInclude,
  });

  return station;
}
