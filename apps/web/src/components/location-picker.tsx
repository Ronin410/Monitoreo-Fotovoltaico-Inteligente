'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

// Ubicación del cliente en el mapa (specs/09 §Clientes): un clic fija el punto y el marcador se
// puede arrastrar. Las coordenadas también se pueden escribir a mano en el formulario.

const PIN = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#DC2626;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

const CULIACAN: [number, number] = [24.8069, -107.3938];

function ClickToPlace({ onChange }: { onChange: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onChange(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FollowPoint({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    // Sin animación: si la página cambia a media animación, Leaflet falla (_leaflet_pos).
    if (point) map.setView(point, Math.max(map.getZoom(), 15), { animate: false });
  }, [map, point]);
  return null;
}

export default function LocationPicker({
  lat,
  lon,
  onChange,
}: {
  lat: number | null;
  lon: number | null;
  onChange: (lat: number, lon: number) => void;
}) {
  const point: [number, number] | null = lat !== null && lon !== null ? [lat, lon] : null;
  return (
    <MapContainer
      center={point ?? CULIACAN}
      zoom={point ? 16 : 12}
      className="h-72 w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPlace onChange={onChange} />
      <FollowPoint point={point} />
      {point && (
        <Marker
          position={point}
          icon={PIN}
          draggable
          title="Ubicación del cliente (arrastra para ajustar)"
          eventHandlers={{
            dragend: (e) => {
              const p = (e.target as L.Marker).getLatLng();
              onChange(p.lat, p.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
