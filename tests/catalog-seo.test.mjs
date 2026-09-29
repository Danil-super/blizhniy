import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("catalog pages consolidate pagination and expose crawlable category context", () => {
  const dynamicCategorySource = readFileSync(new URL("../src/app/katalog/[categorySlug]/page.tsx", import.meta.url), "utf8");
  const dynamicSubcategorySource = readFileSync(new URL("../src/app/katalog/[categorySlug]/[subcategorySlug]/page.tsx", import.meta.url), "utf8");
  const instrumentsSource = readFileSync(new URL("../src/app/katalog/instrumenty/page.tsx", import.meta.url), "utf8");
  const dishesSource = readFileSync(new URL("../src/app/katalog/posuda/page.tsx", import.meta.url), "utf8");
  const seoContentSource = readFileSync(new URL("../src/components/listings/CatalogSeoContent.tsx", import.meta.url), "utf8");

  for (const source of [dynamicCategorySource, dynamicSubcategorySource, instrumentsSource, dishesSource]) {
    assert.match(source, /canonical: ["`]\/katalog/);
    assert.match(source, /page > 1 \? \{ index: false, follow: true \}/);
  }

  assert.match(seoContentSource, /BreadcrumbList/);
  assert.match(seoContentSource, /CollectionPage/);
  assert.match(seoContentSource, /Смотрите также/);
  assert.match(seoContentSource, /replace\(\/</);
});

test("all catalogue subcategory slugs are stable latin URLs and legacy slugs redirect", () => {
  const listingPagesSource = readFileSync(new URL("../src/components/listings/ListingPages.tsx", import.meta.url), "utf8");
  const slugFunction = listingPagesSource.match(/export function slugifySubcategory\([\s\S]*?(?=\nfunction Breadcrumbs)/)?.[0];
  assert.ok(slugFunction);

  const exports = {};
  vm.runInNewContext(compile(slugFunction), { exports });

  const expectedSlugs = {
    "Уход и косметика": "uhod-i-kosmetika",
    "Меняю": "menyayu",
    "Отдам даром": "otdam-darom",
    "Коллекции и антиквариат": "kollektsii-i-antikvariat",
    "Ремонт и строительство": "remont-i-stroitelstvo",
    "Бытовые услуги": "bytovye-uslugi",
  };
  for (const [name, slug] of Object.entries(expectedSlugs)) {
    assert.equal(exports.slugifySubcategory(name), slug);
    assert.match(slug, /^[a-z0-9-]+$/);
  }

  const routeSource = readFileSync(new URL("../src/app/katalog/[categorySlug]/[subcategorySlug]/page.tsx", import.meta.url), "utf8");
  assert.match(routeSource, /permanentRedirect\(/);
  assert.match(routeSource, /legacySubcategorySlug/);
});

test("listing pagination filters before offset and redacts hidden location", async () => {
  const source = readFileSync(new URL("../src/lib/listing-store.ts", import.meta.url), "utf8");
  const redaction = source.match(/function publicListing\([\s\S]*?(?=\nasync function findCategoryId\()/)?.[0];
  const reader = source.match(/export async function listStoredListings\([\s\S]*?(?=\nexport async function )/)?.[0];
  assert.ok(redaction && reader);

  const rows = Array.from({ length: 56 }, (_, index) => ({
    id: index + 1,
    kind: index < 7 ? "buy" : "sell",
    address: "Private street 41",
    lat: 45.12,
    lng: 38.91,
    showExactAddress: false,
    hasMapPoint: true,
  }));
  const queries = [];
  const exports = {};
  vm.runInNewContext(compile(`${redaction}\n${reader}`), {
    exports,
    isSupabaseRestConfigured: () => true,
    dbTypeByListingKind: { prodam: "sell" },
    Date,
    encodeURIComponent,
    fetchListingRows: async (query) => {
      const params = new URL(`https://example.test/?${query.slice(1)}`).searchParams;
      queries.push(params);
      return rows
        .filter((row) => row.kind === params.get("listing_type")?.slice(3))
        .slice(Number(params.get("offset")), Number(params.get("offset")) + Number(params.get("limit")));
    },
    mapListing: (row) => ({ ...row }),
    console,
  });

  const page = await exports.listStoredListings(24, { kind: "prodam", offset: 24 });
  assert.equal(page.length, 24);
  assert.equal(page[0].id, 32);
  assert.equal(queries[0].get("listing_type"), "eq.sell");
  assert.equal(queries[0].get("offset"), "24");
  assert.ok(page.every((item) => item.address === undefined && item.lat === undefined && item.lng === undefined));
});

test("sitemap spans batches, includes paid active URLs, and omits redirects and unsupported routes", async () => {
  const source = readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  const exports = {};
  const requests = [];
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `listing-${index}`,
    published_at: "2026-09-25T00:00:00Z",
    is_paid: true,
    expires_at: "2027-09-25T00:00:00Z",
  }));
  rows.push({ id: "unpaid", published_at: "2026-09-25T00:00:00Z", is_paid: false, expires_at: "2027-09-25T00:00:00Z" });
  rows.push({ id: "expired", published_at: "2026-09-25T00:00:00Z", is_paid: true, expires_at: "2025-09-25T00:00:00Z" });
  const mockModules = {
    "@/components/listings/ListingPages": { slugifySubcategory: (name) => name.toLowerCase() },
    "@/lib/category-store": {
      getPublicCategories: async () => [
        { slug: "dom", children: ["mebel"] },
        { slug: "instrumenty", children: ["Missing specialized slug"] },
        { slug: "rabota", children: ["work"] },
      ],
    },
    "@/lib/data": { professions: [{ slug: "active", active: true }, { slug: "inactive", active: false }] },
    "@/lib/instrument-subcategories": { instrumentSubcategories: [] },
    "@/lib/posuda-subcategories": { posudaSubcategories: [] },
    "@/lib/site-url": { getPublicSiteUrl: () => "https://example.test" },
    "@/lib/supabase-rest": {
      isSupabaseRestConfigured: () => true,
      supabaseRest: async (path) => {
        requests.push(path);
        const url = new URL(`https://example.test${path}`);
        if (url.pathname.endsWith("/vacancies")) return [];
        return rows
          .filter((row) => row.is_paid && Date.parse(row.expires_at) > Date.now())
          .slice(Number(url.searchParams.get("offset")), Number(url.searchParams.get("offset")) + Number(url.searchParams.get("limit")));
      },
    },
  };
  vm.runInNewContext(compile(source), { exports, require: (id) => mockModules[id], Date, Promise, encodeURIComponent, Set, Array, Number });
  const sitemap = await exports.default();
  const urls = sitemap.map((entry) => entry.url);

  assert.equal(urls.filter((url) => url.includes("/obyavlenie/")).length, 501);
  assert.ok(urls.includes("https://example.test/obyavlenie/listing-500"));
  assert.ok(urls.includes("https://example.test/katalog/dom/mebel"));
  assert.ok(urls.includes("https://example.test/rabota/specialisty/active"));
  assert.ok(!urls.some((url) => /unpaid|expired|inactive|Missing|\/obyavleniya\/prodam|\/katalog\/rabota/.test(url)));
  assert.ok(requests.every((path) => /\/(listings|vacancies)\?/.test(path) && path.includes("is_paid=eq.true") && path.includes("expires_at=gt.")));
});
