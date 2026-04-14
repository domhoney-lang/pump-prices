export const FUEL_API_BASE = "https://www.fuel-finder.service.gov.uk/api/v1";
const FUEL_FINDER_BATCH_SIZE = 500;
const FUEL_FINDER_TOKEN_MAX_ATTEMPTS = 3;
const FUEL_FINDER_TOKEN_RETRY_DELAY_MS = 1_000;
const FUEL_FINDER_TRANSIENT_STATUSES = new Set([502, 503, 504]);

export type SupportedFuelType = "unleaded" | "diesel";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface WrappedTokenResponse {
  data?: TokenResponse;
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
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
    public readonly details?: string,
  ) {
    super(message);
    this.name = "FuelFinderApiError";
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimResponseBody(value: string, maxLength = 500) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated]`;
}

function getResponseDiagnostics(response: Response, responseBody?: string) {
  const headers = [
    "content-type",
    "server",
    "via",
    "x-cache",
    "x-amz-cf-pop",
    "x-amz-cf-id",
    "x-request-id",
    "retry-after",
  ].reduce<Record<string, string>>((result, headerName) => {
    const value = response.headers.get(headerName);

    if (value) {
      result[headerName] = value;
    }

    return result;
  }, {});

  return JSON.stringify({
    status: response.status,
    statusText: response.statusText,
    headers,
    body: responseBody ? trimResponseBody(responseBody) : undefined,
  });
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

  const regularUnleadedLabels = new Set(["unleaded", "petrol", "e10"]);
  const premiumUnleadedLabels = new Set([
    "e5",
    "premiumunleaded",
    "premiumpetrol",
    "superunleaded",
    "superpetrol",
  ]);
  const regularDieselLabels = new Set(["diesel", "b7", "b7standard"]);
  const premiumDieselLabels = new Set([
    "premiumdiesel",
    "superdiesel",
    "premiumb7",
    "superb7",
    "b7premium",
    "b10",
  ]);

  const isPremiumUnleaded =
    premiumUnleadedLabels.has(normalized) ||
    normalized.startsWith("e5") ||
    ((normalized.includes("premium") || normalized.includes("super")) &&
      (normalized.includes("unleaded") || normalized.includes("petrol")));

  if (isPremiumUnleaded) {
    return null;
  }

  if (regularUnleadedLabels.has(normalized) || normalized.startsWith("e10")) {
    return "unleaded";
  }

  const isPremiumDiesel =
    premiumDieselLabels.has(normalized) ||
    normalized.startsWith("b10") ||
    normalized.includes("hvo") ||
    ((normalized.includes("premium") || normalized.includes("super")) &&
      (normalized.includes("diesel") || normalized.includes("b7")));

  if (isPremiumDiesel) {
    return null;
  }

  if (regularDieselLabels.has(normalized)) {
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

function isMissingBatchError(details?: string) {
  if (!details) {
    return false;
  }

  return details.includes("Requested batch") && details.includes("is not available");
}

export class FuelFinderClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const payload = JSON.stringify({
      client_id: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_ID"),
      client_secret: getRequiredFuelFinderEnv("FUEL_FINDER_CLIENT_SECRET"),
    });

    let lastError: FuelFinderApiError | null = null;

    for (let attempt = 1; attempt <= FUEL_FINDER_TOKEN_MAX_ATTEMPTS; attempt += 1) {
      let response: Response;

      try {
        response = await fetch(`${FUEL_API_BASE}/oauth/generate_access_token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: payload,
          cache: "no-store",
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        lastError = new FuelFinderApiError("Failed to reach Fuel Finder token endpoint", 0, details);

        if (attempt < FUEL_FINDER_TOKEN_MAX_ATTEMPTS) {
          console.warn(
            "[fuel-sync] Retrying Fuel Finder token fetch after network error",
            JSON.stringify({
              attempt,
              maxAttempts: FUEL_FINDER_TOKEN_MAX_ATTEMPTS,
              details,
            }),
          );
          await delay(FUEL_FINDER_TOKEN_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw lastError;
      }

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        const details = getResponseDiagnostics(response, responseBody);
        lastError = new FuelFinderApiError(
          `Failed to fetch Fuel Finder token (${response.status})`,
          response.status,
          details,
        );

        if (
          FUEL_FINDER_TRANSIENT_STATUSES.has(response.status) &&
          attempt < FUEL_FINDER_TOKEN_MAX_ATTEMPTS
        ) {
          console.warn(
            "[fuel-sync] Retrying Fuel Finder token fetch after transient upstream error",
            JSON.stringify({
              attempt,
              maxAttempts: FUEL_FINDER_TOKEN_MAX_ATTEMPTS,
              status: response.status,
              diagnostics: details,
            }),
          );
          await delay(FUEL_FINDER_TOKEN_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw lastError;
      }

      const rawData = (await response.json()) as WrappedTokenResponse;
      const data = rawData.data ?? rawData;

      if (!data.access_token || !data.expires_in) {
        throw new FuelFinderApiError(
          "Fuel Finder token response was missing required fields",
          response.status,
          JSON.stringify(rawData),
        );
      }

      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000;

      return this.accessToken;
    }

    throw lastError ?? new FuelFinderApiError("Failed to fetch Fuel Finder token", 0);
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    const token = await this.getAccessToken();
    const url = new URL(`${FUEL_API_BASE}${path}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;

    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new FuelFinderApiError(`Failed to reach Fuel Finder endpoint for ${path}`, 0, details);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const message = `Fuel Finder request failed for ${path} (${response.status})`;
      throw new FuelFinderApiError(message, response.status, responseBody || undefined);
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
    yield* this.iterateBatches(
      (batchNumber) => this.fetchForecourtBatch(batchNumber, effectiveStartTimestamp),
      {
        allowInitialBatch404: Boolean(effectiveStartTimestamp),
      },
    );
  }

  async *iteratePriceStations(
    effectiveStartTimestamp?: string,
  ): AsyncGenerator<FuelFinderPriceStation[]> {
    yield* this.iterateBatches(
      (batchNumber) => this.fetchPriceBatch(batchNumber, effectiveStartTimestamp),
      {
        allowInitialBatch404: Boolean(effectiveStartTimestamp),
      },
    );
  }

  private async *iterateBatches<T>(
    fetchBatch: (batchNumber: number) => Promise<T[]>,
    options?: {
      allowInitialBatch404?: boolean;
    },
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
        if (error instanceof FuelFinderApiError && error.status === 404) {
          if (batchNumber > 1) {
            break;
          }

          if (options?.allowInitialBatch404 && isMissingBatchError(error.details)) {
            break;
          }
        }

        throw error;
      }
    }
  }
}

export const fuelFinderClient = new FuelFinderClient();
