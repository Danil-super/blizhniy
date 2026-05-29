"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronRight, Filter, Search } from "lucide-react";
import { DemoListingFeed } from "@/components/DemoListingFeed";
import { demoPublicationsStorageKey, type DemoPublication } from "@/lib/demo-publications";
import {
  emptyListingFilters,
  listingFiltersEqual,
  matchesDemoListingFilters,
  matchesDemoPublicationFilters,
  matchesListingScope,
  type ListingFilterCriteria,
} from "@/lib/listing-filters";
import { DemoListing, ListingCard, ListingKind } from "./ListingCard";

type ListingResultsPanelProps = {
  categorySlug?: string;
  emptyText?: string;
  kind?: ListingKind | ListingKind[];
  listings: DemoListing[];
  subcategorySlug?: string;
};

function readStoredPublications() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "type" in item));
    }
  } catch {
    return [];
  }

  return [];
}

function formatCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;

  if (lastTwo >= 11 && lastTwo <= 14) {
    return `${count} объявлений`;
  }

  if (last === 1) {
    return `${count} объявление`;
  }

  if (last >= 2 && last <= 4) {
    return `${count} объявления`;
  }

  return `${count} объявлений`;
}

export function ListingResultsPanel({ categorySlug, emptyText, kind, listings, subcategorySlug }: ListingResultsPanelProps) {
  const [draftFilters, setDraftFilters] = useState<ListingFilterCriteria>(emptyListingFilters);
  const [appliedFilters, setAppliedFilters] = useState<ListingFilterCriteria>(emptyListingFilters);
  const [storedItems, setStoredItems] = useState<DemoPublication[]>([]);

  useEffect(() => {
    function syncItems() {
      setStoredItems(readStoredPublications());
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, []);

  const scopedStoredItems = useMemo(
    () => storedItems.filter((item) => matchesListingScope(item, { categorySlug, kind, subcategorySlug })),
    [categorySlug, kind, storedItems, subcategorySlug],
  );

  const liveCount = useMemo(() => {
    const listingCount = listings.filter((listing) => matchesDemoListingFilters(listing, draftFilters)).length;
    const storedCount = scopedStoredItems.filter((item) => matchesDemoPublicationFilters(item, draftFilters)).length;

    return listingCount + storedCount;
  }, [draftFilters, listings, scopedStoredItems]);

  const visibleListings = useMemo(() => listings.filter((listing) => matchesDemoListingFilters(listing, appliedFilters)), [appliedFilters, listings]);
  const visibleStoredCount = useMemo(
    () => scopedStoredItems.filter((item) => matchesDemoPublicationFilters(item, appliedFilters)).length,
    [appliedFilters, scopedStoredItems],
  );
  const visibleTotal = visibleListings.length + visibleStoredCount;
  const filtersChanged = !listingFiltersEqual(draftFilters, appliedFilters);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
  }

  function resetFilters() {
    setDraftFilters(emptyListingFilters);
    setAppliedFilters(emptyListingFilters);
  }

  return (
    <>
      <details className="group mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:mt-5 lg:mt-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-black text-[#060b27] marker:hidden [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0875d1]">
              <Filter className="h-4 w-4" />
            </span>
            <span className="min-w-0">Фильтры</span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
            {formatCount(liveCount)}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-90" />
        </summary>

        <form onSubmit={applyFilters} className="border-t border-slate-100 px-3 pb-3">
          <div className="mt-3 space-y-3 sm:mt-4 lg:mt-5 lg:space-y-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-700 sm:text-sm">Поиск</span>
              <span className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-500 focus-within:border-[#0875d1] sm:h-11">
                <Search className="h-4 w-4" />
                <input
                  className="min-w-0 w-full bg-transparent outline-none"
                  value={draftFilters.query}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Название или описание"
                />
              </span>
            </label>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-3">
              <label className="block">
                <span className="text-xs font-bold text-slate-700 sm:text-sm">Цена от</span>
                <input
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-11"
                  inputMode="numeric"
                  value={draftFilters.priceFrom}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, priceFrom: event.target.value }))}
                  placeholder="0 ₽"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-700 sm:text-sm">Цена до</span>
                <input
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#0875d1] sm:h-11"
                  inputMode="numeric"
                  value={draftFilters.priceTo}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, priceTo: event.target.value }))}
                  placeholder="50 000 ₽"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs font-semibold text-slate-700 sm:gap-3 sm:p-3 sm:text-sm">
              <input
                type="checkbox"
                checked={draftFilters.messengerOnly}
                onChange={(event) => setDraftFilters((current) => ({ ...current, messengerOnly: event.target.checked }))}
                className="h-4 w-4 accent-[#0875d1]"
              />
              Только с сообщениями
            </label>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <p className="text-xs font-semibold text-slate-500 sm:text-sm">
                Подходит под фильтры: <span className="font-black text-[#060b27]">{formatCount(liveCount)}</span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]">
                  Сбросить
                </button>
                <button type="submit" className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-black text-white transition hover:bg-[#0664b2]">
                  Применить
                </button>
              </div>
            </div>

            {filtersChanged ? <p className="text-xs font-semibold text-amber-700">Список обновится после нажатия «Применить».</p> : null}
          </div>
        </form>
      </details>

      <div className="mt-5 space-y-3 sm:mt-6 sm:space-y-4 lg:mt-7">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            Показано: <strong className="text-[#060b27]">{formatCount(visibleTotal)}</strong>
          </span>
        </div>
        <DemoListingFeed categorySlug={categorySlug} filters={appliedFilters} kind={kind} subcategorySlug={subcategorySlug} />
        {visibleListings.map((listing) => (
          <ListingCard key={listing.slug} listing={listing} />
        ))}
        {!visibleTotal ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            {emptyText ?? "В этой подборке пока нет объявлений. Попробуйте другой раздел или создайте новую публикацию."}
          </div>
        ) : null}
      </div>
    </>
  );
}
