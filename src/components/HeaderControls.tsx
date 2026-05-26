"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, Grid3X3, MapPin, Search } from "lucide-react";
import { cities, region } from "@/lib/data";

const cityOptions = [{ slug: region.slug, name: region.name }, ...cities];

export function HeaderControls() {
  const router = useRouter();
  const [selectedCity, setSelectedCity] = useState(cities[0]?.slug ?? "krasnodar");
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const selectedCityName = cityOptions.find((item) => item.slug === selectedCity)?.name ?? cities[0]?.name ?? region.name;

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
    setCityMenuOpen(false);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      router.push("/blizhniy/kategorii");
      return;
    }

    router.push(`/blizhniy/poisk?q=${encodeURIComponent(trimmedQuery)}&city=${encodeURIComponent(selectedCity)}`);
  }

  return (
    <div className="grid w-full min-w-0 flex-1 grid-cols-[56px_minmax(0,1fr)] items-center gap-2 md:grid-cols-[56px_minmax(320px,1fr)_auto]">
      <Link
        href="/blizhniy/kategorii"
        className="order-1 flex h-12 w-14 items-center justify-center rounded-2xl bg-[#00aaff] text-white transition hover:bg-[#0796dd]"
        aria-label="Каталог"
      >
        <Grid3X3 className="h-5 w-5" />
      </Link>

      <form onSubmit={handleSearch} className="order-2 flex h-12 min-w-0 items-center overflow-hidden rounded-2xl border-2 border-[#00aaff] bg-white text-slate-500">
        <Search className="ml-4 h-4 w-4 shrink-0" />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-base text-slate-900 outline-none placeholder:text-slate-400"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по объявлениям"
        />
        <button type="submit" className="hidden h-full items-center bg-[#00aaff] px-5 text-sm font-bold text-white transition hover:bg-[#0796dd] sm:flex">
          Найти
        </button>
      </form>

      <div className="relative order-3 col-span-2 md:col-span-1" ref={cityMenuRef}>
        <button
          type="button"
          onClick={() => setCityMenuOpen((current) => !current)}
          className="flex min-h-12 w-full items-center rounded-lg bg-white px-2 text-left text-sm text-slate-950 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-100 md:w-40 lg:w-44"
          aria-expanded={cityMenuOpen}
          aria-haspopup="listbox"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 md:gap-3">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500 sm:h-4 sm:w-4" />
            <span className="sr-only">Регион</span>
            <span className="font-semibold leading-5 md:whitespace-normal">{selectedCityName === region.name ? "Во всех регионах" : selectedCityName}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition ${cityMenuOpen ? "rotate-180" : ""}`} />
        </button>
        {cityMenuOpen ? (
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10"
            role="listbox"
          >
            {cityOptions.map((city) => {
              const active = city.slug === selectedCity;

              return (
                <button
                  key={city.slug}
                  type="button"
                  onClick={() => handleRegionChange(city.slug)}
                  className={`flex h-10 w-full items-center justify-between px-4 text-left text-sm font-semibold transition ${
                    active ? "bg-blue-50 text-[#0875d1]" : "text-slate-700 hover:bg-slate-50 hover:text-[#0875d1]"
                  }`}
                  role="option"
                  aria-selected={active}
                >
                  <span>{city.name}</span>
                  {active ? <span className="h-2 w-2 rounded-full bg-[#0875d1]" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
