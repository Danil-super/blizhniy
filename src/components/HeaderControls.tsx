"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Grid3X3, Search } from "lucide-react";
import { AnimatedLocationIcon } from "@/components/AnimatedLocationIcon";
import { categories, cities, listingKinds, listings, professions, region, specialists, vacancies, workRequests } from "@/lib/data";

const sortedCities = [...cities].sort((left, right) => left.name.localeCompare(right.name, "ru"));
const cityOptions = [{ slug: region.slug, name: region.name }, ...sortedCities];

type SearchSuggestion = {
  label: string;
  hint: string;
};

const searchSuggestionSource = uniqueSearchSuggestions([
  ...listingKinds.map((kind) => ({ label: kind.name, hint: "тип объявления" })),
  ...categories.flatMap((category) => [
    { label: category.name, hint: "категория" },
    ...category.children.map((child) => ({ label: child, hint: category.name })),
  ]),
  ...listings.flatMap((listing) => [
    { label: listing.title, hint: "объявление" },
    { label: listing.subcategory, hint: "подкатегория" },
  ]),
  ...vacancies.flatMap((vacancy) => [
    { label: vacancy.title, hint: "вакансия" },
    { label: vacancy.profession, hint: "профессия" },
    { label: vacancy.organization, hint: "организация" },
  ]),
  ...workRequests.flatMap((request) => [
    { label: request.title, hint: "заказ" },
    { label: request.profession, hint: "профессия" },
  ]),
  ...specialists.flatMap((specialist) => [
    { label: specialist.profession, hint: "специалист" },
    { label: specialist.name, hint: "исполнитель" },
  ]),
  ...professions.map((profession) => ({ label: profession.name, hint: "профессия" })),
]);

function uniqueSearchSuggestions(suggestions: SearchSuggestion[]) {
  const used = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = suggestion.label.trim().toLowerCase();

    if (!key || used.has(key)) {
      return false;
    }

    used.add(key);
    return true;
  });
}

function matchesSuggestion(label: string, query: string) {
  const normalizedLabel = label.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  return normalizedLabel.startsWith(normalizedQuery) || normalizedLabel.split(/\s+/).some((word) => word.startsWith(normalizedQuery));
}

export function HeaderControls() {
  const router = useRouter();
  const [selectedCity, setSelectedCity] = useState(region.slug);
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const citySearchInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
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
  const filteredSearchSuggestions = useMemo(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return [];
    }

    return searchSuggestionSource.filter((suggestion) => matchesSuggestion(suggestion.label, trimmedQuery)).slice(0, 6);
  }, [query]);

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

      if (!searchRef.current?.contains(event.target as Node)) {
        setSearchSuggestionsOpen(false);
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

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      router.push("/blizhniy/kategorii");
      return;
    }

    router.push(`/blizhniy/poisk?q=${encodeURIComponent(trimmedQuery)}&city=${encodeURIComponent(selectedCity)}`);
  }

  function submitSuggestion(suggestion: SearchSuggestion) {
    setQuery(suggestion.label);
    setSearchSuggestionsOpen(false);
    router.push(`/blizhniy/poisk?q=${encodeURIComponent(suggestion.label)}&city=${encodeURIComponent(selectedCity)}`);
  }

  return (
    <div className="grid w-full min-w-0 flex-1 grid-cols-[40px_minmax(0,1fr)] items-center gap-1.5 overflow-visible sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-2 md:grid-cols-[56px_minmax(320px,1fr)_auto]">
      <Link
        href="/blizhniy/kategorii"
        className="order-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[#00aaff] text-white transition hover:bg-[#0796dd] sm:h-12 sm:w-12 sm:rounded-2xl md:w-14"
        aria-label="Каталог"
      >
        <Grid3X3 className="h-4 w-4 sm:h-5 sm:w-5" />
      </Link>

      <div className="relative order-2 min-w-0" ref={searchRef}>
        <form
          onSubmit={handleSearch}
          suppressHydrationWarning
          className="flex h-10 min-w-0 items-center overflow-hidden rounded-xl border-2 border-[#00aaff] bg-white text-slate-500 sm:h-12 sm:rounded-2xl"
        >
          <Search className="ml-3 h-4 w-4 shrink-0 sm:ml-4" />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 sm:px-3 sm:text-base"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchSuggestionsOpen(true);
            }}
            onFocus={() => setSearchSuggestionsOpen(true)}
            placeholder="Поиск"
            autoComplete="off"
            suppressHydrationWarning
          />
          <button type="submit" className="hidden h-full items-center rounded-r-[14px] bg-[#00aaff] px-5 text-sm font-bold text-white transition hover:bg-[#0796dd] sm:flex">
            Найти
          </button>
        </form>
        {searchSuggestionsOpen && filteredSearchSuggestions.length ? (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-xl shadow-slate-900/10" role="listbox">
            {filteredSearchSuggestions.map((suggestion) => (
              <button
                key={`${suggestion.hint}-${suggestion.label}`}
                type="button"
                className="flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#0875d1]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submitSuggestion(suggestion)}
                role="option"
                aria-selected={false}
              >
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{suggestion.label}</span>
                <span className="shrink-0 text-xs text-slate-500">{suggestion.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative order-3 col-span-2 hidden md:col-span-1 md:block" ref={cityMenuRef}>
        <button
          type="button"
          onClick={() => {
            setCityQuery("");
            setCityMenuOpen((current) => !current);
          }}
          className="relative z-20 flex min-h-12 w-full items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-950 shadow-sm transition hover:border-blue-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 md:w-40 lg:w-44"
          aria-expanded={cityMenuOpen}
          aria-haspopup="listbox"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <AnimatedLocationIcon className="h-7 w-7" />
            <span className="sr-only">Регион</span>
            <span className="min-w-0 font-semibold leading-5 md:whitespace-normal">{selectedCityName === region.name ? "Во всех регионах" : selectedCityName}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${cityMenuOpen ? "rotate-180" : ""}`} />
        </button>
        {cityMenuOpen ? (
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-[120] w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 md:w-72"
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
    </div>
  );
}
