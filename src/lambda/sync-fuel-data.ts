import { prisma } from "../lib/prisma";
import { syncFuelDataInternal, type FuelSyncMode } from "../lib/sync-fuel-data";

type LambdaSyncEvent = {
  mode?: FuelSyncMode;
};

function getSyncModeFromEvent(event: LambdaSyncEvent | null | undefined): FuelSyncMode {
  const mode = event?.mode;

  if (!mode || mode === "incremental") {
    return "incremental";
  }

  if (mode === "full-price-backfill") {
    return mode;
  }

  throw new Error(`Unsupported sync mode: ${String(mode)}`);
}

async function revalidateNationalBenchmarkCache() {
  const appUrl = process.env.APP_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!appUrl || !cronSecret) {
    console.warn(
      "Skipping national benchmark revalidation because APP_URL or CRON_SECRET is missing.",
    );
    return;
  }

  const response = await fetch(
    new URL("/api/internal/revalidate-national-benchmark", appUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `National benchmark revalidation failed with ${response.status} ${response.statusText}.`,
    );
  }
}

export async function handler(event?: LambdaSyncEvent) {
  try {
    const result = await syncFuelDataInternal({
      mode: getSyncModeFromEvent(event),
    });

    if (!result.success) {
      console.error("Lambda sync failed:", result.error);
      throw new Error(result.error);
    }

    await revalidateNationalBenchmarkCache();
    console.info(result.message);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}
