import type { MetadataRoute } from "next";
import { slugifySubcategory } from "@/components/listings/ListingPages";
import { getPublicCategories } from "@/lib/category-store";
import { professions } from "@/lib/data";
import { instrumentSubcategories } from "@/lib/instrument-subcategories";
import { posudaSubcategories } from "@/lib/posuda-subcategories";
import { getPublicSiteUrl } from "@/lib/site-url";
import { isSupabaseRestConfigured, supabaseRest } from "@/lib/supabase-rest";

type PublishedRow = { id: string; published_at?: string | null };
type PublishedTable = "listings" | "vacancies";

export const dynamic = "force-dynamic";

async function publishedUrls(table: PublishedTable, pathPrefix: string, filters: string): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseRestConfigured()) return [];

  const base = getPublicSiteUrl();
  const entries: MetadataRoute.Sitemap = [];
  const batchSize = 500;

  for (let offset = 0; ; offset += batchSize) {
    const rows = await supabaseRest<PublishedRow[]>(
      `/rest/v1/${table}?select=id,published_at&status=eq.published${filters}&order=id.asc&limit=${batchSize}&offset=${offset}`,
      { attempts: 1, timeoutMs: 5000 },
    );

    for (const row of rows) {
      const date = row.published_at;
      const lastModified = date && Number.isFinite(Date.parse(date)) ? new Date(date) : undefined;
      entries.push({ url: `${base}${pathPrefix}/${row.id}`, lastModified, changeFrequency: "weekly", priority: 0.7 });
    }

    if (rows.length < batchSize) break;
  }

  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getPublicSiteUrl();
  const categories = await getPublicCategories();
  const categoryPaths = categories.flatMap((category) => {
    if (category.slug === "rabota" || category.slug === "yarmarka-masterov") return [];

    const childPaths = category.children.flatMap((child) => {
      const slug = category.slug === "instrumenty"
        ? instrumentSubcategories.find((item) => item.name === child)?.slug
        : category.slug === "posuda"
          ? posudaSubcategories.find((item) => item.name === child)?.slug
          : slugifySubcategory(child);

      return slug ? [`/katalog/${category.slug}/${slug}`] : [];
    });

    return [`/katalog/${category.slug}`, ...childPaths];
  });
  const staticPaths = [
    "",
    "/obyavleniya",
    "/katalog",
    "/rabota",
    "/rabota/vakansii",
    "/rabota/zakazy",
    "/rabota/specialisty",
    "/kak-rabotaet",
    "/tarify",
    "/o-proekte",
    "/rekvizity",
    "/yarmarka-masterov",
    "/legal/offer",
    "/legal/agreement",
    "/legal/privacy",
    ...categoryPaths,
    ...professions.filter((profession) => profession.active).map((profession) => `/rabota/specialisty/${profession.slug}`),
  ];
  const expiresAfter = encodeURIComponent(new Date().toISOString());
  const publicationEntries = process.env.BLIZHNIY_AUTH_MODE === "postgres"
    ? await (await import("@/lib/production-sitemap-runtime")).listPrimarySitemapEntries(base)
    : (await Promise.all([
      publishedUrls("listings", "/obyavlenie", `&is_paid=eq.true&expires_at=gt.${expiresAfter}`),
      publishedUrls("vacancies", "/vakansiya", `&is_paid=eq.true&expires_at=gt.${expiresAfter}`),
    ])).flat();

  const entries = [
    ...Array.from(new Set(staticPaths)).map((path) => ({ url: `${base}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.7 })),
    ...publicationEntries,
  ];
  if (entries.length > 50000) throw new Error("Public sitemap requires partitioning");
  return entries;
}
