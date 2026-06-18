"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Search, X } from "lucide-react";
import { capitalizeFirstTextLetter } from "@/lib/text-format";

type DgisMapPickerProps = {
  defaultAddress?: string;
  defaultLat?: number;
  defaultLng?: number;
  addressName?: string;
  latName?: string;
  lngName?: string;
  mapPointSelectedName?: string;
  onPointSelectedChange?: (selected: boolean) => void;
};

type DgisMapViewProps = {
  lat: number;
  lng: number;
  label: string;
};

type Coordinates = [number, number];

type DgisMap = {
  destroy: () => void;
  invalidateSize?: () => void;
  on: (eventName: "click", callback: (event: { lngLat?: Coordinates }) => void) => void;
  setCenter: (coordinates: Coordinates) => void;
  setZoom: (zoom: number) => void;
};

type DgisMarker = {
  destroy: () => void;
  setCoordinates: (coordinates: Coordinates) => void;
};

type DgisGlobal = {
  Map: new (element: HTMLElement, options: { center: Coordinates; key: string; zoom: number; zoomControl?: string }) => DgisMap;
  Marker: new (map: DgisMap, options: { coordinates: Coordinates }) => DgisMarker;
};

type GeocodeItem = {
  address_name?: string;
  full_name?: string;
  name?: string;
  point?: {
    lat?: number;
    lon?: number;
  };
};

type GeocodeResponse = {
  result?: {
    items?: GeocodeItem[];
  };
};

declare global {
  interface Window {
    mapgl?: DgisGlobal;
    __blizhniyDgisMapPromise?: Promise<void>;
  }
}

const centerKrasnodar = { lat: 45.035, lng: 38.976 };
const resolvingAddressLabel = "Определяем адрес...";
const coordsPattern = /^-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?$/;

function apiKey() {
  return process.env.NEXT_PUBLIC_2GIS_API_KEY?.trim() ?? "";
}

function loadMapGl() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Карта доступна только в браузере"));
  }

  if (window.mapgl) {
    return Promise.resolve();
  }

  window.__blizhniyDgisMapPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-blizhniy-dgis="1"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Не удалось загрузить 2ГИС")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://mapgl.2gis.com/api/js/v1";
    script.async = true;
    script.dataset.blizhniyDgis = "1";
    script.onload = () => (window.mapgl ? resolve() : reject(new Error("2ГИС не загрузился")));
    script.onerror = () => reject(new Error("Не удалось загрузить 2ГИС"));
    document.head.appendChild(script);
  });

  return window.__blizhniyDgisMapPromise;
}

function routeUrl(lat: number, lng: number) {
  return `https://2gis.ru/geo/${lng}%2C${lat}`;
}

function formatCoord(value: number) {
  return value.toFixed(6);
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

function formatAddress(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index)
    .slice(0, 5)
    .join(", ");
}

function itemAddress(item: GeocodeItem | undefined, fallback: string) {
  return formatAddress(item?.full_name || item?.address_name || item?.name || fallback) || fallback;
}

async function dgisGeocode(params: Record<string, string>) {
  const key = apiKey();

  if (!key) {
    return undefined;
  }

  const searchParams = new URLSearchParams({
    fields: "items.point,items.full_name,items.address_name",
    key,
    ...params,
  });
  const response = await fetch(`https://catalog.api.2gis.com/3.0/items/geocode?${searchParams.toString()}`);

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as GeocodeResponse;
  const item = payload.result?.items?.[0];
  const lat = item?.point?.lat;
  const lng = item?.point?.lon;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return undefined;
  }

  return {
    address: itemAddress(item, params.q ?? `${formatCoord(lat)}, ${formatCoord(lng)}`),
    coords: [lng, lat] as Coordinates,
  };
}

async function geocodeAddress(query: string) {
  const parsed = parseCoords(query);

  if (parsed) {
    return {
      address: `${formatCoord(parsed.lat)}, ${formatCoord(parsed.lng)}`,
      coords: [parsed.lng, parsed.lat] as Coordinates,
    };
  }

  return dgisGeocode({ q: query });
}

async function reverseGeocode(coords: Coordinates) {
  const result = await dgisGeocode({ lat: String(coords[1]), lon: String(coords[0]) });
  return result?.address ?? "";
}

function refreshMap(map: DgisMap | null) {
  window.setTimeout(() => map?.invalidateSize?.(), 80);
  window.setTimeout(() => map?.invalidateSize?.(), 320);
}

function setMapView(map: DgisMap | null, coords: Coordinates, zoom = 16) {
  map?.setCenter(coords);
  map?.setZoom(zoom);
  refreshMap(map);
}

export function DgisMapPicker({
  addressName = "address",
  defaultAddress,
  defaultLat,
  defaultLng,
  latName = "lat",
  lngName = "lng",
  mapPointSelectedName = "mapPointSelected",
  onPointSelectedChange,
}: DgisMapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<DgisMap | null>(null);
  const markerRef = useRef<DgisMarker | null>(null);
  const latestSearchRef = useRef(0);
  const [point, setPoint] = useState(typeof defaultLat === "number" && typeof defaultLng === "number" ? { lat: defaultLat, lng: defaultLng } : null);
  const [address, setAddress] = useState(capitalizeFirstTextLetter(defaultAddress ?? ""));
  const [query, setQuery] = useState(capitalizeFirstTextLetter(defaultAddress ?? ""));
  const [status, setStatus] = useState(apiKey() ? "Загрузка карты 2ГИС..." : "Добавьте NEXT_PUBLIC_2GIS_API_KEY, чтобы включить карту 2ГИС.");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    onPointSelectedChange?.(Boolean(point));
  }, [onPointSelectedChange, point]);

  useEffect(() => {
    const key = apiKey();

    if (!key) {
      return;
    }

    let cancelled = false;

    loadMapGl()
      .then(() => {
        if (cancelled || !mapRef.current || mapInstanceRef.current || !window.mapgl) {
          return;
        }

        const initialPoint = point;
        const initialCenter = initialPoint ?? centerKrasnodar;
        const map = new window.mapgl.Map(mapRef.current, {
          center: [initialCenter.lng, initialCenter.lat],
          key,
          zoom: initialPoint ? 15 : 11,
          zoomControl: "bottomRight",
        });

        mapInstanceRef.current = map;
        refreshMap(map);
        setStatus("Кликните по карте, чтобы поставить метку");

        if (initialPoint) {
          markerRef.current = new window.mapgl.Marker(map, { coordinates: [initialPoint.lng, initialPoint.lat] });
        }

        map.on("click", (event) => {
          const coords = event.lngLat;

          if (!coords || !window.mapgl) {
            return;
          }

          const nextPoint = { lat: coords[1], lng: coords[0] };
          setPoint(nextPoint);
          setAddress("");
          setQuery(resolvingAddressLabel);
          setStatus("Определяем адрес по метке...");

          if (!markerRef.current) {
            markerRef.current = new window.mapgl.Marker(map, { coordinates: coords });
          } else {
            markerRef.current.setCoordinates(coords);
          }

          const searchId = latestSearchRef.current + 1;
          latestSearchRef.current = searchId;

          reverseGeocode(coords)
            .then((nextAddress) => {
              if (searchId !== latestSearchRef.current) {
                return;
              }

              if (nextAddress) {
                setAddress(capitalizeFirstTextLetter(nextAddress));
                setQuery(capitalizeFirstTextLetter(nextAddress));
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
          setStatus("Карту 2ГИС не удалось загрузить. Проверьте ключ или настройки домена в кабинете 2ГИС.");
        }
      });

    function onResize() {
      refreshMap(mapInstanceRef.current);
    }

    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      markerRef.current?.destroy();
      markerRef.current = null;
      mapInstanceRef.current?.destroy();
      mapInstanceRef.current = null;
    };
  }, []);

  function clearPoint() {
    setPoint(null);
    setAddress("");
    setQuery("");
    setStatus(apiKey() ? "Кликните по карте, чтобы поставить метку" : "Добавьте NEXT_PUBLIC_2GIS_API_KEY, чтобы включить карту 2ГИС.");
    markerRef.current?.destroy();
    markerRef.current = null;
    setMapView(mapInstanceRef.current, [centerKrasnodar.lng, centerKrasnodar.lat], 11);
  }

  const searchAddress = useCallback(async (nextQuery = query, source: "auto" | "manual" = "manual") => {
    const trimmedQuery = nextQuery.trim();

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel) {
      return;
    }

    if (!apiKey()) {
      setStatus("Для поиска адреса добавьте NEXT_PUBLIC_2GIS_API_KEY и пересоберите проект.");
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

      const nextPoint = { lat: result.coords[1], lng: result.coords[0] };
      setPoint(nextPoint);
      setAddress(capitalizeFirstTextLetter(result.address));
      setQuery(capitalizeFirstTextLetter(result.address));
      setStatus("Адрес найден");
      setMapView(mapInstanceRef.current, result.coords, 16);

      if (window.mapgl && mapInstanceRef.current) {
        if (!markerRef.current) {
          markerRef.current = new window.mapgl.Marker(mapInstanceRef.current, { coordinates: result.coords });
        } else {
          markerRef.current.setCoordinates(result.coords);
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

    if (!trimmedQuery || trimmedQuery === resolvingAddressLabel || trimmedQuery.length < 5 || trimmedQuery === address.trim() || !apiKey()) {
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
          onChange={(event) => setQuery(capitalizeFirstTextLetter(event.target.value))}
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
      <div ref={mapRef} className="map-picker-canvas mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white" />
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

export function DgisMapView({ lat, lng, label }: DgisMapViewProps) {
  return (
    <div className="relative mt-5 h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <div className="absolute inset-0 flex items-center justify-center bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
        Карта 2ГИС доступна по координатам: {formatCoord(lat)}, {formatCoord(lng)}.
      </div>
      <a href={routeUrl(lat, lng)} target="_blank" rel="noreferrer" className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs font-bold text-[#0875d1] shadow-card" aria-label={`Открыть карту: ${label}`}>
        <MapPin className="h-4 w-4" />
        Открыть карту
      </a>
    </div>
  );
}
