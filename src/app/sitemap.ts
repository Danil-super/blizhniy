import type { MetadataRoute } from "next";
import { categories, listingKinds, professions, specialists, vacancies } from "@/lib/data";
import { demoListings, slugifySubcategory } from "@/components/listings/ListingPages";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://blizhniy.example";
  const categoryPaths = categories.flatMap((category) => [
    `/blizhniy/${category.slug}`,
    ...category.children.map((child) => `/blizhniy/${category.slug}/${slugifySubcategory(child)}`),
  ]);
  const listingKindPaths = listingKinds.map((kind) => `/blizhniy/${kind.slug}`);
  const listingPaths = demoListings.map((listing) => `/blizhniy/obyavlenie/${listing.slug}`);
  const vacancyPaths = vacancies.map((vacancy) => `/blizhniy/vakansiya/${vacancy.id}`);
  const specialistPaths = specialists.map((specialist) => `/blizhniy/specialist/${specialist.id}`);
  const professionPaths = professions.map((profession) => `/blizhniy/rabota/specialisty/${profession.slug}`);

  return [
    "",
    "/blizhniy",
    "/blizhniy/kategorii",
    "/blizhniy/rabota",
    "/blizhniy/rabota/vakansii",
    "/blizhniy/rabota/vakansii/sozdat",
    "/blizhniy/rabota/specialisty",
    "/blizhniy/rabota/specialisty/anketa",
    "/blizhniy/rabota/specialisty/klassifikator",
    "/poisk",
    "/auth",
    "/legal/user-agreement",
    "/legal/privacy",
    ...listingKindPaths,
    ...categoryPaths,
    ...listingPaths,
    ...vacancyPaths,
    ...specialistPaths,
    ...professionPaths,
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
