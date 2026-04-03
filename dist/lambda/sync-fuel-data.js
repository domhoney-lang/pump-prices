"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lambda/sync-fuel-data.ts
var sync_fuel_data_exports = {};
__export(sync_fuel_data_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(sync_fuel_data_exports);

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var globalForPrisma = globalThis;
var prisma = globalForPrisma.prisma ?? new import_client.PrismaClient({
  log: false ? ["query", "error", "warn"] : ["error"]
});
if (false) globalForPrisma.prisma = prisma;

// src/lib/fuel-api.ts
var FUEL_API_BASE = "https://www.fuel-finder.service.gov.uk/api/v1";
var FUEL_FINDER_BATCH_SIZE = 500;
var FuelFinderApiError = class extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = "FuelFinderApiError";
  }
};
function getRequiredFuelFinderEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
function normalizeFuelType(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["unleaded", "petrol", "e10", "e5", "premiumunleaded"].includes(normalized)) {
    return "unleaded";
  }
  if (["diesel", "b7", "premiumdiesel"].includes(normalized)) {
    return "diesel";
  }
  return null;
}
function getPriceTimestamp(price) {
  const sourceValue = price.price_change_effective_timestamp ?? price.price_last_updated;
  if (!sourceValue) {
    return null;
  }
  const parsed = new Date(sourceValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
var FuelFinderClient = class {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const payload = JSON.stringify({
      client_id: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_ID"),
      client_secret: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_SECRET")
    });
    let response;
    try {
      response = await fetch(`${FUEL_API_BASE}/oauth/generate_access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: payload,
        cache: "no-store"
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new FuelFinderApiError("Failed to reach Fuel Finder token endpoint", 0, details);
    }
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new FuelFinderApiError(
        `Failed to fetch Fuel Finder token (${response.status})`,
        response.status,
        responseBody || void 0
      );
    }
    const rawData = await response.json();
    const data = rawData.data ?? rawData;
    if (!data.access_token || !data.expires_in) {
      throw new FuelFinderApiError(
        "Fuel Finder token response was missing required fields",
        response.status,
        JSON.stringify(rawData)
      );
    }
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1e3 - 6e4;
    return this.accessToken;
  }
  async request(path, params = {}) {
    const token = await this.getAccessToken();
    const url = new URL(`${FUEL_API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== void 0) {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new FuelFinderApiError(`Failed to reach Fuel Finder endpoint for ${path}`, 0, details);
    }
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const message = `Fuel Finder request failed for ${path} (${response.status})`;
      throw new FuelFinderApiError(message, response.status, responseBody || void 0);
    }
    return await response.json();
  }
  async fetchForecourtBatch(batchNumber, effectiveStartTimestamp) {
    return this.request("/pfs", {
      "batch-number": batchNumber,
      "effective-start-timestamp": effectiveStartTimestamp
    });
  }
  async fetchPriceBatch(batchNumber, effectiveStartTimestamp) {
    return this.request("/pfs/fuel-prices", {
      "batch-number": batchNumber,
      "effective-start-timestamp": effectiveStartTimestamp
    });
  }
  async *iterateForecourts(effectiveStartTimestamp) {
    yield* this.iterateBatches(
      (batchNumber) => this.fetchForecourtBatch(batchNumber, effectiveStartTimestamp)
    );
  }
  async *iteratePriceStations(effectiveStartTimestamp) {
    yield* this.iterateBatches(
      (batchNumber) => this.fetchPriceBatch(batchNumber, effectiveStartTimestamp)
    );
  }
  async *iterateBatches(fetchBatch) {
    for (let batchNumber = 1; ; batchNumber += 1) {
      try {
        const batch = await fetchBatch(batchNumber);
        if (batch.length === 0) {
          break;
        }
        yield batch;
        if (batch.length < FUEL_FINDER_BATCH_SIZE) {
          break;
        }
      } catch (error) {
        if (error instanceof FuelFinderApiError && error.status === 404 && batchNumber > 1) {
          break;
        }
        throw error;
      }
    }
  }
};
var fuelFinderClient = new FuelFinderClient();

// src/lib/sync-fuel-data.ts
var UPSERT_CHUNK_SIZE = 50;
function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
function buildAddress(station) {
  const location = station.location;
  if (!location) {
    return null;
  }
  const addressParts = [
    location.address_line_1,
    location.address_line_2,
    location.city,
    location.county
  ].filter((part) => Boolean(part));
  return addressParts.length > 0 ? addressParts.join(", ") : null;
}
function toNumber(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
async function upsertForecourtBatch(batch) {
  const stations = batch.map((station) => {
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
      lng: longitude
    };
  }).filter((station) => station !== null);
  for (const stationChunk of chunkArray(stations, UPSERT_CHUNK_SIZE)) {
    await prisma.$transaction(
      stationChunk.map(
        (station) => prisma.station.upsert({
          where: { id: station.id },
          update: station,
          create: station
        })
      )
    );
  }
  return stations.length;
}
function normalizePriceBatch(batch) {
  const rows = [];
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
        timestamp
      });
    }
  }
  rows.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  return rows;
}
async function insertChangedPrices(batch) {
  const incomingRows = normalizePriceBatch(batch);
  if (incomingRows.length === 0) {
    return 0;
  }
  const stationIds = [...new Set(incomingRows.map((row) => row.stationId))];
  const knownStations = await prisma.station.findMany({
    where: {
      id: { in: stationIds }
    },
    select: {
      id: true
    }
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
        in: [...knownStationIds]
      },
      fuelType: {
        in: ["unleaded", "diesel"]
      }
    },
    _max: {
      timestamp: true
    }
  });
  const latestRows = latestGroups.length === 0 ? [] : await prisma.priceHistory.findMany({
    where: {
      OR: latestGroups.filter((group) => group._max.timestamp !== null).map((group) => ({
        stationId: group.stationId,
        fuelType: group.fuelType,
        timestamp: group._max.timestamp
      }))
    }
  });
  const latestByStationAndFuel = new Map(
    latestRows.map((row) => [`${row.stationId}:${row.fuelType}`, row])
  );
  const rowsToInsert = [];
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
    skipDuplicates: true
  });
  return rowsToInsert.length;
}
async function syncFuelDataInternal() {
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
    const durationSeconds = Number(((Date.now() - startedAt) / 1e3).toFixed(1));
    return {
      success: true,
      message: `Synced ${syncedStations} stations across ${stationBatchCount} batches and inserted ${insertedPriceChanges} changed prices across ${priceBatchCount} batches in ${durationSeconds}s.`,
      stats: {
        stationBatchCount,
        priceBatchCount,
        syncedStations,
        insertedPriceChanges,
        durationSeconds
      }
    };
  } catch (error) {
    console.error("Sync failed:", error);
    const messageParts = [];
    if (error instanceof Error) {
      messageParts.push(error.message);
      const details = "details" in error && typeof error.details === "string" && error.details.length > 0 ? error.details : null;
      if (details) {
        messageParts.push(details);
      }
    }
    return {
      success: false,
      error: messageParts.length > 0 ? messageParts.join(": ") : "Unknown sync error"
    };
  }
}

// src/lambda/sync-fuel-data.ts
async function handler() {
  try {
    const result = await syncFuelDataInternal();
    if (!result.success) {
      console.error("Lambda sync failed:", result.error);
      throw new Error(result.error);
    }
    console.log(result.message);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=sync-fuel-data.js.map
