import type { DemoListing, ListingKind } from "@/components/listings/ListingCard";
import type { DemoPublication } from "@/lib/demo-publications";

export type ListingFilterCriteria = {
  query: string;
  priceFrom: string;
  priceTo: string;
  messengerOnly: boolean;
};

export const emptyListingFilters: ListingFilterCriteria = {
  query: "",
  priceFrom: "",
  priceTo: "",
  messengerOnly: false,
};

export function normalizeListingFilters(filters: ListingFilterCriteria): ListingFilterCriteria {
  return {
    query: filters.query.trim(),
    priceFrom: filters.priceFrom.trim(),
    priceTo: filters.priceTo.trim(),
    messengerOnly: filters.messengerOnly,
  };
}

export function listingFiltersEqual(first: ListingFilterCriteria, second: ListingFilterCriteria) {
  const normalizedFirst = normalizeListingFilters(first);
  const normalizedSecond = normalizeListingFilters(second);

  return (
    normalizedFirst.query === normalizedSecond.query &&
    normalizedFirst.priceFrom === normalizedSecond.priceFrom &&
    normalizedFirst.priceTo === normalizedSecond.priceTo &&
    normalizedFirst.messengerOnly === normalizedSecond.messengerOnly
  );
}

export function parsePriceValue(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("бесплат")) {
    return 0;
  }

  const match = normalized.replace(",", ".").match(/\d[\d\s.]*/);

  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0].replace(/\s/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function includesQuery(values: Array<string | undefined>, query: string) {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function matchesPrice(price: string | undefined, filters: ListingFilterCriteria) {
  const from = parsePriceValue(filters.priceFrom);
  const to = parsePriceValue(filters.priceTo);

  if (from === undefined && to === undefined) {
    return true;
  }

  const value = parsePriceValue(price);

  if (value === undefined) {
    return false;
  }

  return (from === undefined || value >= from) && (to === undefined || value <= to);
}

export function matchesDemoListingFilters(listing: DemoListing, filters: ListingFilterCriteria) {
  const normalized = normalizeListingFilters(filters);

  return (
    includesQuery(
      [
        listing.title,
        listing.description,
        listing.price,
        listing.city,
        listing.district,
        listing.categoryName,
        listing.subcategoryName,
      ],
      normalized.query,
    ) &&
    matchesPrice(listing.price, normalized) &&
    (!normalized.messengerOnly || Boolean(listing.messengerUrl))
  );
}

export function matchesDemoPublicationFilters(item: DemoPublication, filters: ListingFilterCriteria) {
  const normalized = normalizeListingFilters(filters);

  return (
    includesQuery([item.title, item.subtitle, item.description, item.price, item.city], normalized.query) &&
    matchesPrice(item.price, normalized) &&
    (!normalized.messengerOnly || Boolean(item.messengerUrl))
  );
}

export function matchesListingScope(
  item: Pick<DemoPublication, "type" | "listingKind" | "categorySlug" | "subcategorySlug">,
  scope: {
    categorySlug?: string;
    kind?: ListingKind | ListingKind[];
    subcategorySlug?: string;
  },
) {
  const visibleKinds = Array.isArray(scope.kind) ? scope.kind : scope.kind ? [scope.kind] : [];

  return (
    item.type === "listing" &&
    (!visibleKinds.length || visibleKinds.includes(item.listingKind ?? "prodam")) &&
    (!scope.categorySlug || item.categorySlug === scope.categorySlug) &&
    (!scope.subcategorySlug || item.subcategorySlug === scope.subcategorySlug)
  );
}
