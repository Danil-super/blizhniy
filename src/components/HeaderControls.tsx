"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Bell, ChevronDown, MapPin, Plus, Search } from "lucide-react";
import { cities, region } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function HeaderControls() {
  const router = useRouter();
  const [selectedCity, setSelectedCity] = useState(cities[0]?.slug ?? "krasnodar");
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);

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

  function handleRegionChange(citySlug: string) {
    setSelectedCity(citySlug);
    window.localStorage.setItem("blizhniy-city", citySlug);
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
      <label className="relative flex h-14 items-center rounded-xl border border-slate-300 bg-white px-4 text-left text-slate-700">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <MapPin className="h-5 w-5 shrink-0 text-slate-500" />
          <span className="sr-only">Регион</span>
          <select
            className="w-full appearance-none bg-transparent pr-8 font-semibold outline-none"
            value={selectedCity}
            onChange={(event) => handleRegionChange(event.target.value)}
          >
            <option value={region.slug}>{region.name}</option>
            {cities.map((city) => (
              <option key={city.slug} value={city.slug}>
                {city.name}
              </option>
            ))}
          </select>
        </span>
        <ChevronDown className="pointer-events-none absolute right-4 h-4 w-4 text-slate-500" />
      </label>

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

      <button className="icon-button" aria-label="Уведомления">
        <Bell className="h-5 w-5" />
      </button>

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
