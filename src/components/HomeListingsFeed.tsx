"use client";

import { useEffect, useMemo, useState } from "react";
import { DemoGridCard } from "@/components/DemoListingFeed";
import { DemoListing, ListingGridCard } from "@/components/listings/ListingCard";
import { demoPublicationsStorageKey, type DemoPublication } from "@/lib/demo-publications";
import { publicationTimestamp } from "@/lib/publication-time";

type HomeListingsFeedProps = {
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

function readStoredListings() {
  try {
    const stored = window.localStorage.getItem(demoPublicationsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is DemoPublication => Boolean(item && typeof item === "object" && "type" in item && item.type === "listing"));
    }
  } catch {
    return [];
  }

  return [];
}

export function HomeListingsFeed({ listings }: HomeListingsFeedProps) {
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
    const storedEntries: FeedEntry[] = storedListings.map((item) => ({
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
  }, [listings, storedListings]);

  return (
    <>
      {entries.map((entry) => (entry.type === "stored" ? <DemoGridCard key={entry.id} item={entry.item} /> : <ListingGridCard key={entry.id} listing={entry.item} />))}
    </>
  );
}
