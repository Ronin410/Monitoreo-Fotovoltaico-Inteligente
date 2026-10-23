'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { MapPlant } from '@/lib/dashboard';
import { formatNumber } from '@/lib/format';
import { STATUS, StatusBadge } from './status';

// Mapa de la flota (specs/09): un marcador por planta con el color y la forma de su estado.
// Se carga solo en el navegador (Leaflet usa window).

function markerIcon(status: MapPlant['status'], kwp: number): L.DivIcon {
  const s = STATUS[status];
  const size = kwp >= 30 ? 20 : 15;
  const base = `width:${size}px;height:${size}px;box-sizing:border-box;`;
  const style = {
    circle: `${base}border-radius:50%;background:${s.marker};border:2px solid #fff;box-shadow:0 0 0 1px ${s.marker}`,
    diamond: `${base}background:${s.marker};border:2px solid #fff;box-shadow:0 0 0 1px ${s.marker};transform:rotate(45deg) scale(.85)`,
    square: `${base}border-radius:3px;background:${s.marker};border:2px solid #fff;box-shadow:0 0 0 1px ${s.marker}`,
    ring: `${base}border-radius:50%;background:#fff;border:4px solid ${s.marker}`,
  }[s.shape];
  return L.divIcon({
    className: '',
    html: `<span style="display:block;${style}"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function FitBounds({ plants }: { plants: MapPlant[] }) {
  const map = useMap();
  useEffect(() => {
    if (plants.length === 0) return;
    map.fitBounds(L.latLngBounds(plants.map((p) => [p.lat, p.lon])), {
      padding: [32, 32],
      maxZoom: 15,
    });
  }, [map, plants]);
  return null;
}

export default function FleetMap({ plants }: { plants: MapPlant[] }) {
  const center = useMemo<[number, number]>(
    () => (plants[0] ? [plants[0].lat, plants[0].lon] : [24.8069, -107.3938]),
    [plants],
  );
  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom={false}
      className="h-full w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds plants={plants} />
      {plants.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={markerIcon(p.status, p.capacity_kwp)}
          title={`${p.name}: ${STATUS[p.status].label}`}
          alt={`${p.name}: ${STATUS[p.status].label}`}
        >
          <Popup>
            <div className="flex flex-col gap-1 text-sm">
              <strong>{p.name}</strong>
              <span>
                {p.client_name} · {p.colonia}
              </span>
              <span>{formatNumber(p.capacity_kwp, 1)} kWp</span>
              <StatusBadge status={p.status} />
              <Link href={`/plants/${p.id}`}>Ver planta</Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
