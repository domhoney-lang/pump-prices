'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
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
  selectedStationId: string | null;
  onStationSelect: (stationId: string) => void;
  onViewportChange: (bounds: StationBoundsInput) => void;
}

type StationMarkerEntry = {
  station: StationMapRecord;
  latestPrice: number | undefined;
  icon: L.DivIcon;
};

type StationClusterEntry = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  hasSelected: boolean;
};

type StationClusterAggregate = {
  markers: StationMarkerEntry[];
  latSum: number;
  lngSum: number;
  count: number;
  hasSelected: boolean;
};

const DEFAULT_CENTER: [number, number] = [54.5, -3.0];
const DEFAULT_ZOOM = 6;
const CLUSTER_ZOOM_THRESHOLD = 12;
const CLUSTER_STATION_THRESHOLD = 120;

function emitBounds(map: L.Map, onViewportChange: (bounds: StationBoundsInput) => void) {
  try {
    const bounds = map.getBounds();
    const center = map.getCenter();
    onViewportChange({
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
      centerLat: center.lat,
      centerLng: center.lng,
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

function ZoomSync({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    },
  });

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

const StationClusters = memo(function StationClusters({
  clusters,
}: {
  clusters: StationClusterEntry[];
}) {
  const map = useMap();

  return (
    <>
      {clusters.map((cluster) => {
        const size = cluster.count < 10 ? 34 : cluster.count < 100 ? 40 : 46;
        const label = cluster.count > 99 ? '99+' : `${cluster.count}`;
        const markerStyle = [
          `width:${size}px`,
          `height:${size}px`,
          cluster.hasSelected
            ? 'box-shadow: 0 0 0 4px rgba(147, 197, 253, 0.95), 0 10px 20px rgba(15, 23, 42, 0.25);'
            : 'box-shadow: 0 10px 20px rgba(15, 23, 42, 0.22);',
        ].join(';');

        return (
          <Marker
            key={cluster.key}
            position={[cluster.lat, cluster.lng]}
            icon={L.divIcon({
              className: 'station-cluster-marker',
              html: `<div style="${markerStyle}" class="flex items-center justify-center rounded-full border-2 border-white bg-sky-600 text-sm font-bold text-white">${label}</div>`,
              iconSize: [size, size],
              iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
            })}
            eventHandlers={{
              click: () => {
                map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 15), {
                  animate: true,
                  duration: 0.5,
                });
              },
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
  selectedStationId,
  onStationSelect,
  onViewportChange,
}: MapProps) {
  const mapInstanceKey = useId();
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const normalizedFuelType = fuelType.toLowerCase();

  const stationPrices = useMemo(() => {
    return stations.map((station) => {
      const latestCurrentPrice = station.currentPrices.find(
        (price) => price.fuelType === normalizedFuelType,
      )?.price;
      const fallbackPrice = station.fallbackPrices.find(
        (price) => price.fuelType === normalizedFuelType,
      )?.price;

      return {
        station,
        latestPrice: latestCurrentPrice ?? fallbackPrice,
      };
    });
  }, [normalizedFuelType, stations]);

  const shouldClusterMarkers =
    stations.length > CLUSTER_STATION_THRESHOLD && mapZoom < CLUSTER_ZOOM_THRESHOLD;

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

  const createCustomIcon = useCallback((
    price: number | undefined,
    isCheapest: boolean,
    isSelected: boolean,
  ) => {
    const priceText = price ? `${price.toFixed(1)}p` : 'N/A';
    const width = Math.max(48, priceText.length * 10 + 20);
    const height = 30;
    const colors = getPriceColorClasses(price);
    const selectionClasses = isSelected
      ? {
          ring: 'opacity-100 scale-110',
          pill: 'ring-4 ring-blue-300 ring-offset-2 ring-offset-white scale-105 shadow-xl',
          pointer: 'border-t-blue-500',
        }
      : {
          ring: 'opacity-0 group-hover:opacity-100',
          pill: '',
          pointer: '',
        };

    return L.divIcon({
      className: 'custom-marker',
      html: `<div class="relative group cursor-pointer drop-shadow-md">
               ${isCheapest ? `<div class="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm z-10 tracking-widest whitespace-nowrap border border-emerald-600">BEST</div>` : ''}
               <div class="absolute -inset-1 ${colors.ring} rounded-full blur-sm transition-all ${selectionClasses.ring}"></div>
               <div class="relative ${colors.bg} text-white font-bold px-2.5 py-1 rounded-full text-sm whitespace-nowrap border-2 border-white ${colors.hoverBg} ${selectionClasses.pill} transition-all flex items-center justify-center">
                 ${priceText}
               </div>
               <div class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white"></div>
               <div class="absolute -bottom-[4px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] ${colors.border} ${colors.hoverBorder} ${selectionClasses.pointer} transition-colors"></div>
             </div>`,
      iconSize: [width, height],
      iconAnchor: [Math.round(width / 2), height + 6],
    });
  }, [getPriceColorClasses]);

  const stationMarkers = useMemo(() => {
    return stationPrices.map(({ station, latestPrice }) => ({
      station,
      latestPrice,
      icon: createCustomIcon(
        latestPrice,
        latestPrice !== undefined && latestPrice === absoluteCheapestPrice,
        station.id === selectedStationId,
      ),
    }));
  }, [absoluteCheapestPrice, createCustomIcon, selectedStationId, stationPrices]);

  const clusteredMarkers = useMemo<StationClusterEntry[]>(() => {
    if (!shouldClusterMarkers) {
      return [];
    }

    const cellSize = Math.max(0.004, 0.4 / 2 ** Math.max(mapZoom - DEFAULT_ZOOM, 0));
    const clusters = new globalThis.Map<
      string,
      StationClusterAggregate
    >();

    for (const marker of stationMarkers) {
      const latBucket = Math.floor(marker.station.lat / cellSize);
      const lngBucket = Math.floor(marker.station.lng / cellSize);
      const key = `${latBucket}:${lngBucket}`;
      const existingCluster = clusters.get(key);

      if (existingCluster) {
        existingCluster.markers.push(marker);
        existingCluster.latSum += marker.station.lat;
        existingCluster.lngSum += marker.station.lng;
        existingCluster.count += 1;
        existingCluster.hasSelected ||= marker.station.id === selectedStationId;
        continue;
      }

      clusters.set(key, {
        markers: [marker],
        latSum: marker.station.lat,
        lngSum: marker.station.lng,
        count: 1,
        hasSelected: marker.station.id === selectedStationId,
      });
    }

    return Array.from(clusters.entries()).map(([key, cluster]) => {
      const centroidLat = cluster.latSum / cluster.count;
      const centroidLng = cluster.lngSum / cluster.count;
      const anchorMarker = cluster.markers.reduce((closestMarker, currentMarker) => {
        const closestDistance =
          (closestMarker.station.lat - centroidLat) ** 2 +
          (closestMarker.station.lng - centroidLng) ** 2;
        const currentDistance =
          (currentMarker.station.lat - centroidLat) ** 2 +
          (currentMarker.station.lng - centroidLng) ** 2;

        return currentDistance < closestDistance ? currentMarker : closestMarker;
      }, cluster.markers[0]);

      return {
        key,
        lat: anchorMarker.station.lat,
        lng: anchorMarker.station.lng,
        count: cluster.count,
        hasSelected: cluster.hasSelected,
      };
    });
  }, [mapZoom, selectedStationId, shouldClusterMarkers, stationMarkers]);

  return (
    <div className="absolute inset-0 z-0">
      <MapContainer
        key={mapInstanceKey}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        zoomControl={false}
      >
        <ViewportSync onViewportChange={onViewportChange} />
        <ZoomSync onZoomChange={setMapZoom} />
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
        {shouldClusterMarkers ? (
          <StationClusters clusters={clusteredMarkers} />
        ) : (
          <StationMarkers markers={stationMarkers} onStationSelect={onStationSelect} />
        )}
      </MapContainer>
    </div>
  );
}
