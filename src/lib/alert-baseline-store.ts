import type { FreshnessBand } from './freshness';

const ALERT_BASELINE_STORAGE_KEY = 'pump-prices:visual-alert-baselines:v1';

export type AlertBaselineEntry = {
  stationId: string;
  fuelType: 'unleaded' | 'diesel';
  latestPrice: number | null;
  latestTimestamp: string | null;
  freshnessBand: FreshnessBand | null;
  recordedAt: string;
};

export type AlertBaselineSnapshot = Record<string, AlertBaselineEntry>;

export interface AlertBaselineStore {
  mergeEntries(entries: AlertBaselineEntry[]): void;
  readSnapshot(): AlertBaselineSnapshot;
}

export function getAlertBaselineKey(
  stationId: string,
  fuelType: AlertBaselineEntry['fuelType'],
) {
  return `${fuelType}:${stationId}`;
}

function isAlertBaselineEntry(value: unknown): value is AlertBaselineEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AlertBaselineEntry>;

  return (
    typeof candidate.stationId === 'string' &&
    (candidate.fuelType === 'unleaded' || candidate.fuelType === 'diesel') &&
    (typeof candidate.latestPrice === 'number' || candidate.latestPrice === null) &&
    (typeof candidate.latestTimestamp === 'string' || candidate.latestTimestamp === null) &&
    (candidate.freshnessBand === 'fresh' ||
      candidate.freshnessBand === 'still-good' ||
      candidate.freshnessBand === 'stale' ||
      candidate.freshnessBand === null) &&
    typeof candidate.recordedAt === 'string'
  );
}

function sanitizeAlertBaselineSnapshot(value: unknown): AlertBaselineSnapshot {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, AlertBaselineEntry] =>
      isAlertBaselineEntry(entry[1]),
    ),
  );
}

function readStoredSnapshot(): AlertBaselineSnapshot {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawSnapshot = window.localStorage.getItem(ALERT_BASELINE_STORAGE_KEY);

    if (!rawSnapshot) {
      return {};
    }

    return sanitizeAlertBaselineSnapshot(JSON.parse(rawSnapshot));
  } catch {
    return {};
  }
}

function writeStoredSnapshot(snapshot: AlertBaselineSnapshot) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(ALERT_BASELINE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures so alerts still render without persistence.
  }
}

export const browserAlertBaselineStore: AlertBaselineStore = {
  readSnapshot() {
    return readStoredSnapshot();
  },
  mergeEntries(entries) {
    if (entries.length === 0) {
      return;
    }

    const snapshot = readStoredSnapshot();

    for (const entry of entries) {
      snapshot[getAlertBaselineKey(entry.stationId, entry.fuelType)] = entry;
    }

    writeStoredSnapshot(snapshot);
  },
};
