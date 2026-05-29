export function getDemoListingViews(seed: string) {
  const hash = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);

  return 37 + (hash % 420);
}

export const listingViewCountsStorageKey = "blizhniy-listing-view-counts";
export const listingViewCountsUpdatedEvent = "blizhniy-listing-view-counts-updated";

type ListingViewCounts = Record<string, number>;

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

export function getListingExtraViews(listingId: string) {
  return readCounts()[listingId] ?? 0;
}

export function getListingTotalViews(listingId: string) {
  return getDemoListingViews(listingId) + getListingExtraViews(listingId);
}

export function incrementListingViews(listingId: string) {
  if (typeof window === "undefined") {
    return getDemoListingViews(listingId);
  }

  const counts = readCounts();
  counts[listingId] = (counts[listingId] ?? 0) + 1;
  writeCounts(counts);

  return getDemoListingViews(listingId) + counts[listingId];
}
