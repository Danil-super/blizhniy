export function getDemoListingViews(seed: string) {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed) ||
    seed.startsWith("demo-listing-") ||
    seed.startsWith("listing-") ||
    seed.startsWith("vacancy-") ||
    seed.startsWith("specialist-") ||
    seed.startsWith("work-vacancy-") ||
    seed.startsWith("work-request-") ||
    seed.startsWith("work-specialist-")
  ) {
    return 0;
  }

  const hash = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);

  return 37 + (hash % 420);
}

export const listingViewCountsStorageKey = "blizhniy-listing-view-counts";
const viewedListingsStorageKey = "blizhniy-viewed-listing-ids";
export const listingViewCountsUpdatedEvent = "blizhniy-listing-view-counts-updated";

type ListingViewCounts = Record<string, number>;
type ListingViewsUpdatedDetail = {
  listingId: string;
  views: number;
};

function readCounts(): ListingViewCounts {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(listingViewCountsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeCounts(counts: ListingViewCounts) {
  window.localStorage.setItem(listingViewCountsStorageKey, JSON.stringify(counts));
  window.dispatchEvent(new Event(listingViewCountsUpdatedEvent));
}

function readViewedListingIds() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const stored = window.localStorage.getItem(viewedListingsStorageKey);
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;

    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set<string>();
  }
}

function writeViewedListingIds(ids: Set<string>) {
  window.localStorage.setItem(viewedListingsStorageKey, JSON.stringify([...ids]));
}

export function getListingExtraViews(listingId: string) {
  return readCounts()[listingId] ?? 0;
}

function getBaseViews(listingId: string, initialViews?: number) {
  if (typeof initialViews === "number" && Number.isFinite(initialViews)) {
    return Math.max(0, Math.floor(initialViews));
  }

  return getDemoListingViews(listingId);
}

export function getListingTotalViews(listingId: string, initialViews?: number) {
  return getBaseViews(listingId, initialViews) + getListingExtraViews(listingId);
}

export function emitListingViewsUpdated(listingId: string, views: number) {
  if (typeof window === "undefined" || !Number.isFinite(views)) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ListingViewsUpdatedDetail>(listingViewCountsUpdatedEvent, {
      detail: {
        listingId,
        views: Math.max(0, Math.floor(views)),
      },
    }),
  );
}

export function incrementListingViews(listingId: string, initialViews?: number) {
  if (typeof window === "undefined") {
    return getBaseViews(listingId, initialViews);
  }

  const viewedIds = readViewedListingIds();

  if (viewedIds.has(listingId)) {
    return getListingTotalViews(listingId, initialViews);
  }

  const counts = readCounts();
  counts[listingId] = (counts[listingId] ?? 0) + 1;
  viewedIds.add(listingId);
  writeViewedListingIds(viewedIds);
  writeCounts(counts);

  return getBaseViews(listingId, initialViews) + counts[listingId];
}
