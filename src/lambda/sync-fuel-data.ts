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

export async function handler(event?: LambdaSyncEvent) {
  try {
    const result = await syncFuelDataInternal({
      mode: getSyncModeFromEvent(event),
    });

    if (!result.success) {
      console.error("Lambda sync failed:", result.error);
      throw new Error(result.error);
    }

    console.info(result.message);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}
