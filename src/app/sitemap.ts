import type { MetadataRoute } from "next";
import { demoListings, slugifySubcategory } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";
import { listingKinds, professions, specialists, vacancies, workRequests } from "@/lib/data";
import { shouldShowFallbackContent } from "@/lib/runtime-mode";
import { getPublicSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getPublicSiteUrl();
  const categories = await getPublicCategories();
  const categoryPaths = categories.flatMap((category) => [
    `/katalog/${category.slug}`,
    ...category.children.map((child) => `/katalog/${category.slug}/${slugifySubcategory(child)}`),
  ]);
  const listingKindPaths = listingKinds.map((kind) => `/obyavleniya/${kind.slug}`);
  const fallbackContentEnabled = shouldShowFallbackContent();
  const listingPaths = fallbackContentEnabled ? demoListings.map((listing) => `/obyavlenie/${listing.slug}`) : [];
  const vacancyPaths = fallbackContentEnabled ? vacancies.map((vacancy) => `/vakansiya/${vacancy.id}`) : [];
  const workRequestPaths = fallbackContentEnabled ? workRequests.map((request) => `/rabota/zakazy/${request.id}`) : [];
  const specialistPaths = fallbackContentEnabled ? specialists.map((specialist) => `/specialist/${specialist.id}`) : [];
  const professionPaths = professions.map((profession) => `/rabota/specialisty/${profession.slug}`);

  return [
    "",
    "/obyavleniya",
    "/katalog",
    "/rabota",
    "/rabota/vakansii",
    "/rabota/specialisty",
    "/kak-rabotaet",
    "/tarify",
    "/o-proekte",
    "/yarmarka-masterov",
    "/legal/offer",
    "/legal/agreement",
    "/legal/privacy",
    ...listingKindPaths,
    ...categoryPaths,
    ...listingPaths,
    ...vacancyPaths,
    ...workRequestPaths,
    ...specialistPaths,
    ...professionPaths,
  ].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
