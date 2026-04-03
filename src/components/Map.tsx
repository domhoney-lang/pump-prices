'use client';

import { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { StationBoundsInput, StationMapRecord } from '@/app/actions/stations';

// Fix for default marker icons in Leaflet with Webpack
type LeafletIconDefault = typeof L.Icon.Default.prototype & {
  _getIconUrl?: string;
};

delete (L.Icon.Default.prototype as LeafletIconDefault)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapProps {
  stations: StationMapRecord[];
  fuelType: 'unleaded' | 'diesel';
  focusLocation: { lat: number; lng: number } | null;
  onStationSelect: (stationId: string) => void;
  onViewportChange: (bounds: StationBoundsInput) => void;
}

function emitBounds(map: L.Map, onViewportChange: (bounds: StationBoundsInput) => void) {
  const bounds = map.getBounds();
  onViewportChange({
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  });
}

function ViewportSync({
  onViewportChange,
}: {
  onViewportChange: (bounds: StationBoundsInput) => void;
}) {
  const map = useMap();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    emitBounds(map, onViewportChange);
  }, [map, onViewportChange]);

  useMapEvents({
    moveend() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        emitBounds(map, onViewportChange);
      }, 150);
    },
    zoomend() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        emitBounds(map, onViewportChange);
      }, 150);
    },
  });

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  return null;
}

function FocusLocation({
  focusLocation,
}: {
  focusLocation: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!focusLocation) {
      return;
    }

    map.flyTo([focusLocation.lat, focusLocation.lng], Math.max(map.getZoom(), 13), {
      animate: true,
      duration: 1,
    });
  }, [focusLocation, map]);

  return null;
}

export default function Map({
  stations,
  fuelType,
  focusLocation,
  onStationSelect,
  onViewportChange,
}: MapProps) {
  // Center roughly on the UK
  const defaultCenter: [number, number] = [54.5, -3.0];
  const defaultZoom = 6;

  // Calculate price percentiles for color coding
  const validPrices = stations
    .map((station) => {
      const latestCurrent = station.currentPrices.find(
        (p) => p.fuelType.toLowerCase() === fuelType.toLowerCase()
      )?.price;
      const fallback = station.prices.find(
        (p) => p.fuelType.toLowerCase() === fuelType.toLowerCase()
      )?.price;
      return latestCurrent ?? fallback;
    })
    .filter((p): p is number => p !== undefined)
    .sort((a, b) => a - b);

  let cheapThreshold = 0;
  let expensiveThreshold = Infinity;

  if (validPrices.length > 0) {
    const cheapIndex = Math.floor(validPrices.length * 0.2); // Bottom 20%
    const expensiveIndex = Math.floor(validPrices.length * 0.8); // Top 20%
    
    cheapThreshold = validPrices[cheapIndex] || validPrices[0];
    expensiveThreshold = validPrices[expensiveIndex] || validPrices[validPrices.length - 1];
  }

  const getPriceColorClasses = (price: number | undefined) => {
    if (!price) return { bg: 'bg-gray-500', hoverBg: 'group-hover:bg-gray-600', border: 'border-t-gray-500', hoverBorder: 'group-hover:border-t-gray-600', ring: 'bg-gray-500/30' };
    
    if (price <= cheapThreshold) {
      // Green for bottom 20%
      return { bg: 'bg-emerald-600', hoverBg: 'group-hover:bg-emerald-700', border: 'border-t-emerald-600', hoverBorder: 'group-hover:border-t-emerald-700', ring: 'bg-emerald-600/30' };
    } else if (price >= expensiveThreshold) {
      // Red for top 20%
      return { bg: 'bg-rose-600', hoverBg: 'group-hover:bg-rose-700', border: 'border-t-rose-600', hoverBorder: 'group-hover:border-t-rose-700', ring: 'bg-rose-600/30' };
    }
    // Blue/Yellow/Neutral for the middle 60%
    return { bg: 'bg-amber-500', hoverBg: 'group-hover:bg-amber-600', border: 'border-t-amber-500', hoverBorder: 'group-hover:border-t-amber-600', ring: 'bg-amber-500/30' };
  };

  const createCustomIcon = (price: number | undefined) => {
    const priceText = price ? `${price.toFixed(1)}p` : 'N/A';
    const width = Math.max(48, priceText.length * 10 + 20);
    const height = 30;
    const colors = getPriceColorClasses(price);

    return L.divIcon({
      className: 'custom-marker',
      html: `<div class="relative group cursor-pointer drop-shadow-md">
               <div class="absolute -inset-1 ${colors.ring} rounded-full blur-sm opacity-0 group-hover:opacity-100 transition-opacity"></div>
               <div class="relative ${colors.bg} text-white font-bold px-2.5 py-1 rounded-full text-sm whitespace-nowrap border-2 border-white ${colors.hoverBg} transition-colors flex items-center justify-center">
                 ${priceText}
               </div>
               <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white"></div>
               <div class="absolute -bottom-[4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] ${colors.border} ${colors.hoverBorder} transition-colors"></div>
             </div>`,
      iconSize: [width, height],
      iconAnchor: [Math.round(width / 2), height + 6],
    });
  };

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        className="w-full h-full"
        zoomControl={false}
      >
        <ViewportSync onViewportChange={onViewportChange} />
        <FocusLocation focusLocation={focusLocation} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        {focusLocation && (
          <CircleMarker
            center={[focusLocation.lat, focusLocation.lng]}
            radius={10}
            pathOptions={{
              color: '#1d4ed8',
              fillColor: '#2563eb',
              fillOpacity: 0.45,
              weight: 2,
            }}
          />
        )}
        {stations.map((station) => {
          const latestCurrentPrice = station.currentPrices.find(
            (price) => price.fuelType.toLowerCase() === fuelType.toLowerCase()
          )?.price;
          const fallbackPrice = station.prices.find(
            (price) => price.fuelType.toLowerCase() === fuelType.toLowerCase()
          )?.price;
          const latestPrice = latestCurrentPrice ?? fallbackPrice;

          return (
            <Marker
              key={station.id}
              position={[station.lat, station.lng]}
              icon={createCustomIcon(latestPrice)}
              eventHandlers={{
                click: () => onStationSelect(station.id),
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
