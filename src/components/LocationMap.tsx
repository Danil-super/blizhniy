"use client";

import { MapPin, Navigation } from "lucide-react";
import { YandexMapView } from "@/components/YandexMapPicker";
import { hasMapCoordinates } from "@/lib/map-location";

export type MapLocation = {
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hasMapPoint?: boolean;
  showExactAddress: boolean;
};

function displayLocation(location: MapLocation) {
  if (location.showExactAddress && location.address) {
    return `${location.city}, ${location.address}`;
  }

  return [location.city, location.district].filter(Boolean).join(", ");
}

function publicCoordinate(value?: number, exact = false) {
  if (typeof value !== "number") {
    return undefined;
  }

  return exact ? value : Number(value.toFixed(2));
}

function routeUrl(location: MapLocation) {
  const lat = publicCoordinate(location.lat, location.showExactAddress);
  const lng = publicCoordinate(location.lng, location.showExactAddress);
  const query = hasMapCoordinates(lat, lng) ? `${lat},${lng}` : displayLocation(location);

  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(query)}&rtt=auto`;
}

export function LocationMap({ location, exactLabel = "Точный адрес скрыт" }: { location: MapLocation; exactLabel?: string }) {
  const label = displayLocation(location);
  const hasPoint = (location.hasMapPoint ?? true) && hasMapCoordinates(location.lat, location.lng);
  const publicLat = publicCoordinate(location.lat, location.showExactAddress);
  const publicLng = publicCoordinate(location.lng, location.showExactAddress);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#060b27]">Карта и местоположение</h2>
          <p className="mt-2 flex items-center gap-2 text-slate-600">
            <MapPin className="h-5 w-5 text-[#0875d1]" />
            {label}
          </p>
          {!location.showExactAddress ? <p className="mt-2 text-sm text-slate-500">{exactLabel}. Показана примерная зона.</p> : null}
        </div>
        {hasPoint ? (
          <a
            href={routeUrl(location)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0875d1] px-4 font-bold text-[#0875d1] transition hover:bg-blue-50"
          >
            <Navigation className="h-5 w-5" />
            Построить маршрут
          </a>
        ) : null}
      </div>
      {hasPoint && hasMapCoordinates(publicLat, publicLng) ? (
        <YandexMapView lat={publicLat as number} lng={publicLng as number} label={label} />
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-semibold text-slate-600">Метка на карте не указана.</div>
      )}
    </section>
  );
}
