import { MapPin, Navigation } from "lucide-react";

export type MapLocation = {
  city: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
  showExactAddress: boolean;
};

function displayLocation(location: MapLocation) {
  if (location.showExactAddress && location.address) {
    return `${location.city}, ${location.address}`;
  }

  return [location.city, location.district].filter(Boolean).join(", ");
}

function routeUrl(location: MapLocation) {
  const query = location.lat && location.lng ? `${location.lat},${location.lng}` : displayLocation(location);

  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(query)}&rtt=auto`;
}

export function LocationMap({ location, exactLabel = "Точный адрес скрыт" }: { location: MapLocation; exactLabel?: string }) {
  const label = displayLocation(location);

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
        <a
          href={routeUrl(location)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0875d1] px-4 font-bold text-[#0875d1] transition hover:bg-blue-50"
        >
          <Navigation className="h-5 w-5" />
          Построить маршрут
        </a>
      </div>
      <div className="relative mt-5 h-64 overflow-hidden rounded-xl border border-slate-200 bg-[linear-gradient(90deg,#e8eef5_1px,transparent_1px),linear-gradient(#e8eef5_1px,transparent_1px)] bg-[length:32px_32px]">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/70 via-white/20 to-emerald-50/70" />
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0875d1] text-white shadow-lg shadow-blue-200">
            <MapPin className="h-7 w-7" />
          </span>
          <span className="mt-2 max-w-56 rounded-lg bg-white px-3 py-2 text-center text-sm font-bold text-slate-700 shadow-card">{label}</span>
        </div>
        <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-slate-500">
          MVP-карта без внутренней маршрутизации
        </div>
      </div>
    </section>
  );
}
