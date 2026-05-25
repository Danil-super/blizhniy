"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, MapPin, Plus, Search } from "lucide-react";
import { cities, region } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function HeaderControls() {
  const router = useRouter();
  const [selectedCity, setSelectedCity] = useState(cities[0]?.slug ?? "krasnodar");
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const cityOptions = [{ slug: region.slug, name: region.name }, ...cities];
  const selectedCityName = cityOptions.find((item) => item.slug === selectedCity)?.name ?? cities[0]?.name ?? region.name;

  useEffect(() => {
    const savedCity = window.localStorage.getItem("blizhniy-city");

    if (savedCity && cities.some((city) => city.slug === savedCity)) {
      setSelectedCity(savedCity);
    }

    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });

    return () => subscription.unsubscribe();
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

    router.push(`/poisk?q=${encodeURIComponent(trimmedQuery)}&city=${encodeURIComponent(selectedCity)}`);
  }

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[250px_minmax(280px,1fr)_auto_auto_auto] lg:ml-8">
      <div className="relative" ref={cityMenuRef}>
        <button
          type="button"
          onClick={() => setCityMenuOpen((current) => !current)}
          className="flex h-14 w-full items-center rounded-xl border border-slate-300 bg-white px-4 text-left text-slate-700 transition hover:border-blue-200 focus:border-[#0875d1] focus:outline-none focus:ring-4 focus:ring-blue-100"
          aria-expanded={cityMenuOpen}
          aria-haspopup="listbox"
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
          <MapPin className="h-5 w-5 shrink-0 text-slate-500" />
          <span className="sr-only">Регион</span>
            <span className="truncate font-semibold">{selectedCityName}</span>
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

      <form onSubmit={handleSearch} className="flex h-14 items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-slate-500">
        <Search className="h-6 w-6 shrink-0" />
        <input
          className="w-full border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск объявлений, вакансий и специалистов"
        />
        <button type="submit" className="rounded-lg bg-[#0875d1] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0664b3]">
          Найти
        </button>
      </form>

      <Link className="icon-button" href="/cabinet/oplata" aria-label="Уведомления">
        <Bell className="h-5 w-5" />
      </Link>

      <Link
        className="inline-flex h-14 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]"
        href={signedIn ? "/cabinet" : "/auth"}
      >
        {signedIn ? "Кабинет" : "Войти"}
      </Link>

      <Link
        href="/blizhniy/sozdat"
        className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-[#0aa337] px-7 font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-[#078a2e]"
      >
        <Plus className="h-6 w-6" />
        Разместить
      </Link>
    </div>
  );
}
