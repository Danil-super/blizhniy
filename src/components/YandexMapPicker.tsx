"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Navigation, Search, X } from "lucide-react";

type YandexMapPickerProps = {
  defaultAddress?: string;
  defaultLat?: number;
  defaultLng?: number;
  addressName?: string;
  latName?: string;
  lngName?: string;
};

type YandexMapViewProps = {
  lat: number;
  lng: number;
  label: string;
};

type YandexReady = {
  ready: (callback: () => void) => void;
  Map: new (element: HTMLElement, options: Record<string, unknown>) => YandexMap;
  Placemark: new (coords: number[], properties?: Record<string, unknown>, options?: Record<string, unknown>) => YandexPlacemark;
  geocode: (request: string | number[], options?: Record<string, unknown>) => Promise<YandexGeocodeResult>;
};

type YandexMap = {
  events: { add: (eventName: string, callback: (event: { get: (key: string) => number[] }) => void) => void };
  geoObjects: { add: (placemark: YandexPlacemark) => void; remove: (placemark: YandexPlacemark) => void };
  setCenter: (coords: number[], zoom?: number) => void;
  destroy: () => void;
};

type YandexPlacemark = {
  geometry: { setCoordinates: (coords: number[]) => void };
};

type YandexGeoObject = {
  geometry: { getCoordinates: () => number[] };
  getAddressLine?: () => string;
  properties?: { get: (key: string) => unknown };
};

type YandexGeocodeResult = {
  geoObjects: {
    get: (index: number) => YandexGeoObject | undefined;
  };
};

declare global {
  interface Window {
    ymaps?: YandexReady;
    __blizhniyYandexMapsPromise?: Promise<void>;
  }
}

const krasnodarCenter = { lat: 45.035, lng: 38.976 };
const resolvingAddressLabel = "Определяем адрес...";
const krasnodarBounds = [
  [43.3, 36.5],
  [47.0, 41.5],
];
const nominatimViewbox = "36.5,47.0,41.5,43.3";
const coordsPattern = /^-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?$/;

function yandexMapsSrc() {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;
  const params = new URLSearchParams({ lang: "ru_RU", load: "package.full" });

  if (apiKey) {
    params.set("apikey", apiKey);
  }

  return `https://api-maps.yandex.ru/2.1/?${params.toString()}`;
}

function loadYandexMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Карта доступна только в браузере"));
  }

  if (window.ymaps) {
    return Promise.resolve();
  }

  window.__blizhniyYandexMapsPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-blizhniy-yandex-maps="1"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Не удалось загрузить Яндекс.Карты")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = yandexMapsSrc();
    script.async = true;
    script.dataset.blizhniyYandexMaps = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить Яндекс.Карты"));
    document.head.appendChild(script);
  });

  return window.__blizhniyYandexMapsPromise;
}

function routeUrl(lat: number, lng: number) {
  return `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`;
}

function formatCoord(value: number) {
  return value.toFixed(6);
}

function formatCoords(lat: number, lng: number) {
  return `${formatCoord(lat)}, ${formatCoord(lng)}`;
}

function normalizeSearchQuery(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /^-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  if (/краснодар|сочи|новороссийск|анапа|геленджик|армавир|туапсе|ейск|краснодарский/i.test(trimmed)) {
    return trimmed;
  }

  return `Краснодар, ${trimmed}`;
}

function getPropertyString(geoObject: YandexGeoObject | undefined, key: string) {
  const value = geoObject?.properties?.get(key);
  return typeof value === "string" ? value : "";
}

function metadataToRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeGetAll = value as { getAll?: () => unknown };

  if (typeof maybeGetAll.getAll === "function") {
    const all = maybeGetAll.getAll();
    return all && typeof all === "object" ? (all as Record<string, unknown>) : undefined;
  }

  return value as Record<string, unknown>;
}

function readNestedString(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return "";
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : "";
}

function getGeoObjectAddress(geoObject?: YandexGeoObject) {
  const metaDataProperty = metadataToRecord(geoObject?.properties?.get("metaDataProperty"));
  const address =
    geoObject?.getAddressLine?.() ||
    getPropertyString(geoObject, "text") ||
    getPropertyString(geoObject, "name") ||
    readNestedString(metaDataProperty, ["GeocoderMetaData", "Address", "formatted"]) ||
    readNestedString(metaDataProperty, ["GeocoderMetaData", "text"]) ||
    "";

  return coordsPattern.test(address.trim()) ? "" : address.trim();
}

function getFirstGeoObject(result: YandexGeocodeResult) {
  return result.geoObjects.get(0);
}

function ymapsGeocode(request: string | number[], options: Record<string, unknown>) {
  if (!window.ymaps?.geocode) {
    return Promise.reject(new Error("Геокодер Яндекс.Карт не загрузился"));
  }

  return new Promise<YandexGeocodeResult>((resolve, reject) => {
    window.ymaps?.geocode(request, options).then(resolve, reject);
  });
}

async function geocodeAddress(query: string) {
  const baseOptions = {
    boundedBy: krasnodarBounds,
    provider: "yandex#map",
    results: 1,
    strictBounds: false,
  };

  const result = await ymapsGeocode(query, baseOptions);
  const geoObject = getFirstGeoObject(result);

  if (geoObject) {
    return geoObject;
  }

  return undefined;
}

async function reverseGeocode(coords: number[]) {
  const result = await ymapsGeocode(coords, {
    kind: "house",
    provider: "yandex#map",
    results: 1,
  });

  return getFirstGeoObject(result);
}

async function fallbackGeocodeAddress(query: string) {
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
    address: result.display_name?.trim() || query,
    coords: [lat, lng],
  };
}

async function fallbackReverseGeocode(coords: number[]) {
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
  return result.display_name?.trim() || "";
}

export function YandexMapPicker({ addressName = "address", defaultAddress, defaultLat, defaultLng, latName = "lat", lngName = "lng" }: YandexMapPickerProps) {
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<YandexMap | null>(null);
  const placemarkRef = useRef<YandexPlacemark | null>(null);
  const latestSearchRef = useRef(0);
  const [point, setPoint] = useState(typeof defaultLat === "number" && typeof defaultLng === "number" ? { lat: defaultLat, lng: defaultLng } : null);
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [query, setQuery] = useState(defaultAddress ?? "");
  const [status, setStatus] = useState("Загрузка карты...");
  const [searching, setSearching] = useState(false);
  const center = point ?? krasnodarCenter;
  const initialPointRef = useRef(point);
  const initialCenterRef = useRef(center);

  useEffect(() => {
    let cancelled = false;

    loadYandexMaps()
      .then(() => {
        window.ymaps?.ready(() => {
          if (cancelled || !mapRef.current || mapInstanceRef.current || !window.ymaps) {
            return;
          }

          const initialPoint = initialPointRef.current;
          const initialCenter = initialCenterRef.current;
          const map = new window.ymaps.Map(mapRef.current, {
            center: [initialCenter.lat, initialCenter.lng],
            controls: ["zoomControl"],
            zoom: initialPoint ? 15 : 11,
          });

          mapInstanceRef.current = map;
          setStatus("Кликните по карте, чтобы поставить метку");

          if (initialPoint) {
            const placemark = new window.ymaps.Placemark([initialPoint.lat, initialPoint.lng]);
            placemarkRef.current = placemark;
            map.geoObjects.add(placemark);
          }

          map.events.add("click", (event) => {
            const coords = event.get("coords");
            const nextPoint = { lat: coords[0], lng: coords[1] };

            setPoint(nextPoint);
            setAddress("");
            setQuery(resolvingAddressLabel);
            setStatus("Определяем адрес по метке...");

            if (!window.ymaps) {
              return;
            }

            if (!placemarkRef.current) {
              const placemark = new window.ymaps.Placemark(coords);
              placemarkRef.current = placemark;
              map.geoObjects.add(placemark);
            } else {
              placemarkRef.current.geometry.setCoordinates(coords);
            }

            const searchId = latestSearchRef.current + 1;
            latestSearchRef.current = searchId;

            reverseGeocode(coords)
              .then(async (result) => {
                if (searchId !== latestSearchRef.current) {
                  return;
                }

                const nextAddress = getGeoObjectAddress(result) || (await fallbackReverseGeocode(coords));

                if (nextAddress) {
                  setAddress(nextAddress);
                  setQuery(nextAddress);
                  setStatus("Адрес определен");
                  return;
                }

                setQuery("");
                setStatus("Метка выбрана, но Яндекс не вернул адрес для этой точки");
              })
              .catch(async () => {
                if (searchId !== latestSearchRef.current) {
                  return;
                }

                const fallbackAddress = await fallbackReverseGeocode(coords);

                if (fallbackAddress && searchId === latestSearchRef.current) {
                  setAddress(fallbackAddress);
                  setQuery(fallbackAddress);
                  setStatus("Адрес определен");
                  return;
                }

                if (searchId === latestSearchRef.current) {
                  setQuery("");
                  setStatus("Метка выбрана, но адрес определить не удалось");
                }
              });
          });
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("Карту не удалось загрузить. Проверьте ключ Яндекс.Карт или сеть.");
        }
      });

    return () => {
      cancelled = true;
      mapInstanceRef.current?.destroy();
      mapInstanceRef.current = null;
      placemarkRef.current = null;
    };
  }, []);

  function clearPoint() {
    setPoint(null);
    setAddress("");
    setQuery("");
    setStatus("Кликните по карте, чтобы поставить метку");

    if (mapInstanceRef.current && placemarkRef.current) {
      mapInstanceRef.current.geoObjects.remove(placemarkRef.current);
      placemarkRef.current = null;
    }
  }

  const searchAddress = useCallback(async (nextQuery = query, source: "auto" | "manual" = "manual") => {
    const trimmedQuery = nextQuery.trim();

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel || !window.ymaps) {
      return;
    }

    const searchId = latestSearchRef.current + 1;
    const geocodeQuery = normalizeSearchQuery(trimmedQuery);
    latestSearchRef.current = searchId;
    setSearching(true);
    setStatus("Ищем адрес...");

    try {
      let geoObject: YandexGeoObject | undefined;
      let fallbackResult: Awaited<ReturnType<typeof fallbackGeocodeAddress>> | undefined;

      try {
        geoObject = await geocodeAddress(geocodeQuery);
      } catch {
        fallbackResult = await fallbackGeocodeAddress(geocodeQuery);
      }

      if (searchId !== latestSearchRef.current) {
        return;
      }

      if (!geoObject) {
        fallbackResult ??= await fallbackGeocodeAddress(geocodeQuery);
      }

      if (!geoObject && geocodeQuery !== trimmedQuery) {
        try {
          geoObject = await geocodeAddress(trimmedQuery);
        } catch {
          fallbackResult ??= await fallbackGeocodeAddress(trimmedQuery);
        }

        if (!geoObject) {
          fallbackResult ??= await fallbackGeocodeAddress(trimmedQuery);
        }
      }

      const coords = geoObject?.geometry.getCoordinates() ?? fallbackResult?.coords;

      if (!coords) {
        setStatus("Адрес не найден. Попробуйте уточнить запрос.");
        return;
      }

      const nextPoint = { lat: coords[0], lng: coords[1] };
      const nextAddress = getGeoObjectAddress(geoObject) || fallbackResult?.address || geocodeQuery;

      setPoint(nextPoint);
      setAddress(nextAddress);
      setQuery(nextAddress);
      setStatus("Адрес найден");
      mapInstanceRef.current?.setCenter(coords, 16);

      if (window.ymaps) {
        if (!placemarkRef.current) {
          const placemark = new window.ymaps.Placemark(coords);
          placemarkRef.current = placemark;
          mapInstanceRef.current?.geoObjects.add(placemark);
        } else {
          placemarkRef.current.geometry.setCoordinates(coords);
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

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel || trimmedQuery.length < 5 || trimmedQuery === address.trim() || !window.ymaps) {
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
      <div id={mapId} ref={mapRef} className="map-picker-canvas mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span className="font-semibold">{point ? formatCoords(point.lat, point.lng) : status}</span>
        {point ? (
          <a href={routeUrl(point.lat, point.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-[#0875d1]">
            <Navigation className="h-4 w-4" />
            Открыть в Яндекс.Картах
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function YandexMapView({ lat, lng, label }: YandexMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const center = useMemo(() => [lat, lng], [lat, lng]);

  useEffect(() => {
    let cancelled = false;
    let map: YandexMap | null = null;

    loadYandexMaps()
      .then(() => {
        window.ymaps?.ready(() => {
          if (cancelled || !mapRef.current || !window.ymaps) {
            return;
          }

          map = new window.ymaps.Map(mapRef.current, {
            center,
            controls: ["zoomControl"],
            zoom: 15,
          });
          map.geoObjects.add(new window.ymaps.Placemark(center, { hintContent: label }, { preset: "islands#blueHomeIcon" }));
          setLoaded(true);
        });
      })
      .catch(() => setLoaded(false));

    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [center, label]);

  return (
    <div className="relative mt-5 h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <div ref={mapRef} className="h-full w-full" />
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
          Загружаем Яндекс.Карту...
        </div>
      ) : null}
      <a href={routeUrl(lat, lng)} target="_blank" rel="noreferrer" className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs font-bold text-[#0875d1] shadow-card">
        <MapPin className="h-4 w-4" />
        Открыть в Яндекс.Картах
      </a>
    </div>
  );
}
