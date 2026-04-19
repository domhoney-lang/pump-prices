'use client';

import type { CSSProperties } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { MapPin, Navigation } from 'lucide-react';
import { useMemo, useState, type Ref } from 'react';

import type { PriceBenchmark, StationMapRecord } from '@/app/actions/stations';
import { getPriceScale, getPriceTextClassName, getPriceTone } from '@/lib/price-colors';

const FIXED_REFUEL_VOLUME_LITRES = 50;
const gbpFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type FocusLocation = {
  lat: number;
  lng: number;
};

interface NearbyStationsListProps {
  stations: StationMapRecord[];
  fuelType: 'unleaded' | 'diesel';
  priceBenchmark: PriceBenchmark | null;
  listOrigin: FocusLocation | null;
  originLabel: string;
  loading: boolean;
  selectedStationId: string | null;
  onStationSelect: (stationId: string) => void;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLElement>;
}

type NearbyStationListItem = {
  station: StationMapRecord;
  price: number | null;
  refuelCostText: string | null;
  averageComparisonText: string | null;
  averageComparisonClassName: string | null;
  freshnessLabel: 'Fresh' | 'Still good' | 'Stale' | null;
  freshnessBadgeClassName: string | null;
  freshnessRelativeText: string | null;
  freshnessTitle: string | null;
  distanceMiles: number;
};

type NearbySortMode = 'cheapest' | 'nearest';

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMiles(origin: FocusLocation, station: Pick<StationMapRecord, 'lat' | 'lng'>) {
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(station.lat - origin.lat);
  const lngDelta = toRadians(station.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const stationLat = toRadians(station.lat);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(stationLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getFreshnessTone(updatedAt: Date) {
  const ageHours = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);

  if (ageHours < 48) {
    return {
      badgeClassName: 'bg-emerald-100 text-emerald-700',
      label: 'Fresh' as const,
    };
  }

  if (ageHours < 144) {
    return {
      badgeClassName: 'bg-amber-100 text-amber-700',
      label: 'Still good' as const,
    };
  }

  return {
    badgeClassName: 'bg-rose-100 text-rose-700',
    label: 'Stale' as const,
  };
}

function formatDistanceMiles(distanceMiles: number) {
  if (distanceMiles < 0.1) {
    return '<0.1 mi';
  }

  if (distanceMiles < 10) {
    return `${distanceMiles.toFixed(1)} mi`;
  }

  return `${Math.round(distanceMiles)} mi`;
}

function getDirectionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function formatRefuelCost(pricePence: number, litres: number) {
  return `${litres}L: ${gbpFormatter.format((pricePence * litres) / 100)}`;
}

function getAverageComparison(
  pricePence: number | null,
  averagePricePence: number | null,
  litres: number,
) {
  if (pricePence === null || averagePricePence === null) {
    return null;
  }

  const differenceGbp = ((averagePricePence - pricePence) * litres) / 100;

  if (Math.abs(differenceGbp) < 0.05) {
    return {
      className: 'text-gray-500',
      text: 'In line with nearby avg',
    };
  }

  const formattedDifference = gbpFormatter.format(Math.abs(differenceGbp));

  if (differenceGbp > 0) {
    return {
      className: 'text-emerald-700',
      text: `${formattedDifference} below nearby avg`,
    };
  }

  return {
    className: 'text-amber-700',
    text: `${formattedDifference} above nearby avg`,
  };
}

export default function NearbyStationsList({
  stations,
  fuelType,
  priceBenchmark,
  listOrigin,
  originLabel,
  loading,
  selectedStationId,
  onStationSelect,
  className,
  style,
  containerRef,
}: NearbyStationsListProps) {
  const [sortMode, setSortMode] = useState<NearbySortMode>('cheapest');
  const priceScale = useMemo(() => {
    if (priceBenchmark) {
      return priceBenchmark.fuelScales[fuelType];
    }

    const normalizedFuelType = fuelType.toLowerCase();

    return getPriceScale(
      stations.map((station) => {
        const latestCurrentPrice = station.currentPrices.find(
          (price) => price.fuelType === normalizedFuelType,
        );
        const fallbackPrice = station.fallbackPrices.find(
          (price) => price.fuelType === normalizedFuelType,
        );

        return latestCurrentPrice?.price ?? fallbackPrice?.price;
      }),
    );
  }, [fuelType, priceBenchmark, stations]);

  const nearbyStations = useMemo<NearbyStationListItem[]>(() => {
    if (!listOrigin) {
      return [];
    }

    const normalizedFuelType = fuelType.toLowerCase();
    const nearbyAveragePrice = priceBenchmark?.fuelSummaries[fuelType].averagePrice ?? null;

    return stations
      .map((station) => {
        const latestCurrentPrice = station.currentPrices.find(
          (price) => price.fuelType === normalizedFuelType,
        );
        const fallbackPrice = station.fallbackPrices.find(
          (price) => price.fuelType === normalizedFuelType,
        );
        const price = latestCurrentPrice?.price ?? fallbackPrice?.price ?? null;
        const freshnessTimestamp = latestCurrentPrice?.timestamp
          ? new Date(latestCurrentPrice.timestamp)
          : fallbackPrice?.timestamp
            ? new Date(fallbackPrice.timestamp)
            : null;
        const freshnessTone = freshnessTimestamp ? getFreshnessTone(freshnessTimestamp) : null;
        const averageComparison = getAverageComparison(
          price,
          nearbyAveragePrice,
          FIXED_REFUEL_VOLUME_LITRES,
        );

        return {
          station,
          price,
          refuelCostText:
            price !== null ? formatRefuelCost(price, FIXED_REFUEL_VOLUME_LITRES) : null,
          averageComparisonText: averageComparison?.text ?? null,
          averageComparisonClassName: averageComparison?.className ?? null,
          distanceMiles: getDistanceMiles(listOrigin, station),
          freshnessLabel: freshnessTone?.label ?? null,
          freshnessBadgeClassName: freshnessTone?.badgeClassName ?? null,
          freshnessRelativeText: freshnessTimestamp
            ? `Updated ${formatDistanceToNow(freshnessTimestamp, { addSuffix: true })}`
            : null,
          freshnessTitle: freshnessTimestamp
            ? `Price reported ${format(freshnessTimestamp, 'PPpp')}`
            : null,
        };
      })
      .sort((left, right) => {
        if (sortMode === 'cheapest') {
          if (left.price === null && right.price === null) {
            if (left.distanceMiles !== right.distanceMiles) {
              return left.distanceMiles - right.distanceMiles;
            }

            return left.station.id.localeCompare(right.station.id);
          }

          if (left.price === null) {
            return 1;
          }

          if (right.price === null) {
            return -1;
          }

          if (left.price !== right.price) {
            return left.price - right.price;
          }

          if (left.distanceMiles !== right.distanceMiles) {
            return left.distanceMiles - right.distanceMiles;
          }

          return left.station.id.localeCompare(right.station.id);
        }

        if (left.distanceMiles !== right.distanceMiles) {
          return left.distanceMiles - right.distanceMiles;
        }

        if (left.price === null && right.price === null) {
          return left.station.id.localeCompare(right.station.id);
        }

        if (left.price === null) {
          return 1;
        }

        if (right.price === null) {
          return -1;
        }

        if (left.price !== right.price) {
          return left.price - right.price;
        }

        return left.station.id.localeCompare(right.station.id);
      })
      .slice(0, 10);
  }, [fuelType, listOrigin, priceBenchmark, sortMode, stations]);

  if (!listOrigin) {
    return null;
  }
  const noPricesForFuel =
    nearbyStations.length > 0 && nearbyStations.every((station) => station.price === null);

  return (
    <section
      ref={containerRef}
      style={style}
      className={`pointer-events-auto rounded-2xl border border-gray-100 bg-white/90 p-4 shadow-xl backdrop-blur-md ${
        className ?? ''
      }`}
      aria-label="Nearby stations"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
            Nearby Stations
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {sortMode === 'nearest'
              ? `Sorted by nearest to ${originLabel}`
              : 'Sorted by cheapest nearby'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
            <Navigation className="h-3.5 w-3.5" />
            <span>Top 10</span>
          </div>
          <div className="inline-flex items-center rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-600">
            <button
              type="button"
              onClick={() => setSortMode('cheapest')}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                sortMode === 'cheapest' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'
              }`}
              aria-pressed={sortMode === 'cheapest'}
            >
              Cheapest
            </button>
            <button
              type="button"
              onClick={() => setSortMode('nearest')}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                sortMode === 'nearest' ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-800'
              }`}
              aria-pressed={sortMode === 'nearest'}
            >
              Nearest
            </button>
          </div>
        </div>
      </div>

      {loading && nearbyStations.length === 0 ? (
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          Finding nearby stations...
        </div>
      ) : nearbyStations.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          No stations in the current nearby area. Try zooming out or moving the map.
        </div>
      ) : (
        <>
          {noPricesForFuel && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Nearby stations were found, but none currently have {fuelType} prices in the nearby
              benchmark area.
            </div>
          )}

          <div className="mt-4 max-h-[24dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-[45dvh]">
            {nearbyStations.map((item) => {
              const priceTextClassName = getPriceTextClassName(getPriceTone(item.price, priceScale));

              return (
                <div
                  key={item.station.id}
                  className={`block w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    selectedStationId === item.station.id
                      ? 'border-blue-200 bg-blue-50/80'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onStationSelect(item.station.id)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
                        {item.station.brand || 'Unknown Brand'}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.freshnessLabel && item.freshnessBadgeClassName && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.freshnessBadgeClassName}`}
                            title={item.freshnessTitle ?? undefined}
                          >
                            {item.freshnessLabel}
                          </span>
                        )}
                        <span
                          className="text-xs text-gray-500"
                          title={item.freshnessTitle ?? undefined}
                        >
                          {item.freshnessRelativeText ?? 'No recent timestamp'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`text-lg font-bold ${priceTextClassName}`}>
                          {item.price !== null ? `${item.price.toFixed(1)}p` : 'N/A'}
                        </div>
                        <div className="text-xs text-gray-500">{fuelType}</div>
                        {item.refuelCostText && (
                          <div className="mt-1 text-xs font-medium text-gray-700">
                            {item.refuelCostText}
                          </div>
                        )}
                        {item.averageComparisonText && item.averageComparisonClassName && (
                          <div
                            className={`mt-1 text-[11px] font-medium ${item.averageComparisonClassName}`}
                          >
                            {item.averageComparisonText}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                      <MapPin className="h-3.5 w-3.5" />
                      {formatDistanceMiles(item.distanceMiles)}
                    </span>
                    <a
                      href={getDirectionsUrl(item.station.lat, item.station.lng)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open directions in Google Maps"
                      title="Open in Google Maps"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                    >
                      <Navigation className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
