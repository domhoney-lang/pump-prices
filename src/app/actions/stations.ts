'use server';

import { Prisma } from '@prisma/client';

import { getPriceScale } from '@/lib/price-colors';
import { prisma } from '@/lib/prisma';
import { normalizeUkStationCoordinates } from '@/lib/station-coordinates';

const MAP_STATION_LIMIT = 500;
const MAP_FALLBACK_PRICE_WINDOW = 6;
const NEARBY_BENCHMARK_RADIUS_MILES = 5;
const stationMapSelect = {
  id: true,
  brand: true,
  postcode: true,
  lat: true,
  lng: true,
  currentPrices: {
    select: {
      fuelType: true,
      price: true,
      timestamp: true,
    },
    orderBy: {
      fuelType: 'asc',
    },
  },
  prices: {
    select: {
      fuelType: true,
      price: true,
      timestamp: true,
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: MAP_FALLBACK_PRICE_WINDOW,
  },
} satisfies Prisma.StationSelect;

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

type StationMapQueryRecord = Prisma.StationGetPayload<{
  select: typeof stationMapSelect;
}>;

export type StationMapPriceRecord = {
  fuelType: string;
  price: number;
  timestamp: Date;
};

export type StationMapRecord = {
  id: string;
  brand: string | null;
  lat: number;
  lng: number;
  currentPrices: StationMapPriceRecord[];
  fallbackPrices: StationMapPriceRecord[];
};

export type StationDetailRecord = Prisma.StationGetPayload<{
  include: typeof stationDetailInclude;
}>;

type FuelPriceScale = ReturnType<typeof getPriceScale>;

type FuelType = 'unleaded' | 'diesel';

export type PriceBenchmark = {
  anchorLat: number;
  anchorLng: number;
  radiusMiles: number;
  stationCount: number;
  fuelScales: Record<FuelType, FuelPriceScale>;
};

type BestNearbyFuelStation = {
  stationId: string;
  brand: string | null;
  lat: number;
  lng: number;
  price: number;
  distanceMiles: number;
  inViewport: boolean;
};

export type BestNearby = Record<FuelType, BestNearbyFuelStation | null>;

export type StationsPageData = {
  stations: StationMapRecord[];
  totalStationCount: number;
  visibleStationCount: number;
  matchingStationCount: number;
  stationLimit: number;
  isCapped: boolean;
  selectionMode: 'recent' | 'nearest' | 'spread';
  priceBenchmark?: PriceBenchmark | null;
  bestNearby?: BestNearby | null;
};

export type StationBoundsInput = {
  south: number;
  west: number;
  north: number;
  east: number;
  centerLat: number;
  centerLng: number;
};

type StationQueryOptions = {
  includeNearbyBenchmark?: boolean;
};

function buildBoundsWhere(bounds?: StationBoundsInput): Prisma.StationWhereInput | undefined {
  const validCoordinateWhere: Prisma.StationWhereInput = {
    lat: {
      gte: 49.5,
      lte: 61.5,
    },
    lng: {
      gte: -8.75,
      lte: 2.5,
    },
  };

  if (!bounds) {
    return validCoordinateWhere;
  }

  return {
    AND: [
      validCoordinateWhere,
      {
        lat: {
          gte: bounds.south,
          lte: bounds.north,
        },
        lng: {
          gte: bounds.west,
          lte: bounds.east,
        },
      },
    ],
  };
}

function normalizeMapPriceRecord(price: {
  fuelType: string;
  price: number;
  timestamp: Date;
}): StationMapPriceRecord {
  return {
    fuelType: price.fuelType.toLowerCase(),
    price: price.price,
    timestamp: price.timestamp,
  };
}

type StationCandidateRecord = {
  id: string;
  postcode: string | null;
  lat: number;
  lng: number;
  updatedAt: Date;
};

function toNormalizedStationCandidate(
  station: Pick<StationCandidateRecord, 'id' | 'postcode' | 'lat' | 'lng' | 'updatedAt'>,
) {
  const coordinates = normalizeUkStationCoordinates(station.lat, station.lng, station.postcode);

  if (!coordinates) {
    return null;
  }

  return {
    id: station.id,
    postcode: station.postcode,
    lat: coordinates.lat,
    lng: coordinates.lng,
    updatedAt: station.updatedAt,
  } satisfies StationCandidateRecord;
}

function getDistanceScore(
  origin: Pick<StationBoundsInput, 'centerLat' | 'centerLng'>,
  candidate: Pick<StationCandidateRecord, 'lat' | 'lng'>,
) {
  return (candidate.lat - origin.centerLat) ** 2 + (candidate.lng - origin.centerLng) ** 2;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMiles(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
) {
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

function sortCandidatesByRecency(candidates: StationCandidateRecord[]) {
  return [...candidates].sort((left, right) => {
    const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();

    if (updatedAtDifference !== 0) {
      return updatedAtDifference;
    }

    return left.id.localeCompare(right.id);
  });
}

function sortCandidatesByDistance(bounds: StationBoundsInput, candidates: StationCandidateRecord[]) {
  return [...candidates].sort((left, right) => {
    const distanceDifference = getDistanceScore(bounds, left) - getDistanceScore(bounds, right);

    if (distanceDifference !== 0) {
      return distanceDifference;
    }

    const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();

    if (updatedAtDifference !== 0) {
      return updatedAtDifference;
    }

    return left.id.localeCompare(right.id);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function selectSpreadStationIds(bounds: StationBoundsInput, candidates: StationCandidateRecord[]) {
  const latSpan = Math.max(bounds.north - bounds.south, 0.0001);
  const lngSpan = Math.max(bounds.east - bounds.west, 0.0001);
  const targetCellCount = clamp(Math.round(MAP_STATION_LIMIT / 4), 36, 144);
  const aspectRatio = lngSpan / latSpan;
  const columnCount = clamp(Math.round(Math.sqrt(targetCellCount * aspectRatio)), 6, 18);
  const rowCount = clamp(Math.round(targetCellCount / columnCount), 6, 18);
  const buckets = new Map<string, StationCandidateRecord[]>();

  for (const candidate of candidates) {
    const row = clamp(
      Math.floor(((candidate.lat - bounds.south) / latSpan) * rowCount),
      0,
      rowCount - 1,
    );
    const column = clamp(
      Math.floor(((candidate.lng - bounds.west) / lngSpan) * columnCount),
      0,
      columnCount - 1,
    );
    const key = `${row}:${column}`;
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(candidate);
      continue;
    }

    buckets.set(key, [candidate]);
  }

  const orderedBuckets = Array.from(buckets.entries())
    .map(([key, bucket]) => [key, sortCandidatesByRecency(bucket)] as const)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  const selectedIds: string[] = [];
  let addedInRound = true;

  while (selectedIds.length < MAP_STATION_LIMIT && addedInRound) {
    addedInRound = false;

    for (const [, bucket] of orderedBuckets) {
      const nextCandidate = bucket.shift();

      if (!nextCandidate) {
        continue;
      }

      selectedIds.push(nextCandidate.id);
      addedInRound = true;

      if (selectedIds.length === MAP_STATION_LIMIT) {
        break;
      }
    }
  }

  return selectedIds;
}

function shouldUseSpreadSelection(bounds: StationBoundsInput, matchingStationCount: number) {
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;

  return matchingStationCount > MAP_STATION_LIMIT * 2 || latSpan > 3 || lngSpan > 3;
}

function getFallbackPrices(prices: StationMapQueryRecord['prices']) {
  const latestByFuel = new Map<string, StationMapPriceRecord>();

  for (const price of prices) {
    const normalizedPrice = normalizeMapPriceRecord(price);

    if (!latestByFuel.has(normalizedPrice.fuelType)) {
      latestByFuel.set(normalizedPrice.fuelType, normalizedPrice);
    }
  }

  return Array.from(latestByFuel.values()).sort((left, right) =>
    left.fuelType.localeCompare(right.fuelType),
  );
}

function toStationMapRecord(station: StationMapQueryRecord): StationMapRecord | null {
  const coordinates = normalizeUkStationCoordinates(station.lat, station.lng, station.postcode);

  if (!coordinates) {
    return null;
  }

  return {
    id: station.id,
    brand: station.brand,
    lat: coordinates.lat,
    lng: coordinates.lng,
    currentPrices: station.currentPrices
      .map(normalizeMapPriceRecord)
      .sort((left, right) => left.fuelType.localeCompare(right.fuelType)),
    fallbackPrices: getFallbackPrices(station.prices),
  };
}

function getFuelPrice(station: StationMapRecord, fuelType: FuelType) {
  const currentPrice = station.currentPrices.find((price) => price.fuelType === fuelType)?.price;

  if (typeof currentPrice === 'number') {
    return currentPrice;
  }

  return station.fallbackPrices.find((price) => price.fuelType === fuelType)?.price;
}

function getRadiusBounds(centerLat: number, centerLng: number, radiusMiles: number): StationBoundsInput {
  const milesPerLatDegree = 69;
  const latDelta = radiusMiles / milesPerLatDegree;
  const cosine = Math.max(Math.cos(toRadians(centerLat)), 0.01);
  const lngDelta = radiusMiles / (milesPerLatDegree * cosine);

  return {
    south: centerLat - latDelta,
    west: centerLng - lngDelta,
    north: centerLat + latDelta,
    east: centerLng + lngDelta,
    centerLat,
    centerLng,
  };
}

function isPointInBounds(
  station: Pick<StationMapRecord, 'lat' | 'lng'>,
  bounds: Pick<StationBoundsInput, 'south' | 'west' | 'north' | 'east'>,
) {
  return (
    station.lat >= bounds.south &&
    station.lat <= bounds.north &&
    station.lng >= bounds.west &&
    station.lng <= bounds.east
  );
}

function buildBestNearbyForFuel(
  stations: StationMapRecord[],
  fuelType: FuelType,
  anchor: { lat: number; lng: number },
  bounds: Pick<StationBoundsInput, 'south' | 'west' | 'north' | 'east'>,
): BestNearbyFuelStation | null {
  const candidates = stations
    .map((station) => {
      const price = getFuelPrice(station, fuelType);

      if (typeof price !== 'number') {
        return null;
      }

      return {
        station,
        price,
        distanceMiles: getDistanceMiles(anchor, station),
      };
    })
    .filter(
      (
        station,
      ): station is {
        station: StationMapRecord;
        price: number;
        distanceMiles: number;
      } => station !== null,
    )
    .sort((left, right) => {
      if (left.price !== right.price) {
        return left.price - right.price;
      }

      if (left.distanceMiles !== right.distanceMiles) {
        return left.distanceMiles - right.distanceMiles;
      }

      return left.station.id.localeCompare(right.station.id);
    });

  const bestStation = candidates[0];

  if (!bestStation) {
    return null;
  }

  return {
    stationId: bestStation.station.id,
    brand: bestStation.station.brand,
    lat: bestStation.station.lat,
    lng: bestStation.station.lng,
    price: bestStation.price,
    distanceMiles: bestStation.distanceMiles,
    inViewport: isPointInBounds(bestStation.station, bounds),
  };
}

async function buildNearbyBenchmark(bounds: StationBoundsInput) {
  const anchor = {
    lat: bounds.centerLat,
    lng: bounds.centerLng,
  };
  const radiusBounds = getRadiusBounds(
    bounds.centerLat,
    bounds.centerLng,
    NEARBY_BENCHMARK_RADIUS_MILES,
  );
  const nearbyRows = await prisma.station.findMany({
    where: buildBoundsWhere(radiusBounds),
    select: stationMapSelect,
  });
  const nearbyStations = nearbyRows
    .map(toStationMapRecord)
    .filter((station): station is StationMapRecord => station !== null)
    .filter(
      (station) => getDistanceMiles(anchor, station) <= NEARBY_BENCHMARK_RADIUS_MILES,
    );

  return {
    priceBenchmark: {
      anchorLat: bounds.centerLat,
      anchorLng: bounds.centerLng,
      radiusMiles: NEARBY_BENCHMARK_RADIUS_MILES,
      stationCount: nearbyStations.length,
      fuelScales: {
        unleaded: getPriceScale(
          nearbyStations.map((station) => getFuelPrice(station, 'unleaded')),
        ),
        diesel: getPriceScale(
          nearbyStations.map((station) => getFuelPrice(station, 'diesel')),
        ),
      },
    } satisfies PriceBenchmark,
    bestNearby: {
      unleaded: buildBestNearbyForFuel(nearbyStations, 'unleaded', anchor, bounds),
      diesel: buildBestNearbyForFuel(nearbyStations, 'diesel', anchor, bounds),
    } satisfies BestNearby,
  };
}

async function loadStations(bounds?: StationBoundsInput, options?: StationQueryOptions) {
  const where = buildBoundsWhere(bounds);
  const [totalStationCount, matchingStationCount] = await prisma.$transaction([
    prisma.station.count(),
    prisma.station.count({ where }),
  ]);

  const stationCandidates = await prisma.station.findMany({
    where,
    select: {
      id: true,
      postcode: true,
      lat: true,
      lng: true,
      updatedAt: true,
    },
  });
  const validStationCandidates = stationCandidates
    .map(toNormalizedStationCandidate)
    .filter((station): station is StationCandidateRecord => station !== null);

  const selectionMode: StationsPageData['selectionMode'] = !bounds
    ? validStationCandidates.length > MAP_STATION_LIMIT
      ? 'spread'
      : 'recent'
    : shouldUseSpreadSelection(bounds, matchingStationCount)
      ? 'spread'
      : matchingStationCount > MAP_STATION_LIMIT
        ? 'nearest'
        : 'recent';

  const stationIds =
    selectionMode === 'spread'
      ? selectSpreadStationIds(
          bounds ?? {
            south: Math.min(...validStationCandidates.map((station) => station.lat)),
            west: Math.min(...validStationCandidates.map((station) => station.lng)),
            north: Math.max(...validStationCandidates.map((station) => station.lat)),
            east: Math.max(...validStationCandidates.map((station) => station.lng)),
            centerLat:
              validStationCandidates.reduce((sum, station) => sum + station.lat, 0) /
              Math.max(validStationCandidates.length, 1),
            centerLng:
              validStationCandidates.reduce((sum, station) => sum + station.lng, 0) /
              Math.max(validStationCandidates.length, 1),
          },
          validStationCandidates,
        )
      : selectionMode === 'nearest' && bounds
        ? sortCandidatesByDistance(bounds, validStationCandidates)
            .slice(0, MAP_STATION_LIMIT)
            .map((station) => station.id)
        : sortCandidatesByRecency(validStationCandidates)
            .slice(0, MAP_STATION_LIMIT)
            .map((station) => station.id);

  const stationRows =
    stationIds.length === 0
      ? []
      : await prisma.station.findMany({
          where: {
            id: {
              in: stationIds,
            },
          },
          select: stationMapSelect,
        });

  const stationsById = new Map(
    stationRows
      .map((station) => {
        const normalizedStation = toStationMapRecord(station);

        if (!normalizedStation) {
          return null;
        }

        return [station.id, normalizedStation] as const;
      })
      .filter((station): station is readonly [string, StationMapRecord] => station !== null),
  );
  const stations = stationIds
    .map((stationId) => stationsById.get(stationId))
    .filter((station): station is StationMapRecord => station !== undefined);
  const nearbyBenchmarkData =
    bounds && options?.includeNearbyBenchmark !== false
      ? await buildNearbyBenchmark(bounds)
      : null;

  return {
    stations,
    totalStationCount,
    visibleStationCount: stations.length,
    matchingStationCount,
    stationLimit: MAP_STATION_LIMIT,
    isCapped: matchingStationCount > stations.length,
    selectionMode,
    priceBenchmark: nearbyBenchmarkData?.priceBenchmark,
    bestNearby: nearbyBenchmarkData?.bestNearby,
  } satisfies StationsPageData;
}

export async function getStations() {
  return loadStations();
}

export async function getStationsInBounds(bounds: StationBoundsInput, options?: StationQueryOptions) {
  return loadStations(bounds, options);
}

export async function getStationDetails(id: string): Promise<StationDetailRecord | null> {
  const station = await prisma.station.findUnique({
    where: { id },
    include: stationDetailInclude,
  });

  return station;
}
