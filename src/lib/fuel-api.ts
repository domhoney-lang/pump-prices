export const FUEL_API_BASE = "https://api.fuelfinder.service.gov.uk/v1";
const FUEL_FINDER_BATCH_SIZE = 500;

export type SupportedFuelType = "unleaded" | "diesel";

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface FuelFinderLocation {
  latitude?: number | string | null;
  longitude?: number | string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
  postcode?: string | null;
}

export interface FuelFinderForecourt {
  node_id: string;
  trading_name: string;
  brand_name?: string | null;
  public_phone_number?: string | null;
  location?: FuelFinderLocation | null;
  fuel_types?: string[] | null;
}

export interface FuelFinderPrice {
  fuel_type: string;
  price: number | string | null;
  price_last_updated?: string | null;
  price_change_effective_timestamp?: string | null;
}

export interface FuelFinderPriceStation {
  node_id: string;
  trading_name: string;
  fuel_prices: FuelFinderPrice[];
}

class FuelFinderApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FuelFinderApiError";
  }
}

function getRequiredFuelFinderEnv(name: "FUEL_FINDER_CLIENT_ID" | "FUEL_FINDER_CLIENT_SECRET") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function normalizeFuelType(value: string): SupportedFuelType | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  if (["unleaded", "petrol", "e10", "e5", "premiumunleaded"].includes(normalized)) {
    return "unleaded";
  }

  if (["diesel", "b7", "premiumdiesel"].includes(normalized)) {
    return "diesel";
  }

  return null;
}

export function getPriceTimestamp(price: FuelFinderPrice): Date | null {
  const sourceValue = price.price_change_effective_timestamp ?? price.price_last_updated;

  if (!sourceValue) {
    return null;
  }

  const parsed = new Date(sourceValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class FuelFinderClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_ID"),
      client_secret: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_SECRET"),
    });

    const response = await fetch(`${FUEL_API_BASE}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new FuelFinderApiError(
        `Failed to fetch Fuel Finder token (${response.status})`,
        response.status,
      );
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000;

    return this.accessToken;
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    const token = await this.getAccessToken();
    const url = new URL(`${FUEL_API_BASE}${path}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const message = `Fuel Finder request failed for ${path} (${response.status})`;
      throw new FuelFinderApiError(message, response.status);
    }

    return (await response.json()) as T;
  }

  async fetchForecourtBatch(batchNumber: number, effectiveStartTimestamp?: string) {
    return this.request<FuelFinderForecourt[]>("/pfs", {
      "batch-number": batchNumber,
      "effective-start-timestamp": effectiveStartTimestamp,
    });
  }

  async fetchPriceBatch(batchNumber: number, effectiveStartTimestamp?: string) {
    return this.request<FuelFinderPriceStation[]>("/pfs/fuel-prices", {
      "batch-number": batchNumber,
      "effective-start-timestamp": effectiveStartTimestamp,
    });
  }

  async *iterateForecourts(effectiveStartTimestamp?: string): AsyncGenerator<FuelFinderForecourt[]> {
    yield* this.iterateBatches((batchNumber) =>
      this.fetchForecourtBatch(batchNumber, effectiveStartTimestamp),
    );
  }

  async *iteratePriceStations(
    effectiveStartTimestamp?: string,
  ): AsyncGenerator<FuelFinderPriceStation[]> {
    yield* this.iterateBatches((batchNumber) =>
      this.fetchPriceBatch(batchNumber, effectiveStartTimestamp),
    );
  }

  private async *iterateBatches<T>(
    fetchBatch: (batchNumber: number) => Promise<T[]>,
  ): AsyncGenerator<T[]> {
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
}

export const fuelFinderClient = new FuelFinderClient();
