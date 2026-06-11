import type { MetadataRoute } from "next";
import { categories, listingKinds, professions, specialists, vacancies, workRequests } from "@/lib/data";
import { demoListings, slugifySubcategory } from "@/components/listings/ListingPages";
import { getPublicSiteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getPublicSiteUrl();
  const categoryPaths = categories.flatMap((category) => [
    `/krasnodar/${category.slug}`,
    ...category.children.map((child) => `/krasnodar/${category.slug}/${slugifySubcategory(child)}`),
  ]);
  const listingKindPaths = listingKinds.map((kind) => `/krasnodar/${kind.slug}`);
  const listingPaths = demoListings.map((listing) => `/obyavlenie/${listing.slug}`);
  const vacancyPaths = vacancies.map((vacancy) => `/vakansiya/${vacancy.id}`);
  const workRequestPaths = workRequests.map((request) => `/krasnodar/rabota/zakazy/${request.id}`);
  const specialistPaths = specialists.map((specialist) => `/specialist/${specialist.id}`);
  const professionPaths = professions.map((profession) => `/krasnodar/rabota/specialisty/${profession.slug}`);

  return [
    "",
    "/krasnodar",
    "/krasnodar/kategorii",
    "/krasnodar/sozdat",
    "/krasnodar/sozdat/obyavlenie",
    "/krasnodar/obmen-i-darom",
    "/krasnodar/rabota",
    "/krasnodar/rabota/zakazy/sozdat",
    "/krasnodar/rabota/vakansii",
    "/krasnodar/rabota/vakansii/sozdat",
    "/krasnodar/rabota/specialisty",
    "/krasnodar/rabota/specialisty/anketa",
    "/krasnodar/rabota/specialisty/klassifikator",
    "/kak-rabotaet",
    "/tarify",
    "/o-proekte",
    "/yarmarka-masterov",
    "/yarmarka-masterov/zayavka",
    "/poisk",
    "/legal/user-agreement",
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
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
