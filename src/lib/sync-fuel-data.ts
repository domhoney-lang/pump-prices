import {
  fuelFinderClient,
  getPriceTimestamp,
  normalizeFuelType,
  type FuelFinderForecourt,
  type FuelFinderPriceStation,
  type SupportedFuelType,
} from "@/lib/fuel-api";
import { prisma } from "@/lib/prisma";

const UPSERT_CHUNK_SIZE = 50;

type PriceInsertCandidate = {
  stationId: string;
  fuelType: SupportedFuelType;
  price: number;
  timestamp: Date;
};

export type FuelSyncResult =
  | {
      success: true;
      message: string;
      stats: {
        stationBatchCount: number;
        priceBatchCount: number;
        syncedStations: number;
        insertedPriceChanges: number;
        durationSeconds: number;
      };
    }
  | {
      success: false;
      error: string;
    };

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

async function upsertForecourtBatch(batch: FuelFinderForecourt[]) {
  const stations = batch
    .map((station) => {
      const latitude = toNumber(station.location?.latitude);
      const longitude = toNumber(station.location?.longitude);

      if (!station.node_id || latitude === null || longitude === null) {
        return null;
      }

      return {
        id: station.node_id,
        brand: station.brand_name ?? station.trading_name ?? null,
        address: buildAddress(station),
        postcode: station.location?.postcode ?? null,
        lat: latitude,
        lng: longitude,
      };
    })
    .filter((station): station is NonNullable<typeof station> => station !== null);

  for (const stationChunk of chunkArray(stations, UPSERT_CHUNK_SIZE)) {
    await prisma.$transaction(
      stationChunk.map((station) =>
        prisma.station.upsert({
          where: { id: station.id },
          update: station,
          create: station,
        }),
      ),
    );
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

async function insertChangedPrices(batch: FuelFinderPriceStation[]) {
  const incomingRows = normalizePriceBatch(batch);

  if (incomingRows.length === 0) {
    return 0;
  }

  const stationIds = [...new Set(incomingRows.map((row) => row.stationId))];
  const knownStations = await prisma.station.findMany({
    where: {
      id: { in: stationIds },
    },
    select: {
      id: true,
    },
  });

  const knownStationIds = new Set(knownStations.map((station) => station.id));
  const filteredRows = incomingRows.filter((row) => knownStationIds.has(row.stationId));

  if (filteredRows.length === 0) {
    return 0;
  }

  const latestGroups = await prisma.priceHistory.groupBy({
    by: ["stationId", "fuelType"],
    where: {
      stationId: {
        in: [...knownStationIds],
      },
      fuelType: {
        in: ["unleaded", "diesel"],
      },
    },
    _max: {
      timestamp: true,
    },
  });

  const latestRows =
    latestGroups.length === 0
      ? []
      : await prisma.priceHistory.findMany({
          where: {
            OR: latestGroups
              .filter((group) => group._max.timestamp !== null)
              .map((group) => ({
                stationId: group.stationId,
                fuelType: group.fuelType,
                timestamp: group._max.timestamp!,
              })),
          },
        });

  const latestByStationAndFuel = new Map<string, { price: number; timestamp: Date }>(
    latestRows.map((row) => [`${row.stationId}:${row.fuelType}`, row] as const),
  );

  const rowsToInsert: PriceInsertCandidate[] = [];

  for (const row of filteredRows) {
    const key = `${row.stationId}:${row.fuelType}`;
    const latestRow = latestByStationAndFuel.get(key);

    if (!latestRow || latestRow.price !== row.price) {
      rowsToInsert.push(row);
      latestByStationAndFuel.set(key, row);
    }
  }

  if (rowsToInsert.length === 0) {
    return 0;
  }

  await prisma.priceHistory.createMany({
    data: rowsToInsert,
    skipDuplicates: true,
  });

  return rowsToInsert.length;
}

export async function syncFuelDataInternal(): Promise<FuelSyncResult> {
  try {
    const startedAt = Date.now();
    let stationBatchCount = 0;
    let priceBatchCount = 0;
    let syncedStations = 0;
    let insertedPriceChanges = 0;

    for await (const forecourtBatch of fuelFinderClient.iterateForecourts()) {
      stationBatchCount += 1;
      syncedStations += await upsertForecourtBatch(forecourtBatch);
    }

    for await (const priceBatch of fuelFinderClient.iteratePriceStations()) {
      priceBatchCount += 1;
      insertedPriceChanges += await insertChangedPrices(priceBatch);
    }

    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));

    return {
      success: true,
      message: `Synced ${syncedStations} stations across ${stationBatchCount} batches and inserted ${insertedPriceChanges} changed prices across ${priceBatchCount} batches in ${durationSeconds}s.`,
      stats: {
        stationBatchCount,
        priceBatchCount,
        syncedStations,
        insertedPriceChanges,
        durationSeconds,
      },
    };
  } catch (error) {
    console.error("Sync failed:", error);

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

    return {
      success: false,
      error: messageParts.length > 0 ? messageParts.join(": ") : "Unknown sync error",
    };
  }
}
