import { prisma } from "../src/lib/prisma";
import { syncFuelDataInternal } from "../src/lib/sync-fuel-data";

async function main() {
  const result = await syncFuelDataInternal();

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
