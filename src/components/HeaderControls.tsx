"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MapPin, Search } from "lucide-react";
import { cities, region } from "@/lib/data";

const sortedCities = [...cities].sort((left, right) => left.name.localeCompare(right.name, "ru"));
const cityOptions = [{ slug: region.slug, name: region.name }, ...sortedCities];

export function HeaderControls({ placement = "desktop" }: { placement?: "desktop" | "mobile" }) {
  const [selectedCity, setSelectedCity] = useState(region.slug);
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const citySearchInputRef = useRef<HTMLInputElement>(null);
  const selectedCityName = cityOptions.find((item) => item.slug === selectedCity)?.name ?? region.name;
  const filteredCityOptions = useMemo(() => {
    const normalizedQuery = cityQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedCities;
    }

    return sortedCities.filter((city) => {
      const normalizedName = city.name.toLowerCase();
      return normalizedName.startsWith(normalizedQuery) || normalizedName.includes(normalizedQuery);
    });
  }, [cityQuery]);

  useEffect(() => {
    if (!cityMenuOpen) {
      return;
    }

    citySearchInputRef.current?.focus();
  }, [cityMenuOpen]);

  useEffect(() => {
    const savedCity = window.localStorage.getItem("blizhniy-city");

    if (savedCity && cityOptions.some((city) => city.slug === savedCity)) {
      setSelectedCity(savedCity);
    }
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!cityMenuRef.current?.contains(event.target as Node)) {
        setCityMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  function handleRegionChange(citySlug: string) {
    setSelectedCity(citySlug);
    window.localStorage.setItem("blizhniy-city", citySlug);
    setCityQuery("");
    setCityMenuOpen(false);
  }

  const mobile = placement === "mobile";

  return (
    <div className={`relative ${mobile ? "block lg:hidden" : "hidden lg:block"}`} ref={cityMenuRef}>
      <button
        type="button"
        onClick={() => {
          setCityQuery("");
          setCityMenuOpen((current) => !current);
        }}
        className={`relative z-20 flex min-h-10 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-2 text-left text-[13px] text-slate-950 shadow-sm transition hover:border-emerald-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 md:min-h-11 md:text-sm ${
          mobile ? "w-full" : "w-44 xl:w-48"
        }`}
        aria-expanded={cityMenuOpen}
        aria-haspopup="listbox"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-[#2f8f12] shadow-sm md:h-9 md:w-9">
            <MapPin className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="sr-only">Регион</span>
          <span className="min-w-0 font-semibold leading-5 md:whitespace-normal">{selectedCityName === region.name ? "Во всех регионах" : selectedCityName}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${cityMenuOpen ? "rotate-180" : ""}`} />
      </button>
      {cityMenuOpen ? (
        <div
          className={`absolute top-[calc(100%+8px)] z-[120] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 ${
            mobile ? "left-0 right-0 w-full" : "right-0 w-72"
          }`}
          role="listbox"
        >
          <div className="mb-2 flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-slate-500 focus-within:border-[#0875d1]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              ref={citySearchInputRef}
              value={cityQuery}
              onChange={(event) => setCityQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Введите город"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={() => handleRegionChange(region.slug)}
            className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold transition ${
              selectedCity === region.slug ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
            }`}
            role="option"
            aria-selected={selectedCity === region.slug}
          >
            <span>Во всех регионах</span>
            {selectedCity === region.slug ? <span className="h-2 w-2 rounded-full bg-[#0875d1]" /> : null}
          </button>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {filteredCityOptions.length ? (
              filteredCityOptions.map((city) => {
                const active = city.slug === selectedCity;

                return (
                  <button
                    key={city.slug}
                    type="button"
                    onClick={() => handleRegionChange(city.slug)}
                    className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold transition ${
                      active ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
                    }`}
                    role="option"
                    aria-selected={active}
                  >
                    <span>{city.name}</span>
                    {active ? <span className="h-2 w-2 rounded-full bg-[#0875d1]" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-3 text-sm font-semibold text-slate-500">Город не найден</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
