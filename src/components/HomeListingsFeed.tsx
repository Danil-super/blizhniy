"use client";

import { useEffect, useMemo, useState } from "react";
import { DemoGridCard } from "@/components/DemoListingFeed";
import { DemoListing, ListingGridCard, type ListingKind } from "@/components/listings/ListingCard";
import { demoPublicationsStorageKey, isDemoPublicationPubliclyVisible, type DemoPublication } from "@/lib/demo-publications";
import { publicationTimestamp } from "@/lib/publication-time";

type HomeListingsFeedProps = {
  kind?: ListingKind;
  listings: DemoListing[];
};

type FeedEntry =
  | {
      id: string;
      item: DemoPublication;
      timestamp: number;
      type: "stored";
    }
  | {
      id: string;
      item: DemoListing;
      timestamp: number;
      type: "demo";
    };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLocalOnlyPublication(item: DemoPublication) {
  return !uuidPattern.test(item.id);
}

function readStoredListings() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "type" in item && item.type === "listing"))
        .filter(isLocalOnlyPublication)
        .filter(isDemoPublicationPubliclyVisible);
    }
  } catch {
    return [];
  }

  return [];
}

export function HomeListingsFeed({ kind, listings }: HomeListingsFeedProps) {
  const [storedListings, setStoredListings] = useState<DemoPublication[]>([]);

  useEffect(() => {
    function syncItems() {
      setStoredListings(readStoredListings());
    }

    syncItems();
    window.addEventListener("storage", syncItems);
    window.addEventListener("blizhniy-demo-publications-updated", syncItems);

    return () => {
      window.removeEventListener("storage", syncItems);
      window.removeEventListener("blizhniy-demo-publications-updated", syncItems);
    };
  }, []);

  const entries = useMemo(() => {
    const storedEntries: FeedEntry[] = storedListings
      .filter((item) => !kind || (item.listingKind ?? "prodam") === kind)
      .map((item) => ({
        id: `stored-${item.id}`,
        item,
        timestamp: publicationTimestamp(item.createdAt),
        type: "stored",
      }));

    const demoEntries: FeedEntry[] = listings.map((item) => ({
      id: `demo-${item.slug}`,
      item,
      timestamp: publicationTimestamp(item.publishedAt),
      type: "demo",
    }));

    return [...storedEntries, ...demoEntries].sort((left, right) => right.timestamp - left.timestamp);
  }, [kind, listings, storedListings]);

  return (
    <>
      {entries.length ? (
        entries.map((entry) => (entry.type === "stored" ? <DemoGridCard key={entry.id} item={entry.item} /> : <ListingGridCard key={entry.id} listing={entry.item} />))
      ) : (
        <p className="col-span-full rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">
          По выбранному фильтру пока нет объявлений.
        </p>
      )}
    </>
  );
}
