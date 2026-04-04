'use client';

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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

type StationMarkerEntry = {
  station: StationMapRecord;
  icon: L.DivIcon;
};

const DEFAULT_CENTER: [number, number] = [54.5, -3.0];
const DEFAULT_ZOOM = 6;

function emitBounds(map: L.Map, onViewportChange: (bounds: StationBoundsInput) => void) {
  try {
    const bounds = map.getBounds();
    onViewportChange({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    });
  } catch {
    // Leaflet can briefly expose a stale map during Fast Refresh teardown.
  }
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

    try {
      map.flyTo([focusLocation.lat, focusLocation.lng], Math.max(map.getZoom(), 13), {
        animate: true,
        duration: 1,
      });
    } catch {
      // Ignore stale-map errors during Fast Refresh.
    }
  }, [focusLocation, map]);

  return null;
}

const StationMarkers = memo(function StationMarkers({
  markers,
  onStationSelect,
}: {
  markers: StationMarkerEntry[];
  onStationSelect: (stationId: string) => void;
}) {
  return (
    <>
      {markers.map(({ station, icon }) => {
        return (
          <Marker
            key={station.id}
            position={[station.lat, station.lng]}
            icon={icon}
            eventHandlers={{
              click: () => onStationSelect(station.id),
            }}
          />
        );
      })}
    </>
  );
});

export default function Map({
  stations,
  fuelType,
  focusLocation,
  onStationSelect,
  onViewportChange,
}: MapProps) {
  const mapInstanceKeyRef = useRef(`map-${Math.random().toString(36).slice(2)}`);
  const normalizedFuelType = fuelType.toLowerCase();

  const stationPrices = useMemo(() => {
    return stations.map((station) => {
      const latestCurrentPrice = station.currentPrices.find(
        (price) => price.fuelType.toLowerCase() === normalizedFuelType,
      )?.price;
      const fallbackPrice = station.prices.find(
        (price) => price.fuelType.toLowerCase() === normalizedFuelType,
      )?.price;

      return {
        station,
        latestPrice: latestCurrentPrice ?? fallbackPrice,
      };
    });
  }, [normalizedFuelType, stations]);

  const { cheapThreshold, expensiveThreshold, absoluteCheapestPrice } = useMemo(() => {
    const validPrices = stationPrices
      .map((entry) => entry.latestPrice)
      .filter((price): price is number => price !== undefined)
      .sort((a, b) => a - b);

    if (validPrices.length === 0) {
      return {
        cheapThreshold: 0,
        expensiveThreshold: Infinity,
        absoluteCheapestPrice: null as number | null,
      };
    }

    const cheapIndex = Math.floor(validPrices.length * 0.2);
    const expensiveIndex = Math.floor(validPrices.length * 0.8);

    return {
      cheapThreshold: validPrices[cheapIndex] || validPrices[0],
      expensiveThreshold: validPrices[expensiveIndex] || validPrices[validPrices.length - 1],
      absoluteCheapestPrice: validPrices[0],
    };
  }, [stationPrices]);

  const getPriceColorClasses = useCallback((price: number | undefined) => {
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
  }, [cheapThreshold, expensiveThreshold]);

  const createCustomIcon = useCallback((price: number | undefined, isCheapest: boolean) => {
    const priceText = price ? `${price.toFixed(1)}p` : 'N/A';
    const width = Math.max(48, priceText.length * 10 + 20);
    const height = 30;
    const colors = getPriceColorClasses(price);

    return L.divIcon({
      className: 'custom-marker',
      html: `<div class="relative group cursor-pointer drop-shadow-md">
               ${isCheapest ? `<div class="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm z-10 tracking-widest whitespace-nowrap border border-amber-300">BEST</div>` : ''}
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
  }, [getPriceColorClasses]);

  const stationMarkers = useMemo(() => {
    return stationPrices.map(({ station, latestPrice }) => ({
      station,
      icon: createCustomIcon(
        latestPrice,
        latestPrice !== undefined && latestPrice === absoluteCheapestPrice,
      ),
    }));
  }, [absoluteCheapestPrice, createCustomIcon, stationPrices]);

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        key={mapInstanceKeyRef.current}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
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
        <StationMarkers markers={stationMarkers} onStationSelect={onStationSelect} />
      </MapContainer>
    </div>
  );
}
