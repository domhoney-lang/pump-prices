import { prisma } from "../src/lib/prisma";
import { syncFuelDataInternal, type FuelSyncMode } from "../src/lib/sync-fuel-data";

function getSyncModeFromArgs(): FuelSyncMode {
  const modeArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--mode="))
    ?.split("=")[1];

  if (!modeArg || modeArg === "incremental") {
    return "incremental";
  }

  if (modeArg === "full-price-backfill") {
    return "full-price-backfill";
  }

  throw new Error(`Unsupported sync mode: ${modeArg}`);
}

async function main() {
  const mode = getSyncModeFromArgs();
  const result = await syncFuelDataInternal({ mode });

  if (!result.success) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(result.message);
  console.log(JSON.stringify(result.stats, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
