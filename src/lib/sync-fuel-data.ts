import {
  fuelFinderClient,
  getPriceTimestamp,
  normalizeFuelType,
  type FuelFinderForecourt,
  type FuelFinderPriceStation,
  type SupportedFuelType,
} from "@/lib/fuel-api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeUkStationCoordinates } from "@/lib/station-coordinates";

const STATION_UPSERT_CHUNK_SIZE = 250;
const PRICE_HISTORY_INSERT_CHUNK_SIZE = 1_000;
const CURRENT_PRICE_UPSERT_CHUNK_SIZE = 500;
const INCREMENTAL_SYNC_SAFETY_BUFFER_MS = 10 * 60 * 1_000;

type PriceInsertCandidate = {
  stationId: string;
  fuelType: SupportedFuelType;
  price: number;
  timestamp: Date;
};

type StationUpsertRow = {
  id: string;
  brand: string | null;
  address: string | null;
  postcode: string | null;
  lat: number;
  lng: number;
};

export type FuelSyncMode = "incremental" | "full-price-backfill";

type SyncFuelDataOptions = {
  mode?: FuelSyncMode;
};

export type FuelSyncResult =
  | {
      success: true;
      message: string;
      stats: {
        mode: FuelSyncMode;
        stationBatchCount: number;
        priceBatchCount: number;
        syncedStations: number;
        insertedPriceChanges: number;
        syncedCurrentPrices: number;
        durationSeconds: number;
        incrementalStartTimestamp: string | null;
      };
    }
  | {
      success: false;
      error: string;
    };

type SyncLogPayload = {
  mode: FuelSyncMode;
  stationBatchCount: number;
  priceBatchCount: number;
  syncedStations: number;
  insertedPriceChanges: number;
  syncedCurrentPrices: number;
  durationSeconds: number;
  incrementalStartTimestamp: string | null;
  success: boolean;
  error?: string;
};

function logSyncResult(payload: SyncLogPayload) {
  console.info('[fuel-sync]', JSON.stringify(payload));
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildAddress(station: FuelFinderForecourt) {
  const location = station.location;

  if (!location) {
    return null;
  }

  const addressParts = [
    location.address_line_1,
    location.address_line_2,
    location.city,
    location.county,
  ].filter((part): part is string => Boolean(part));

  return addressParts.length > 0 ? addressParts.join(", ") : null;
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getKey(stationId: string, fuelType: SupportedFuelType) {
  return `${stationId}:${fuelType}`;
}

function toIncrementalStartTimestamp(timestamp: Date | null | undefined) {
  if (!timestamp) {
    return undefined;
  }

  return new Date(
    Math.max(timestamp.getTime() - INCREMENTAL_SYNC_SAFETY_BUFFER_MS, 0),
  ).toISOString();
}

async function getKnownStationIds() {
  const knownStations = await prisma.station.findMany({
    select: {
      id: true,
    },
  });

  return new Set(knownStations.map((station) => station.id));
}

async function getIncrementalStartTimestamp() {
  const [latestCurrentPrice, latestPriceHistory, latestStation] = await prisma.$transaction([
    prisma.currentPrice.aggregate({
      _max: {
        timestamp: true,
      },
    }),
    prisma.priceHistory.aggregate({
      _max: {
        timestamp: true,
      },
    }),
    prisma.station.aggregate({
      _max: {
        updatedAt: true,
      },
    }),
  ]);

  return toIncrementalStartTimestamp(
    latestCurrentPrice._max.timestamp ??
      latestPriceHistory._max.timestamp ??
      latestStation._max.updatedAt,
  );
}

async function bulkUpsertStations(stations: StationUpsertRow[]) {
  for (const stationChunk of chunkArray(stations, STATION_UPSERT_CHUNK_SIZE)) {
    await prisma.$executeRaw`
      INSERT INTO "Station" ("id", "brand", "address", "postcode", "lat", "lng", "createdAt", "updatedAt")
      VALUES ${Prisma.join(
        stationChunk.map(
          (station) =>
            Prisma.sql`(${station.id}, ${station.brand}, ${station.address}, ${station.postcode}, ${station.lat}, ${station.lng}, NOW(), NOW())`,
        ),
      )}
      ON CONFLICT ("id") DO UPDATE
      SET
        "brand" = EXCLUDED."brand",
        "address" = EXCLUDED."address",
        "postcode" = EXCLUDED."postcode",
        "lat" = EXCLUDED."lat",
        "lng" = EXCLUDED."lng",
        "updatedAt" = NOW()
    `;
  }
}

async function upsertForecourtBatch(batch: FuelFinderForecourt[], knownStationIds: Set<string>) {
  const stations = batch
    .map((station) => {
      const latitude = toNumber(station.location?.latitude);
      const longitude = toNumber(station.location?.longitude);
      const postcode = station.location?.postcode ?? null;
      const normalizedCoordinates = normalizeUkStationCoordinates(latitude, longitude, postcode);

      if (!station.node_id || !normalizedCoordinates) {
        return null;
      }

      return {
        id: station.node_id,
        brand: station.brand_name ?? station.trading_name ?? null,
        address: buildAddress(station),
        postcode,
        lat: normalizedCoordinates.lat,
        lng: normalizedCoordinates.lng,
      };
    })
    .filter((station): station is NonNullable<typeof station> => station !== null);

  if (stations.length === 0) {
    return 0;
  }

  await bulkUpsertStations(stations);

  for (const station of stations) {
    knownStationIds.add(station.id);
  }

  return stations.length;
}

function normalizePriceBatch(batch: FuelFinderPriceStation[]) {
  const rows: PriceInsertCandidate[] = [];

  for (const station of batch) {
    for (const fuelPrice of station.fuel_prices ?? []) {
      const fuelType = normalizeFuelType(fuelPrice.fuel_type);
      const price = toNumber(fuelPrice.price);
      const timestamp = getPriceTimestamp(fuelPrice);

      if (!fuelType || price === null || !timestamp) {
        continue;
      }

      rows.push({
        stationId: station.node_id,
        fuelType,
        price,
        timestamp,
      });
    }
  }

  rows.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  return rows;
}

async function insertPriceHistoryRows(rows: PriceInsertCandidate[]) {
  for (const rowChunk of chunkArray(rows, PRICE_HISTORY_INSERT_CHUNK_SIZE)) {
    await prisma.priceHistory.createMany({
      data: rowChunk,
      skipDuplicates: true,
    });
  }
}

async function bulkUpsertCurrentPrices(rows: PriceInsertCandidate[]) {
  for (const rowChunk of chunkArray(rows, CURRENT_PRICE_UPSERT_CHUNK_SIZE)) {
    await prisma.$executeRaw`
      INSERT INTO "CurrentPrice" ("stationId", "fuelType", "price", "timestamp", "createdAt", "updatedAt")
      VALUES ${Prisma.join(
        rowChunk.map(
          (row) =>
            Prisma.sql`(${row.stationId}, ${row.fuelType}, ${row.price}, ${row.timestamp}, NOW(), NOW())`,
        ),
      )}
      ON CONFLICT ("stationId", "fuelType") DO UPDATE
      SET
        "price" = EXCLUDED."price",
        "timestamp" = EXCLUDED."timestamp",
        "updatedAt" = NOW()
      WHERE "CurrentPrice"."timestamp" <= EXCLUDED."timestamp"
    `;
  }
}

async function resetPriceDataForBackfill() {
  await prisma.$transaction([
    prisma.currentPrice.deleteMany({
      where: {
        fuelType: {
          in: ["unleaded", "diesel"],
        },
      },
    }),
    prisma.priceHistory.deleteMany({
      where: {
        fuelType: {
          in: ["unleaded", "diesel"],
        },
      },
    }),
  ]);
}

async function insertChangedPrices(batch: FuelFinderPriceStation[], knownStationIds: Set<string>) {
  const incomingRows = normalizePriceBatch(batch).filter((row) => knownStationIds.has(row.stationId));

  if (incomingRows.length === 0) {
    return {
      insertedPriceChanges: 0,
      syncedCurrentPrices: 0,
    };
  }

  const stationIds = [...new Set(incomingRows.map((row) => row.stationId))];
  const currentPrices = await prisma.currentPrice.findMany({
    where: {
      stationId: { in: stationIds },
      fuelType: { in: ["unleaded", "diesel"] },
    },
    select: {
      stationId: true,
      fuelType: true,
      price: true,
      timestamp: true,
    },
  });

  const latestByStationAndFuel = new Map<string, { price: number; timestamp: Date }>(
    currentPrices.map((row) => [getKey(row.stationId, row.fuelType as SupportedFuelType), row] as const),
  );

  const rowsToInsert: PriceInsertCandidate[] = [];
  const currentPriceUpdates = new Map<string, PriceInsertCandidate>();

  for (const row of incomingRows) {
    const key = getKey(row.stationId, row.fuelType);
    const latestRow = latestByStationAndFuel.get(key);

    if (latestRow && row.timestamp.getTime() < latestRow.timestamp.getTime()) {
      continue;
    }

    if (!latestRow || latestRow.price !== row.price) {
      rowsToInsert.push(row);
    }

    latestByStationAndFuel.set(key, row);
    currentPriceUpdates.set(key, row);
  }

  if (rowsToInsert.length > 0) {
    await insertPriceHistoryRows(rowsToInsert);
  }

  const snapshotRows = [...currentPriceUpdates.values()];

  if (snapshotRows.length > 0) {
    await bulkUpsertCurrentPrices(snapshotRows);
  }

  return {
    insertedPriceChanges: rowsToInsert.length,
    syncedCurrentPrices: snapshotRows.length,
  };
}

export async function syncFuelDataInternal(options: SyncFuelDataOptions = {}): Promise<FuelSyncResult> {
  const mode = options.mode ?? "incremental";
  const startedAt = Date.now();
  let stationBatchCount = 0;
  let priceBatchCount = 0;
  let syncedStations = 0;
  let insertedPriceChanges = 0;
  let syncedCurrentPrices = 0;
  let incrementalStartTimestamp: string | undefined;

  try {
    const knownStationIds = await getKnownStationIds();
    incrementalStartTimestamp =
      mode === "full-price-backfill" ? undefined : await getIncrementalStartTimestamp();

    if (mode === "full-price-backfill") {
      await resetPriceDataForBackfill();
    }

    for await (const forecourtBatch of fuelFinderClient.iterateForecourts(incrementalStartTimestamp)) {
      stationBatchCount += 1;
      syncedStations += await upsertForecourtBatch(forecourtBatch, knownStationIds);
    }

    for await (const priceBatch of fuelFinderClient.iteratePriceStations(incrementalStartTimestamp)) {
      priceBatchCount += 1;
      const batchResult = await insertChangedPrices(priceBatch, knownStationIds);
      insertedPriceChanges += batchResult.insertedPriceChanges;
      syncedCurrentPrices += batchResult.syncedCurrentPrices;
    }

    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    const stats = {
      mode,
      stationBatchCount,
      priceBatchCount,
      syncedStations,
      insertedPriceChanges,
      syncedCurrentPrices,
      durationSeconds,
      incrementalStartTimestamp: incrementalStartTimestamp ?? null,
    };

    logSyncResult({
      ...stats,
      success: true,
    });

    return {
      success: true,
      message: `Synced ${syncedStations} stations across ${stationBatchCount} batches, refreshed ${syncedCurrentPrices} current prices, and inserted ${insertedPriceChanges} changed prices across ${priceBatchCount} price batches in ${durationSeconds}s.`,
      stats,
    };
  } catch (error) {
    const messageParts = [];

    if (error instanceof Error) {
      messageParts.push(error.message);

      const details =
        "details" in error && typeof error.details === "string" && error.details.length > 0
          ? error.details
          : null;

      if (details) {
        messageParts.push(details);
      }
    }

    const errorMessage = messageParts.length > 0 ? messageParts.join(": ") : "Unknown sync error";
    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));

    logSyncResult({
      mode,
      stationBatchCount,
      priceBatchCount,
      syncedStations,
      insertedPriceChanges,
      syncedCurrentPrices,
      durationSeconds,
      incrementalStartTimestamp: incrementalStartTimestamp ?? null,
      success: false,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
