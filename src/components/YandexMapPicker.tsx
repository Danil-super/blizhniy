"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MapPin, Navigation, Search, X } from "lucide-react";

type YandexMapPickerProps = {
  defaultAddress?: string;
  defaultLat?: number;
  defaultLng?: number;
  addressName?: string;
  latName?: string;
  lngName?: string;
  mapPointSelectedName?: string;
  onPointSelectedChange?: (selected: boolean) => void;
};

type YandexMapViewProps = {
  lat: number;
  lng: number;
  label: string;
};

type LeafletLatLng = {
  lat: number;
  lng: number;
};

type LeafletMap = {
  invalidateSize: () => void;
  on: (eventName: "click", callback: (event: { latlng: LeafletLatLng }) => void) => void;
  remove: () => void;
  setView: (coords: [number, number], zoom?: number) => void;
};

type LeafletMarker = {
  addTo: (map: LeafletMap) => LeafletMarker;
  setLatLng: (coords: [number, number]) => LeafletMarker;
};

type LeafletTileLayer = {
  addTo: (map: LeafletMap) => LeafletTileLayer;
};

type LeafletGlobal = {
  map: (element: HTMLElement, options: { center: [number, number]; scrollWheelZoom?: boolean; zoom: number; zoomControl?: boolean }) => LeafletMap;
  marker: (coords: [number, number]) => LeafletMarker;
  tileLayer: (url: string, options: { attribution: string; maxZoom: number }) => LeafletTileLayer;
};

declare global {
  interface Window {
    L?: LeafletGlobal;
    __blizhniyLeafletPromise?: Promise<void>;
  }
}

const krasnodarCenter = { lat: 45.035, lng: 38.976 };
const resolvingAddressLabel = "Определяем адрес...";
const nominatimViewbox = "36.5,47.0,41.5,43.3";
const coordsPattern = /^-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?$/;
const leafletCssUrl = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const leafletScriptUrl = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function loadLeaflet() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Карта доступна только в браузере"));
  }

  if (window.L) {
    return Promise.resolve();
  }

  window.__blizhniyLeafletPromise ??= new Promise<void>((resolve, reject) => {
    const existingCss = document.querySelector<HTMLLinkElement>('link[data-blizhniy-leaflet-css="1"]');

    if (!existingCss) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = leafletCssUrl;
      link.dataset.blizhniyLeafletCss = "1";
      document.head.appendChild(link);
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-blizhniy-leaflet="1"]');

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Не удалось загрузить карту OpenStreetMap")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = leafletScriptUrl;
    script.async = true;
    script.dataset.blizhniyLeaflet = "1";
    script.onload = () => {
      if (window.L) {
        resolve();
        return;
      }

      reject(new Error("Библиотека карты не загрузилась"));
    };
    script.onerror = () => reject(new Error("Не удалось загрузить карту OpenStreetMap"));
    document.head.appendChild(script);
  });

  return window.__blizhniyLeafletPromise;
}

function routeUrl(lat: number, lng: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

function mapWidgetUrl(lat: number, lng: number) {
  const bbox = [lng - 0.01, lat - 0.006, lng + 0.01, lat + 0.006].map((value) => value.toFixed(6)).join("%2C");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function formatCoord(value: number) {
  return value.toFixed(6);
}

function normalizeSearchQuery(value: string) {
  const trimmed = value.trim();

  if (!trimmed || coordsPattern.test(trimmed)) {
    return trimmed;
  }

  if (/краснодар|сочи|новороссийск|анапа|геленджик|армавир|туапсе|ейск|краснодарский/i.test(trimmed)) {
    return trimmed;
  }

  return `Краснодар, ${trimmed}`;
}

function formatMapAddress(value: string) {
  const usedParts = new Set<string>();
  const noisyParts = new Set([
    "россия",
    "российская федерация",
    "южный федеральный округ",
    "краснодарский край",
    "городской округ краснодар",
    "муниципальное образование город краснодар",
  ]);
  const usefulParts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();

      if (/^\d{5,6}$/.test(key) || noisyParts.has(key) || usedParts.has(key)) {
        return false;
      }

      usedParts.add(key);
      return true;
    });

  return usefulParts.slice(0, 4).join(", ");
}

function parseCoords(value: string) {
  if (!coordsPattern.test(value.trim())) {
    return undefined;
  }

  const [latRaw, lngRaw] = value.split(",").map((part) => part.trim().replace(",", "."));
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
}

async function geocodeAddress(query: string) {
  const coords = parseCoords(query);

  if (coords) {
    return {
      address: `${formatCoord(coords.lat)}, ${formatCoord(coords.lng)}`,
      coords: [coords.lat, coords.lng] as [number, number],
    };
  }

  const params = new URLSearchParams({
    "accept-language": "ru",
    addressdetails: "1",
    countrycodes: "ru",
    format: "jsonv2",
    limit: "1",
    q: query,
    viewbox: nominatimViewbox,
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);

  if (!response.ok) {
    return undefined;
  }

  const [result] = (await response.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>;
  const lat = Number(result?.lat);
  const lng = Number(result?.lon);

  if (!result || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  return {
    address: formatMapAddress(result.display_name?.trim() || "") || query,
    coords: [lat, lng] as [number, number],
  };
}

async function reverseGeocode(coords: [number, number]) {
  const params = new URLSearchParams({
    "accept-language": "ru",
    addressdetails: "1",
    format: "jsonv2",
    lat: String(coords[0]),
    lon: String(coords[1]),
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);

  if (!response.ok) {
    return "";
  }

  const result = (await response.json()) as { display_name?: string };
  return formatMapAddress(result.display_name?.trim() || "");
}

function invalidateMapSize(map: LeafletMap | null) {
  window.setTimeout(() => map?.invalidateSize(), 80);
  window.setTimeout(() => map?.invalidateSize(), 320);
}

export function YandexMapPicker({
  addressName = "address",
  defaultAddress,
  defaultLat,
  defaultLng,
  latName = "lat",
  lngName = "lng",
  mapPointSelectedName = "mapPointSelected",
  onPointSelectedChange,
}: YandexMapPickerProps) {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const placemarkRef = useRef<LeafletMarker | null>(null);
  const latestSearchRef = useRef(0);
  const [point, setPoint] = useState(typeof defaultLat === "number" && typeof defaultLng === "number" ? { lat: defaultLat, lng: defaultLng } : null);
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [query, setQuery] = useState(defaultAddress ?? "");
  const [status, setStatus] = useState("Загрузка карты OpenStreetMap...");
  const [searching, setSearching] = useState(false);
  const center = point ?? krasnodarCenter;
  const initialPointRef = useRef(point);
  const initialCenterRef = useRef(center);

  useEffect(() => {
    onPointSelectedChange?.(Boolean(point));
  }, [onPointSelectedChange, point]);

  useEffect(() => {
    let cancelled = false;

    loadLeaflet()
      .then(() => {
        if (cancelled || !mapRef.current || mapInstanceRef.current || !window.L) {
          return;
        }

        const initialPoint = initialPointRef.current;
        const initialCenter = initialCenterRef.current;
        const map = window.L.map(mapRef.current, {
          center: [initialCenter.lat, initialCenter.lng],
          scrollWheelZoom: true,
          zoom: initialPoint ? 15 : 11,
          zoomControl: true,
        });

        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        mapInstanceRef.current = map;
        invalidateMapSize(map);
        setStatus("Кликните по карте, чтобы поставить метку");

        if (initialPoint) {
          placemarkRef.current = window.L.marker([initialPoint.lat, initialPoint.lng]).addTo(map);
        }

        map.on("click", (event) => {
          const coords: [number, number] = [event.latlng.lat, event.latlng.lng];
          const nextPoint = { lat: coords[0], lng: coords[1] };

          setPoint(nextPoint);
          setAddress("");
          setQuery(resolvingAddressLabel);
          setStatus("Определяем адрес по метке...");

          if (!window.L) {
            return;
          }

          if (!placemarkRef.current) {
            placemarkRef.current = window.L.marker(coords).addTo(map);
          } else {
            placemarkRef.current.setLatLng(coords);
          }

          const searchId = latestSearchRef.current + 1;
          latestSearchRef.current = searchId;

          reverseGeocode(coords)
            .then((nextAddress) => {
              if (searchId !== latestSearchRef.current) {
                return;
              }

              if (nextAddress) {
                setAddress(nextAddress);
                setQuery(nextAddress);
                setStatus("Адрес определен");
                return;
              }

              setQuery("");
              setStatus("Метка выбрана, но адрес определить не удалось");
            })
            .catch(() => {
              if (searchId === latestSearchRef.current) {
                setQuery("");
                setStatus("Метка выбрана, но адрес определить не удалось");
              }
            });
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("Карту OpenStreetMap не удалось загрузить. Проверьте сеть или блокировку CDN.");
        }
      });

    function onResize() {
      invalidateMapSize(mapInstanceRef.current);
    }

    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      placemarkRef.current = null;
    };
  }, []);

  function clearPoint() {
    setPoint(null);
    setAddress("");
    setQuery("");
    setStatus("Кликните по карте, чтобы поставить метку");

    mapInstanceRef.current?.setView([krasnodarCenter.lat, krasnodarCenter.lng], 11);
    placemarkRef.current = null;
  }

  const searchAddress = useCallback(async (nextQuery = query, source: "auto" | "manual" = "manual") => {
    const trimmedQuery = nextQuery.trim();

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel) {
      return;
    }

    const searchId = latestSearchRef.current + 1;
    const geocodeQuery = normalizeSearchQuery(trimmedQuery);
    latestSearchRef.current = searchId;
    setSearching(true);
    setStatus("Ищем адрес...");

    try {
      const result = await geocodeAddress(geocodeQuery);

      if (searchId !== latestSearchRef.current) {
        return;
      }

      if (!result) {
        setStatus("Адрес не найден. Попробуйте уточнить запрос.");
        return;
      }

      const nextPoint = { lat: result.coords[0], lng: result.coords[1] };

      setPoint(nextPoint);
      setAddress(result.address);
      setQuery(result.address);
      setStatus("Адрес найден");
      mapInstanceRef.current?.setView(result.coords, 16);
      invalidateMapSize(mapInstanceRef.current);

      if (window.L) {
        if (!placemarkRef.current) {
          placemarkRef.current = window.L.marker(result.coords).addTo(mapInstanceRef.current as LeafletMap);
        } else {
          placemarkRef.current.setLatLng(result.coords);
        }
      }
    } catch {
      if (searchId === latestSearchRef.current && source === "manual") {
        setStatus("Адрес не удалось найти. Уточните запрос, например: Краснодар, улица и дом.");
      }
    } finally {
      if (searchId === latestSearchRef.current) {
        setSearching(false);
      }
    }
  }, [query]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel || trimmedQuery.length < 5 || trimmedQuery === address.trim()) {
      return;
    }

    const timeout = window.setTimeout(() => {
      searchAddress(trimmedQuery, "auto");
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [address, query, searchAddress]);

  return (
    <section className="map-picker-panel rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-[#060b27]">Метка на карте</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Введите адрес, и карта поставит точку автоматически. Или поставьте точку кликом по карте, и адрес появится в строке поиска.</p>
        </div>
        {point ? (
          <button type="button" onClick={clearPoint} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-rose-200 hover:text-rose-600">
            <X className="h-4 w-4" />
            Убрать метку
          </button>
        ) : null}
      </div>
      <div className="map-picker-search mt-4">
        <input
          className="h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0875d1]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              searchAddress();
            }
          }}
          placeholder="Введите точный адрес или место"
        />
        <button type="button" onClick={() => searchAddress()} disabled={searching || !query.trim()} className="map-picker-search-button inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0669bd] disabled:cursor-not-allowed disabled:opacity-55">
          <Search className="h-4 w-4" />
          Найти
        </button>
      </div>
      <input type="hidden" name={addressName} value={address} />
      <input type="hidden" name={latName} value={point ? formatCoord(point.lat) : ""} />
      <input type="hidden" name={lngName} value={point ? formatCoord(point.lng) : ""} />
      <input type="hidden" name={mapPointSelectedName} value={point ? "1" : ""} />
      <div id={mapId} ref={mapRef} className="map-picker-canvas mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        {!point ? <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{status}</span> : null}
        {point ? (
          <a href={routeUrl(point.lat, point.lng)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-bold text-[#0875d1]">
            <Navigation className="h-4 w-4" />
            Открыть карту
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function YandexMapView({ lat, lng, label }: YandexMapViewProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative mt-5 h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <iframe
        className="h-full w-full"
        src={mapWidgetUrl(lat, lng)}
        title={`Карта: ${label}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
          {failed ? "Карту не удалось загрузить" : "Загружаем OpenStreetMap..."}
        </div>
      ) : null}
      <a href={routeUrl(lat, lng)} target="_blank" rel="noreferrer" className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs font-bold text-[#0875d1] shadow-card">
        <MapPin className="h-4 w-4" />
        Открыть карту
      </a>
    </div>
  );
}
