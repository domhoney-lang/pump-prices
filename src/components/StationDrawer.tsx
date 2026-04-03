'use client';

import { Drawer } from 'vaul';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays } from 'date-fns';

import type { StationDetailRecord } from '@/app/actions/stations';

interface StationDrawerProps {
  station: StationDetailRecord | null;
  isOpen: boolean;
  onClose: () => void;
  fuelType: 'unleaded' | 'diesel';
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
  )?.price;
  const latestHistoricalPrice = relevantPrices.at(-1)?.price ?? null;
  const latestPrice = latestCurrentPrice ?? latestHistoricalPrice;

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="bg-white flex flex-col rounded-t-[10px] h-[50vh] mt-24 fixed bottom-0 left-0 right-0 z-50 shadow-xl">
          <div className="p-4 bg-white rounded-t-[10px] flex-1 overflow-y-auto">
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-300 mb-6" />
            
            <div className="max-w-md mx-auto">
              <h2 className="text-xl font-bold text-gray-900 mb-1">{station.brand || 'Unknown Brand'}</h2>
              <p className="text-gray-500 text-sm mb-4">
                {station.address}{station.postcode ? `, ${station.postcode}` : ''}
              </p>

              <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-100 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500 capitalize">{fuelType}</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {latestPrice ? `${latestPrice.toFixed(1)}p` : 'N/A'}
                  </p>
                </div>
              </div>

              <h3 className="text-md font-semibold text-gray-800 mb-3">Last 7 Days (Price Fluctuation)</h3>
              
              <div className="h-48 w-full bg-white border border-gray-100 rounded-lg pt-4 pb-2 pr-4">
                {chartData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis 
                        dataKey="date" 
                        fontSize={12} 
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis 
                        domain={['dataMin - 1', 'dataMax + 1']} 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value.toFixed(1)}`}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value) => [`${Number(value ?? 0).toFixed(1)}p`, 'Price']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="price" 
                        stroke="#2563eb" 
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
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
