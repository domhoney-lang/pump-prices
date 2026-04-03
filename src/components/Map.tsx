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

  const createCustomIcon = (price: number | undefined) => {
    const priceText = price ? price.toFixed(1) : 'N/A';
    return L.divIcon({
      className: 'custom-marker',
      html: `<div class="bg-blue-600 text-white font-bold px-2 py-1 rounded-md shadow-md text-sm whitespace-nowrap border border-white">
               ${priceText}p
             </div>`,
      iconSize: [40, 24],
      iconAnchor: [20, 24],
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
