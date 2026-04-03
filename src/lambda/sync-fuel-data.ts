import { prisma } from "../lib/prisma";
import { syncFuelDataInternal } from "../lib/sync-fuel-data";

export async function handler() {
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
