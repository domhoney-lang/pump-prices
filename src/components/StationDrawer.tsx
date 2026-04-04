'use client';

import { Drawer } from 'vaul';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, formatDistanceToNow, subDays } from 'date-fns';

import type { StationDetailRecord } from '@/app/actions/stations';

interface StationDrawerProps {
  station: StationDetailRecord | null;
  isOpen: boolean;
  onClose: () => void;
  fuelType: 'unleaded' | 'diesel';
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

export default function StationDrawer({ station, isOpen, onClose, fuelType }: StationDrawerProps) {
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
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-8" />
            
            <div className="max-w-md mx-auto">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">{station.brand || 'Unknown Brand'}</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {station.address}{station.postcode ? `, ${station.postcode}` : ''}
                </p>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-indigo-50/30 rounded-2xl p-5 mb-8 border border-blue-100/50 flex justify-between items-center shadow-sm">
                <div>
                  <p className="text-sm font-medium text-blue-600/80 uppercase tracking-wider mb-1">{fuelType}</p>
                  <p className="text-4xl font-extrabold text-blue-700 tracking-tight">
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
