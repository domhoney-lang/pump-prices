'use client';

import { Drawer } from 'vaul';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { MapPin, Navigation, X } from 'lucide-react';

import type {
  NationalPriceBenchmark,
  PriceBenchmark,
  StationDetailRecord,
  StationMapRecord,
} from '@/app/actions/stations';
import {
  getPriceScale,
  getPriceSurfaceClassName,
  getPriceTextClassName,
  getPriceTone,
} from '@/lib/price-colors';

const PRICE_HISTORY_WINDOW_DAYS = 30;

type FocusLocation = {
  lat: number;
  lng: number;
};

interface StationDrawerProps {
  station: StationDetailRecord | null;
  stations: StationMapRecord[];
  isOpen: boolean;
  onClose: () => void;
  fuelType: 'unleaded' | 'diesel';
  priceBenchmark: PriceBenchmark | null;
  nationalPriceBenchmark: NationalPriceBenchmark | null;
  focusLocation: FocusLocation | null;
}

type PriceInsight = {
  arrow: '↑' | '↓' | '→';
  amountText: string;
  description: string;
  className: string;
};

function getFreshnessTone(updatedAt: Date) {
  const ageHours = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);

  if (ageHours < 24) {
    return {
      badgeClassName: 'bg-emerald-100 text-emerald-700',
      label: 'Fresh',
    };
  }

  if (ageHours < 48) {
    return {
      badgeClassName: 'bg-amber-100 text-amber-700',
      label: 'Still good',
    };
  }

  return {
    badgeClassName: 'bg-rose-100 text-rose-700',
    label: 'Stale',
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMiles(origin: FocusLocation, destination: Pick<StationDetailRecord, 'lat' | 'lng'>) {
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(destination.lat - origin.lat);
  const lngDelta = toRadians(destination.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
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

function getPriceInsight(
  latestPrice: number | null,
  referencePrice: number | null,
  description: string,
): PriceInsight | null {
  if (latestPrice === null || referencePrice === null) {
    return null;
  }

  const difference = latestPrice - referencePrice;

  if (Math.abs(difference) < 0.05) {
    return {
      arrow: '→',
      amountText: '0.0p',
      description,
      className: 'border-gray-200 bg-gray-50 text-gray-600',
    };
  }

  const isAboveReference = difference > 0;

  return {
    arrow: isAboveReference ? '↑' : '↓',
    amountText: `${Math.abs(difference).toFixed(1)}p`,
    description,
    className: isAboveReference
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
}

function getBenchmarkInsight(
  latestPrice: number | null,
  benchmarkPrice: number | null,
  benchmarkLabel: string,
): PriceInsight | null {
  if (latestPrice === null || benchmarkPrice === null) {
    return null;
  }

  const difference = latestPrice - benchmarkPrice;

  if (Math.abs(difference) < 0.05) {
    return getPriceInsight(latestPrice, benchmarkPrice, `in line with ${benchmarkLabel}`);
  }

  return getPriceInsight(
    latestPrice,
    benchmarkPrice,
    `${difference > 0 ? 'above' : 'below'} ${benchmarkLabel}`,
  );
}

export default function StationDrawer({
  station,
  stations,
  isOpen,
  onClose,
  fuelType,
  priceBenchmark,
  nationalPriceBenchmark,
  focusLocation,
}: StationDrawerProps) {
  if (!station) return null;

  const latestCurrentPrice = station.currentPrices.find(
    (price) => price.fuelType.toLowerCase() === fuelType.toLowerCase()
  );
  const relevantPrices = station.prices
    .filter((price) => price.fuelType.toLowerCase() === fuelType.toLowerCase())
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const priceTimeline = [
    ...relevantPrices.map((price) => ({
      price: price.price,
      timestamp: new Date(price.timestamp),
    })),
    ...(latestCurrentPrice
      ? [
          {
            price: latestCurrentPrice.price,
            timestamp: new Date(latestCurrentPrice.timestamp),
          },
        ]
      : []),
  ]
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .filter(
      (entry, index, entries) =>
        index === 0 ||
        entry.price !== entries[index - 1]?.price ||
        entry.timestamp.getTime() !== entries[index - 1]?.timestamp.getTime(),
    );
  const priceHistoryWindowStart = subDays(new Date(), PRICE_HISTORY_WINDOW_DAYS);
  const chartData = priceTimeline
    .filter((entry) => entry.timestamp >= priceHistoryWindowStart)
    .map((entry) => ({
      date: format(entry.timestamp, 'MMM dd'),
      price: entry.price,
    }));
  const latestTimelineEntry = priceTimeline.at(-1) ?? null;
  const previousTimelineEntry = priceTimeline.at(-2) ?? null;
  const latestPrice = latestTimelineEntry?.price ?? null;
  const localAveragePrice = priceBenchmark?.fuelSummaries[fuelType].averagePrice ?? null;
  const nationalAveragePrice =
    nationalPriceBenchmark?.fuelSummaries[fuelType].averagePrice ?? null;
  const priceInsights = [
    getPriceInsight(
      latestPrice,
      previousTimelineEntry?.price ?? null,
      'since last price update',
    ),
    getBenchmarkInsight(latestPrice, localAveragePrice, 'local average'),
    getBenchmarkInsight(latestPrice, nationalAveragePrice, 'national average'),
  ].filter((insight): insight is PriceInsight => insight !== null);
  const priceScale =
    priceBenchmark?.fuelScales[fuelType] ??
    getPriceScale(
      stations.map((mapStation) => {
        const currentPrice = mapStation.currentPrices.find(
          (price) => price.fuelType === fuelType.toLowerCase(),
        );
        const fallbackPrice = mapStation.fallbackPrices.find(
          (price) => price.fuelType === fuelType.toLowerCase(),
        );

        return currentPrice?.price ?? fallbackPrice?.price;
      }),
    );
  const priceTone = getPriceTone(latestPrice, priceScale);
  const freshnessTimestamp = latestTimelineEntry?.timestamp ?? null;
  const freshnessTone = freshnessTimestamp ? getFreshnessTone(freshnessTimestamp) : null;
  const freshnessLabel = freshnessTimestamp
    ? `${formatDistanceToNow(freshnessTimestamp, { addSuffix: true })}`
    : null;
  const freshnessTitle = freshnessTimestamp
    ? `Price reported ${format(freshnessTimestamp, 'PPpp')}`
    : undefined;
  const distanceMiles = focusLocation ? getDistanceMiles(focusLocation, station) : null;
  const priceSurfaceClassName = getPriceSurfaceClassName(priceTone);
  const priceTextClassName = getPriceTextClassName(priceTone);

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="bg-white flex flex-col rounded-t-[10px] h-[50vh] mt-24 fixed bottom-0 left-0 right-0 z-50 shadow-xl">
          <div className="p-6 bg-white rounded-t-[10px] flex-1 overflow-y-auto">
            <Drawer.Title className="sr-only">
              {station.brand || 'Unknown Brand'} station details
            </Drawer.Title>
            <Drawer.Description className="sr-only">
              {station.address}
              {station.postcode ? `, ${station.postcode}` : ''}. Showing {fuelType} pricing and
              the last {PRICE_HISTORY_WINDOW_DAYS} days of price history.
            </Drawer.Description>
            <div className="relative mb-5 flex items-center justify-center">
              <div className="h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-200" />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close station details"
                className="absolute right-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-w-md mx-auto">
              <div className="mb-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-2xl font-bold tracking-tight text-gray-900">
                    {station.brand || 'Unknown Brand'}
                  </h2>
                  <div className="flex shrink-0 items-center gap-2">
                    {distanceMiles !== null && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{formatDistanceMiles(distanceMiles)}</span>
                      </div>
                    )}
                    <a
                      href={getDirectionsUrl(station.lat, station.lng)}
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
                <p className="mt-2 text-sm uppercase tracking-wide text-gray-500">
                  {station.address}
                  {station.postcode ? `, ${station.postcode}` : ''}
                </p>
              </div>

              <div
                className={`mb-8 rounded-3xl border p-6 shadow-sm ${priceSurfaceClassName}`}
              >
                <div className="w-full">
                  <p className="mb-2 text-sm font-medium uppercase tracking-widest text-slate-500">
                    {fuelType}
                  </p>
                  <p className={`mb-4 text-5xl font-bold tracking-tight ${priceTextClassName}`}>
                    {latestPrice ? `${latestPrice.toFixed(1)}p` : 'N/A'}
                  </p>
                  {freshnessLabel ? (
                    <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${freshnessTone?.badgeClassName}`}
                        title={freshnessTitle}
                      >
                        {freshnessTone?.label}
                      </span>
                      <span title={freshnessTitle} className="font-medium">Updated {freshnessLabel}</span>
                    </div>
                  ) : (
                    <p className="mb-6 text-sm text-slate-500">No recent price timestamp available.</p>
                  )}
                  {priceInsights.length > 0 && (
                    <div className="space-y-2.5">
                      {priceInsights.map((insight) => (
                        <div
                          key={insight.description}
                          className={`flex items-center justify-between gap-3 rounded-full border px-4 py-2.5 text-sm ${insight.className}`}
                        >
                          <span className="font-bold whitespace-nowrap">
                            {insight.arrow} {insight.amountText}
                          </span>
                          <span className="text-right font-medium opacity-90">{insight.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 tracking-wide uppercase">Price History</h3>
                <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
                  Last {PRICE_HISTORY_WINDOW_DAYS} Days
                </span>
              </div>
              
              <div className="h-56 w-full bg-white border border-gray-100 rounded-2xl pt-5 pb-3 pr-5 shadow-sm">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis 
                        dataKey="date" 
                        fontSize={12} 
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                        tick={{ fill: '#6b7280' }}
                      />
                      <YAxis 
                        domain={['dataMin - 1', 'dataMax + 1']} 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value.toFixed(1)}`}
                        tick={{ fill: '#6b7280' }}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '12px', 
                          border: '1px solid #e5e7eb', 
                          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                          padding: '8px 12px',
                          fontWeight: 500
                        }}
                        itemStyle={{ color: '#1f2937', fontWeight: 600 }}
                        formatter={(value) => [`${Number(value ?? 0).toFixed(1)}p`, 'Price']}
                        labelStyle={{ color: '#6b7280', marginBottom: '4px', fontSize: '12px' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="price" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                        activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2, fill: '#ffffff' }}
                        animationDuration={1000}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm font-medium">
                    No price data for the last {PRICE_HISTORY_WINDOW_DAYS} days.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
