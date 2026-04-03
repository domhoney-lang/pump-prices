'use server';

import { syncFuelDataInternal } from '@/lib/sync-fuel-data';

export async function syncFuelData() {
  return syncFuelDataInternal();
}
