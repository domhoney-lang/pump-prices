'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Webpack
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapProps {
  stations: any[];
  fuelType: string;
  onStationSelect: (stationId: string) => void;
}

export default function Map({ stations, fuelType, onStationSelect }: MapProps) {
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stations.map((station) => {
          // Find the latest price for the selected fuel type
          const latestPrice = station.prices?.find(
            (p: any) => p.fuelType.toLowerCase() === fuelType.toLowerCase()
          )?.price;

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
