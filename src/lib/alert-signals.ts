import type { AlertBaselineEntry } from './alert-baseline-store';
import { formatFreshnessBandLabel, getFreshnessTone, type FreshnessTone } from './freshness';
import { formatNearbyRadiusShortText, formatNearbyRadiusText } from './nearby-benchmark';

export type AlertFuelType = 'unleaded' | 'diesel';

export type AlertPriceRecord = {
  fuelType: string;
  price: number;
  timestamp: Date | string;
};

export type StationAlertSignalKind = 'bestWithin3Miles' | 'priceDrop' | 'freshnessTransition';
export type StationAlertSignalTone = 'blue' | 'emerald' | 'amber' | 'rose';

export type StationAlertSignal = {
  detail: string;
  kind: StationAlertSignalKind;
  priority: number;
  shortLabel: string;
  tone: StationAlertSignalTone;
  value: number;
};

export type StationAlertState = {
  baselineEntry: AlertBaselineEntry;
  brand: string | null;
  freshnessTone: FreshnessTone | null;
  fuelType: AlertFuelType;
  latestPrice: number | null;
  latestTimestamp: Date | null;
  previousPrice: number | null;
  primarySignal: StationAlertSignal | null;
  signals: StationAlertSignal[];
  stationId: string;
};

export type AlertSummary = {
  counts: Record<StationAlertSignalKind, number>;
  primaryAlert: (StationAlertState & { signal: StationAlertSignal }) | null;
  totalStations: number;
};

type BuildStationAlertStateInput = {
  baseline?: AlertBaselineEntry | null;
  brand: string | null;
  currentPrices: AlertPriceRecord[];
  fuelType: AlertFuelType;
  historicalPrices: AlertPriceRecord[];
  isBestWithinRadius?: boolean;
  radiusMiles: number;
  stationId: string;
};

type TimelineEntry = {
  price: number;
  timestamp: Date;
};

function toTimelineEntry(record: AlertPriceRecord): TimelineEntry | null {
  if (typeof record.price !== 'number' || Number.isNaN(record.price)) {
    return null;
  }

  const timestamp = record.timestamp instanceof Date ? record.timestamp : new Date(record.timestamp);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return {
    price: record.price,
    timestamp,
  };
}

export function buildFuelPriceTimeline(
  currentPrices: AlertPriceRecord[],
  historicalPrices: AlertPriceRecord[],
  fuelType: AlertFuelType,
) {
  return [...historicalPrices, ...currentPrices]
    .filter((record) => record.fuelType.toLowerCase() === fuelType)
    .map(toTimelineEntry)
    .filter((entry): entry is TimelineEntry => entry !== null)
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .filter(
      (entry, index, entries) =>
        index === 0 ||
        entry.price !== entries[index - 1]?.price ||
        entry.timestamp.getTime() !== entries[index - 1]?.timestamp.getTime(),
    );
}

function compareSignals(left: StationAlertSignal, right: StationAlertSignal) {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  return right.value - left.value;
}

export function buildStationAlertState({
  baseline = null,
  brand,
  currentPrices,
  fuelType,
  historicalPrices,
  isBestWithinRadius = false,
  radiusMiles,
  stationId,
}: BuildStationAlertStateInput): StationAlertState {
  const priceTimeline = buildFuelPriceTimeline(currentPrices, historicalPrices, fuelType);
  const latestEntry = priceTimeline.at(-1) ?? null;
  const previousEntry = priceTimeline.at(-2) ?? null;
  const freshnessTone = latestEntry ? getFreshnessTone(latestEntry.timestamp) : null;
  const signals: StationAlertSignal[] = [];

  if (isBestWithinRadius && latestEntry) {
    signals.push({
      detail: `Cheapest ${fuelType} within ${formatNearbyRadiusText(radiusMiles)}.`,
      kind: 'bestWithin3Miles',
      priority: 0,
      shortLabel: `Best in ${formatNearbyRadiusShortText(radiusMiles)}`,
      tone: 'blue',
      value: latestEntry.price,
    });
  }

  if (latestEntry && previousEntry && latestEntry.price < previousEntry.price) {
    const deltaPence = previousEntry.price - latestEntry.price;

    signals.push({
      detail: `Down ${deltaPence.toFixed(1)}p since the last reported update.`,
      kind: 'priceDrop',
      priority: 1,
      shortLabel: `Down ${deltaPence.toFixed(1)}p`,
      tone: 'emerald',
      value: deltaPence,
    });
  }

  if (baseline?.freshnessBand && freshnessTone && baseline.freshnessBand !== freshnessTone.band) {
    const previousFreshnessLabel = formatFreshnessBandLabel(baseline.freshnessBand)?.toLowerCase();
    const currentFreshnessLabel = freshnessTone.label.toLowerCase();

    signals.push({
      detail: previousFreshnessLabel
        ? `Freshness moved from ${previousFreshnessLabel} to ${currentFreshnessLabel}.`
        : `Freshness is now ${currentFreshnessLabel}.`,
      kind: 'freshnessTransition',
      priority: 2,
      shortLabel:
        freshnessTone.band === 'stale'
          ? 'Now stale'
          : freshnessTone.band === 'fresh'
            ? 'Fresh again'
            : 'Now still good',
      tone:
        freshnessTone.band === 'stale'
          ? 'rose'
          : freshnessTone.band === 'fresh'
            ? 'emerald'
            : 'amber',
      value:
        freshnessTone.band === 'stale'
          ? 3
          : freshnessTone.band === 'still-good'
            ? 2
            : 1,
    });
  }

  signals.sort(compareSignals);

  return {
    baselineEntry: {
      stationId,
      fuelType,
      latestPrice: latestEntry?.price ?? null,
      latestTimestamp: latestEntry ? latestEntry.timestamp.toISOString() : null,
      freshnessBand: freshnessTone?.band ?? null,
      recordedAt: new Date().toISOString(),
    },
    brand,
    freshnessTone,
    fuelType,
    latestPrice: latestEntry?.price ?? null,
    latestTimestamp: latestEntry?.timestamp ?? null,
    previousPrice: previousEntry?.price ?? null,
    primarySignal: signals[0] ?? null,
    signals,
    stationId,
  };
}

export function summarizeStationAlertStates(states: StationAlertState[]): AlertSummary {
  const alertStates = states.filter((state) => state.signals.length > 0);
  const counts: AlertSummary['counts'] = {
    bestWithin3Miles: 0,
    priceDrop: 0,
    freshnessTransition: 0,
  };

  for (const state of alertStates) {
    const kinds = new Set(state.signals.map((signal) => signal.kind));

    for (const kind of kinds) {
      counts[kind] += 1;
    }
  }

  const primaryAlert = alertStates
    .filter((state): state is StationAlertState & { primarySignal: StationAlertSignal } =>
      state.primarySignal !== null,
    )
    .sort((left, right) => compareSignals(left.primarySignal, right.primarySignal))[0];

  return {
    counts,
    primaryAlert: primaryAlert
      ? {
          ...primaryAlert,
          signal: primaryAlert.primarySignal,
        }
      : null,
    totalStations: alertStates.length,
  };
}

export function getAlertSignalToneClassName(signal: Pick<StationAlertSignal, 'tone'>) {
  switch (signal.tone) {
    case 'blue':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'emerald':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'rose':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-700';
  }
}
