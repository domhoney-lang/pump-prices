'use client';

import { Drawer } from 'vaul';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { MapPin, Navigation, X } from 'lucide-react';

import type { PriceBenchmark, StationDetailRecord, StationMapRecord } from '@/app/actions/stations';
import {
  getPriceScale,
  getPriceSurfaceClassName,
  getPriceTextClassName,
  getPriceTone,
} from '@/lib/price-colors';

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
  focusLocation: FocusLocation | null;
}

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

export default function StationDrawer({
  station,
  stations,
  isOpen,
  onClose,
  fuelType,
  priceBenchmark,
  focusLocation,
}: StationDrawerProps) {
  if (!station) return null;

  const relevantPrices = station.prices
    .filter((price) => price.fuelType.toLowerCase() === fuelType.toLowerCase())
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const sevenDaysAgo = subDays(new Date(), 7);
  const chartData = relevantPrices
    .filter((price) => new Date(price.timestamp) >= sevenDaysAgo)
    .map((price) => ({
      date: format(new Date(price.timestamp), 'MMM dd'),
      price: price.price,
    }));

  const latestCurrentPrice = station.currentPrices.find(
    (price) => price.fuelType.toLowerCase() === fuelType.toLowerCase()
  );
  const latestHistoricalPrice = relevantPrices.at(-1)?.price ?? null;
  const latestPrice = latestCurrentPrice?.price ?? latestHistoricalPrice;
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
  const freshnessTimestamp = latestCurrentPrice?.timestamp
    ? new Date(latestCurrentPrice.timestamp)
    : relevantPrices.at(-1)?.timestamp
      ? new Date(relevantPrices.at(-1)!.timestamp)
      : null;
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
              the last 7 days of price history.
            </Drawer.Description>
            <div className="relative mb-8 flex items-center justify-center">
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
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">{station.brand || 'Unknown Brand'}</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {station.address}{station.postcode ? `, ${station.postcode}` : ''}
                </p>
                <div className="mt-3 flex items-center gap-2">
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

              <div
                className={`mb-8 flex items-center justify-between rounded-2xl border p-5 shadow-sm ${priceSurfaceClassName}`}
              >
                <div>
                  <p className="mb-1 text-sm font-medium uppercase tracking-wider text-gray-600">
                    {fuelType}
                  </p>
                  <p className={`text-4xl font-extrabold tracking-tight ${priceTextClassName}`}>
                    {latestPrice ? `${latestPrice.toFixed(1)}p` : 'N/A'}
                  </p>
                  {freshnessLabel ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${freshnessTone?.badgeClassName}`}
                        title={freshnessTitle}
                      >
                        {freshnessTone?.label}
                      </span>
                      <span title={freshnessTitle}>Updated {freshnessLabel}</span>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-gray-500">No recent price timestamp available.</p>
                  )}
                </div>
              </div>

              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 tracking-wide uppercase">Price History</h3>
                <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">Last 7 Days</span>
              </div>
              
              <div className="h-56 w-full bg-white border border-gray-100 rounded-2xl pt-5 pb-3 pr-5 shadow-sm">
                {chartData.length > 1 ? (
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
                    Not enough data for the last 7 days.
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
