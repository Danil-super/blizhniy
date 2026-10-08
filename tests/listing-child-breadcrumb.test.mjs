import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = fileURLToPath(new URL("../", import.meta.url));

// Execute the complete presentation module and all application dependencies.
// Only Next request/router/host-element edges are adapted for Node SSR.
function harness() {
  const modules = new Map();
  const framework = {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { __esModule: true, default: (props) => React.createElement("img", Object.fromEntries(Object.entries(props).filter(([key]) => !["fill", "priority", "unoptimized"].includes(key)))) },
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": {
      notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
      redirect: () => { throw new Error("Unexpected redirect"); },
      permanentRedirect: () => { throw new Error("Unexpected permanent redirect"); },
      usePathname: () => "/obyavlenie/synthetic",
      useSearchParams: () => new URLSearchParams(),
      useRouter: () => ({ push: () => { throw new Error("Unexpected navigation"); }, replace: () => { throw new Error("Unexpected navigation"); }, refresh: () => {} }),
    },
  };
  const context = vm.createContext({
    console, Error, URL, URLSearchParams, Headers, Response, AbortController, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "production", ENABLE_DEMO_CONTENT: "false" } },
    fetch: () => { throw new Error("Breadcrumb regression must never use network"); },
  });
  function load(filename) {
    const path = resolve(root, filename);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} };
    modules.set(path, module);
    if (path.endsWith(".json")) {
      module.exports = JSON.parse(readFileSync(path, "utf8"));
      return module.exports;
    }
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: path })((specifier) => {
      if (Object.hasOwn(framework, specifier)) return framework[specifier];
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
      const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(path), specifier);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((candidate) => existsSync(candidate) && /\.(ts|tsx|json)$/.test(candidate));
      assert.ok(dependency, `Unresolved actual source dependency ${specifier}`);
      return load(dependency);
    }, module, module.exports);
    return module.exports;
  }
  return { load, modules };
}

const runtime = harness();
const presentation = runtime.load("src/components/listings/ListingPages.tsx");
const instrumentData = runtime.load("src/lib/instrument-subcategories.ts").instrumentSubcategories;
const posudaData = runtime.load("src/lib/posuda-subcategories.ts").posudaSubcategories;

function stored(categorySlug, subcategory) {
  return {
    id: "11111111-1111-4111-8111-111111111111", slug: "synthetic-listing", ownerKey: "22222222-2222-4222-8222-222222222222",
    title: "Synthetic listing", categorySlug, subcategory, kind: "prodam", city: "Краснодар", author: "Synthetic seller",
    description: "Synthetic description", status: "published", paid: true, price: "1200 ₽", images: [], imageTone: "blue",
    publishedAt: "2026-10-01T00:00:00Z", expiresAt: "2099-10-01T00:00:00Z", viewCount: 0,
    showExactAddress: false, address: "Private street, 41", lat: 45.123456, lng: 38.987654, hasMapPoint: true,
  };
}

function breadcrumbHtml(listing) {
  const tree = presentation.ListingDetailPage({ slug: listing.slug, listingOverride: listing });
  const html = renderToStaticMarkup(tree);
  const nav = html.match(/<nav\b[^>]*aria-label="Хлебные крошки"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, "Actual detail and Breadcrumbs component must render");
  return nav;
}

for (const [categorySlug, items] of [["instrumenty", instrumentData], ["posuda", posudaData]]) {
  for (const item of items) {
    test(`${categorySlug}/${item.slug}: actual mapper/rendered breadcrumb matches dedicated route data`, async () => {
      const value = presentation.toDemoListing(stored(categorySlug, item.name));
      assert.equal(value.subcategorySlug, item.slug, "canonical dedicated data is the authority, not lowercase Cyrillic");
      assert.equal(presentation.slugifySubcategory(item.name), item.slug);
      assert.match(value.subcategorySlug, /^[a-z0-9-]+$/);
      const nav = breadcrumbHtml(value);
      assert.ok(nav.includes(`href="/katalog/${categorySlug}/${item.slug}"`));
      assert.ok(nav.includes(item.name));
      assert.doesNotMatch(nav, /href="[^"]*[а-яё][^"]*"/i);
      const route = runtime.load(`src/app/katalog/${categorySlug}/[subcategorySlug]/page.tsx`);
      const props = { params: Promise.resolve({ subcategorySlug: value.subcategorySlug }) };
      assert.equal((await route.generateMetadata(props)).alternates.canonical, `/katalog/${categorySlug}/${item.slug}`);
      const page = await route.default(props);
      assert.ok(page, "Actual dedicated route accepts the mapper's slug, without notFound");
      assert.equal(value.address, undefined);
      assert.equal(value.lat, undefined);
      assert.equal(value.lng, undefined);
    });
  }
}

test("healthy root control: instruments and dishes roots never invent a child breadcrumb", () => {
  for (const [categorySlug, name] of [["instrumenty", "Инструменты"], ["posuda", "Посуда"]]) {
    const value = presentation.toDemoListing(stored(categorySlug, name));
    assert.equal(value.subcategorySlug, "");
    const nav = breadcrumbHtml(value);
    assert.ok(nav.includes(`href="/katalog/${categorySlug}"`));
    assert.equal((nav.match(new RegExp(`href="/katalog/${categorySlug}`, "g")) ?? []).length, 1);
  }
});

test("healthy generic control: existing mapped and unknown generic slugs remain unchanged", () => {
  assert.equal(presentation.slugifySubcategory("Смартфоны"), "smartfony");
  assert.equal(presentation.slugifySubcategory("Садовый инвентарь"), "sadovyy-inventar");
  assert.equal(presentation.slugifySubcategory("Unknown Generic Child"), "unknown-generic-child");
  const value = presentation.toDemoListing(stored("elektronika", "Смартфоны"));
  assert.ok(breadcrumbHtml(value).includes('href="/katalog/elektronika/smartfony"'));
});

test("healthy route control: dedicated routes still reject an unsupported slug", async () => {
  for (const category of ["instrumenty", "posuda"]) {
    const route = runtime.load(`src/app/katalog/${category}/[subcategorySlug]/page.tsx`);
    await assert.rejects(route.default({ params: Promise.resolve({ subcategorySlug: "unknown-slug" }) }), /NEXT_NOT_FOUND/);
  }
  assert.ok(runtime.modules.has(resolve(root, "src/components/listings/ListingCard.tsx")));
  assert.ok(runtime.modules.has(resolve(root, "src/lib/data.ts")));
});
