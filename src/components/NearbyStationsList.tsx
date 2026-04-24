'use client';

import type { CSSProperties } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState, type Ref } from 'react';

import type { PriceBenchmark, StationMapRecord } from '@/app/actions/stations';
import {
  getPriceScale,
  getPriceSurfaceClassName,
  getPriceTextClassName,
  getPriceTone,
} from '@/lib/price-colors';

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
  variant?: 'panel' | 'sheet';
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

function formatRefuelCost(pricePence: number, litres: number) {
  return `${litres}L ${gbpFormatter.format((pricePence * litres) / 100)}`;
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
  variant = 'panel',
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

  const processedNearbyStations = useMemo<NearbyStationListItem[]>(() => {
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
  }, [fuelType, listOrigin, priceBenchmark, stations]);

  const nearbyStations = useMemo(() => {
    return [...processedNearbyStations]
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
  }, [processedNearbyStations, sortMode]);

  const bestValueStationId = useMemo(() => {
    const bestValueStation = [...processedNearbyStations]
      .filter((station) => station.price !== null)
      .sort((left, right) => {
        if (left.price !== right.price) {
          return (left.price ?? Infinity) - (right.price ?? Infinity);
        }

        if (left.distanceMiles !== right.distanceMiles) {
          return left.distanceMiles - right.distanceMiles;
        }

        return left.station.id.localeCompare(right.station.id);
      })[0];

    return bestValueStation?.station.id ?? null;
  }, [processedNearbyStations]);

  if (!listOrigin) {
    return null;
  }
  const noPricesForFuel =
    nearbyStations.length > 0 && nearbyStations.every((station) => station.price === null);
  const isSheet = variant === 'sheet';
  const visibleCount = nearbyStations.length;
  const totalNearbyCount = processedNearbyStations.length;
  const sortDescription =
    sortMode === 'nearest' ? `sorted by nearest to ${originLabel}` : 'sorted by cheapest nearby';
  const subtitleText =
    totalNearbyCount > visibleCount
      ? `Top ${visibleCount} of ${totalNearbyCount} • ${sortDescription}`
      : `${totalNearbyCount} stations • ${sortDescription}`;

  return (
    <section
      ref={containerRef}
      style={style}
      className={`${
        isSheet
          ? 'flex h-full flex-col bg-white'
          : 'pointer-events-auto rounded-[28px] border border-gray-100 bg-white/92 p-4 shadow-xl backdrop-blur-md'
      } ${className ?? ''}`}
      aria-label="Nearby stations"
    >
      <div
        className={
          isSheet ? 'border-b border-gray-100 px-5 pb-4 pt-1' : 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'
        }
      >
        <div className={isSheet ? '' : 'min-w-0'}>
          <h2 className="text-base font-semibold tracking-tight text-gray-950">Nearby stations</h2>
          <p className="mt-1 text-sm text-gray-500">{subtitleText}</p>
        </div>
        <div className={`${isSheet ? 'mt-3 flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center gap-2'}`}>
          <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            Top {visibleCount}
          </div>
          <div className="inline-flex items-center rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-600">
            <button
              type="button"
              onClick={() => setSortMode('cheapest')}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                sortMode === 'cheapest'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              aria-pressed={sortMode === 'cheapest'}
            >
              Cheapest
            </button>
            <button
              type="button"
              onClick={() => setSortMode('nearest')}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                sortMode === 'nearest'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              aria-pressed={sortMode === 'nearest'}
            >
              Nearest
            </button>
          </div>
        </div>
      </div>

      {loading && nearbyStations.length === 0 ? (
        <div className={`${isSheet ? 'mx-5 mt-5' : 'mt-4'} rounded-2xl border border-gray-100 bg-gray-50 px-4 py-6 text-sm text-gray-500`}>
          Finding nearby stations...
        </div>
      ) : nearbyStations.length === 0 ? (
        <div className={`${isSheet ? 'mx-5 mt-5' : 'mt-4'} rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500`}>
          No stations in the current nearby area. Try zooming out or moving the map.
        </div>
      ) : (
        <>
          {noPricesForFuel && (
            <div className={`${isSheet ? 'mx-5 mt-5' : 'mt-4'} rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800`}>
              Nearby stations were found, but none currently have {fuelType} prices in the nearby
              benchmark area.
            </div>
          )}

          <div
            className={`${
              isSheet
                ? 'mt-5 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]'
                : 'mt-4 max-h-[24dvh] space-y-3 overflow-y-auto overscroll-contain pr-1 sm:max-h-[45dvh]'
            }`}
          >
            {nearbyStations.map((item) => {
              const priceTone = getPriceTone(item.price, priceScale);
              const priceTextClassName = getPriceTextClassName(priceTone);
              const priceSurfaceClassName = getPriceSurfaceClassName(priceTone);
              const isSelected = selectedStationId === item.station.id;
              const isBestValue = item.station.id === bestValueStationId;
              const showStaleBadge = item.freshnessLabel === 'Stale';

              return (
                <button
                  type="button"
                  key={item.station.id}
                  onClick={() => onStationSelect(item.station.id)}
                  className={`group block w-full rounded-[22px] border p-4 text-left transition-all ${
                    isSelected
                      ? 'border-blue-200 bg-blue-50/80 shadow-sm'
                      : isBestValue
                        ? 'border-emerald-200 bg-emerald-50/70 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex w-20 shrink-0 flex-col rounded-2xl border px-3 py-3 shadow-sm ${priceSurfaceClassName}`}
                    >
                      <span className={`text-2xl font-bold tracking-tight ${priceTextClassName}`}>
                        {item.price !== null ? `${item.price.toFixed(1)}p` : 'N/A'}
                      </span>
                      <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        {fuelType}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-gray-950">
                            {item.station.brand || 'Unknown Brand'}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {isBestValue && (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                Best value
                              </span>
                            )}
                            {showStaleBadge && item.freshnessBadgeClassName && (
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.freshnessBadgeClassName}`}
                                title={item.freshnessTitle ?? undefined}
                              >
                                {item.freshnessLabel}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-start gap-2 pl-2">
                          <div className="text-right">
                            <div className="text-sm font-semibold text-gray-950">
                              {formatDistanceMiles(item.distanceMiles)}
                            </div>
                            <div
                              className="mt-1 text-xs text-gray-500"
                              title={item.freshnessTitle ?? undefined}
                            >
                              {item.freshnessRelativeText ?? 'No recent update'}
                            </div>
                          </div>
                          <ChevronRight className="mt-0.5 h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
                        {item.averageComparisonText && item.averageComparisonClassName ? (
                          <span className={`font-semibold ${item.averageComparisonClassName}`}>
                            {item.averageComparisonText}
                          </span>
                        ) : (
                          <span className="text-gray-500">Price in line with nearby stations</span>
                        )}
                        {item.refuelCostText && (
                          <>
                            <span className="text-gray-300">•</span>
                            <span className="font-medium text-gray-500">{item.refuelCostText}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
