import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const ownerId = "22222222-2222-4222-8222-222222222222";
const listingId = "00001399-1111-4111-8111-000000005017";
const miscRoot = { id: "000003f9-1111-4111-8111-000000001017", name: "Разное", slug: "raznoe", parent_id: null };
const clothingRoot = { id: "33333333-3333-4333-8333-333333333333", name: "Одежда, обувь, аксессуары", slug: "odezhda-obuv-aksessuary", parent_id: null };
const miscChild = { id: "00000e74-1111-4111-8111-000000003700", name: "Разное", slug: "misc-child", parent_id: miscRoot.id };
const clothingChild = { id: "44444444-4444-4444-8444-444444444444", name: "Разное", slug: "clothing-misc", parent_id: clothingRoot.id };

function listing(categoryId = miscChild.id, overrides = {}) {
  return {
    id: listingId, author_id: ownerId, category_id: categoryId,
    listing_type: "sell", title: "Синтетический раздел: Разное", description: "Synthetic listing description",
    price: 1200, status: "published", is_paid: true,
    created_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z", expires_at: "2099-10-01T00:00:00Z",
    address: "Hidden Street, 18", latitude: "45.10101", longitude: "38.99999", show_exact_address: false,
    contact_phone: "+79990000000", view_count: 7,
    listing_images: [{ storage_path: "listings/second image.jpg", sort_order: 2 }, { storage_path: "listings/first.jpg", sort_order: 0 }],
    cities: { name: "Краснодар", slug: "krasnodar" }, profiles: { display_name: "Synthetic owner" },
    ...overrides,
  };
}

// Whole source/dependency modules, including the real REST timeout/retry/config
// and public-media mapper. Only fetch is replaced; no mapper or handler copies.
function harness({ rows = [listing()], taxonomy = [miscRoot, clothingRoot, miscChild, clothingChild], noViewCount = false, parentOverride, parentLookupFails = false, rawWriteMode } = {}) {
  const calls = [];
  const writes = [];
  const errors = [];
  let parentChunk = 0;
  const modules = new Map();
  const env = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-only" };
  const context = vm.createContext({
    console: { ...console, error: (...args) => errors.push(args.map(String)) },
    Error, URL, URLSearchParams, Response, AbortController, setTimeout, clearTimeout,
    process: { env },
    fetch: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, env.NEXT_PUBLIC_SUPABASE_URL);
      if (options.method !== "GET") {
        assert.ok(rawWriteMode, "Default harness permits no writes");
        if (options.method === "DELETE") {
          assert.equal(rawWriteMode, "update");
          assert.equal(url.pathname, "/rest/v1/listing_images");
          assert.equal(url.search, `?listing_id=eq.${listingId}`);
          writes.push({ method: options.method, path: url.pathname });
          calls.push(url);
          return Response.json(null);
        }
        assert.equal(url.pathname, "/rest/v1/listings");
        assert.equal(options.method, rawWriteMode === "create" ? "POST" : "PATCH");
        const body = JSON.parse(options.body);
        assert.equal(body.category_id, miscChild.id);
        if (rawWriteMode === "create") assert.equal(body.author_id, ownerId);
        else {
          assert.equal(url.searchParams.get("id"), `eq.${listingId}`);
          assert.equal(url.searchParams.get("author_id"), `eq.${ownerId}`);
        }
        writes.push({ method: options.method, path: url.pathname, body });
      }
      assert.equal(options.cache, "no-store");
      calls.push(url);
      const query = url.searchParams;
      const select = query.get("select");
      assert.ok(select);
      const allowed = new Set(["select", "id", "author_id", "category_id", "status", "is_paid", "expires_at", "listing_type", "title", "order", "limit", "offset", "slug", "name", "parent_id"]);
      for (const key of query.keys()) assert.ok(allowed.has(key), `Unknown query field ${key}`);
      let values;
      if (url.pathname === "/rest/v1/categories") {
        values = taxonomy;
        if (query.has("id")) {
          assert.equal(select, "id,slug");
          const ids = query.get("id").slice(4, -1).split(",");
          assert.equal(query.get("id"), `in.(${ids.join(",")})`);
          assert.equal(new Set(ids).size, ids.length, "parent IDs must be deduplicated");
          assert.ok(ids.length <= 100, "each parent lookup URI stays bounded");
          assert.equal(Number(query.get("limit")), ids.length, "limit must cover every requested parent");
          const failure = typeof parentLookupFails === "function" ? parentLookupFails(++parentChunk) : parentLookupFails;
          if (failure) return Response.json({ message: typeof failure === "string" ? failure : "Synthetic category lookup unavailable" }, { status: typeof failure === "number" ? failure : 400 });
          if (parentOverride !== undefined) values = parentOverride ? [parentOverride] : [];
        }
      } else if (url.pathname === "/rest/v1/cities") {
        assert.ok(rawWriteMode, "City lookups belong only to opt-in raw-write cases");
        values = [{ id: ownerId, name: "Краснодар", slug: "krasnodar", region_id: ownerId }];
      } else {
        assert.equal(url.pathname, "/rest/v1/listings");
        if (noViewCount && select.split(",").includes("view_count")) {
          return Response.json({ message: "column listings.view_count does not exist" }, { status: 400 });
        }
        values = rows;
        if (rawWriteMode && options.method === "GET" && query.has("id") && select.includes("listing_images(")) values = [];
      }
      for (const [key, filter] of query) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (filter.startsWith("eq.")) values = values.filter((row) => String(row[key]) === filter.slice(3));
        else if (filter.startsWith("neq.")) values = values.filter((row) => String(row[key]) !== filter.slice(4));
        else if (filter.startsWith("gt.") && key === "expires_at") values = values.filter((row) => Date.parse(row[key]) > Date.parse(filter.slice(3)));
        else if (filter.startsWith("in.(") && filter.endsWith(")")) values = values.filter((row) => filter.slice(4, -1).split(",").includes(row[key]));
        else if (filter === "is.null") values = values.filter((row) => row[key] == null);
        else throw new Error(`Unknown filter ${key}=${filter}`);
      }
      values = values.slice(Number(query.get("offset") ?? 0));
      if (query.has("limit")) values = values.slice(0, Number(query.get("limit")));
      if (url.pathname === "/rest/v1/listings") {
        values = values.map((row) => {
          const category = taxonomy.find((item) => item.id === row.category_id);
          const result = { ...row, categories: category ? { slug: category.slug, name: category.name, parent_id: category.parent_id } : null };
          if (!select.split(",").includes("view_count")) delete result.view_count;
          return result;
        });
      }
      return Response.json(values);
    },
  });

  function load(filename) {
    const path = resolve(root, filename);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} };
    modules.set(path, module);
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: path })((specifier) => {
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
      const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(path), specifier);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
      assert.ok(dependency, `Unresolved actual source dependency ${specifier}`);
      return load(dependency);
    }, module, module.exports);
    return module.exports;
  }
  return { store: load("src/lib/listing-store.ts"), calls, writes, errors, modules };
}

const readers = [
  ["public feed", (store) => store.listStoredListings()],
  ["public detail", async (store) => [await store.getStoredListingById(listingId, { publicOnly: true })]],
  ["public category scope", (store, category = miscRoot) => store.listStoredListingsForCategory(category.slug, { resolvedCategory: { id: category.id, children: [category.id === miscRoot.id ? miscChild : clothingChild] } })],
  ["public seller", (store) => store.listStoredListingsForSeller(ownerId)],
  ["owner list", (store) => store.listStoredListingsForUser(ownerId)],
  ["owner detail", async (store) => [await store.getStoredListingForUser(listingId, ownerId)]],
  ["admin list", (store) => store.listStoredListingsForAdmin()],
];

for (const [name, read] of readers) {
  test(`${name}: same child display name resolves to each stored parent, not first static match`, async () => {
    const runtime = harness({ rows: [listing(), listing(clothingChild.id, { id: "55555555-5555-4555-8555-555555555555" })] });
    const values = await read(runtime.store);
    assert.equal(values[0]?.categorySlug, "raznoe", "misc DB parent must not become clothing");
    assert.equal(values[0]?.subcategory, "Разное");
    if (values.length === 2) assert.equal(values[1].categorySlug, clothingRoot.slug, "legitimate clothing stays clothing");
    else assert.equal(values.length, 1);
    assert.equal(runtime.errors.length, 0);
    assert.equal(runtime.calls.length, 2, "one listing GET and one bounded parent batch, no per-row lookup");
    assert.ok(runtime.modules.has(resolve(root, "src/lib/supabase-rest.ts")), "real REST module executed");
  });
}

test("healthy control: clothing child remains clothing in all shared readers", async () => {
  for (const [, read] of readers) {
    const runtime = harness({ rows: [listing(clothingChild.id)] });
    assert.equal((await read(runtime.store, clothingRoot))[0]?.categorySlug, clothingRoot.slug);
    assert.equal(runtime.errors.length, 0);
  }
});

test("original browser fixture: root and child both named/sluggified Разное retain the real DB parent", async () => {
  const runtime = harness({ taxonomy: [miscRoot, clothingRoot, { ...miscChild, slug: "raznoe" }, clothingChild] });
  assert.equal((await runtime.store.getStoredListingById(listingId, { publicOnly: true }))?.categorySlug, "raznoe");
});

test("root-verified current DB child slugs preserve their distinct clothing and misc parents", async () => {
  const runtime = harness({ rows: [listing(), listing(clothingChild.id)], taxonomy: [miscRoot, clothingRoot, { ...miscChild, slug: "raznoe-raznoe" }, { ...clothingChild, slug: "odezhda-obuv-aksessuary-raznoe" }] });
  const values = await runtime.store.listStoredListings();
  assert.equal(values[0]?.categorySlug, miscRoot.slug);
  assert.equal(values[1]?.categorySlug, clothingRoot.slug);
});

test("DB parent outside static taxonomy is authoritative even with a repeated static child name", async () => {
  const customRoot = { id: "66666666-6666-4666-8666-666666666666", slug: "custom-db-root", name: "Custom DB root", parent_id: null };
  const customChild = { ...miscChild, parent_id: customRoot.id };
  const runtime = harness({ taxonomy: [customRoot, customChild] });
  assert.equal((await runtime.store.listStoredListings())[0]?.categorySlug, customRoot.slug);
});

test("unavailable stored parent never invents the first static parent for an ambiguous name", async () => {
  const runtime = harness({ taxonomy: [miscChild] });
  assert.equal((await runtime.store.listStoredListings())[0]?.categorySlug, miscChild.slug);
});

test("mismatched batch-returned parent identity is not accepted", async () => {
  const runtime = harness({ parentOverride: { id: clothingRoot.id, slug: clothingRoot.slug } });
  assert.equal((await runtime.store.getStoredListingForUser(listingId, ownerId))?.categorySlug, miscChild.slug);
});

test("top-level DB category keeps its own slug despite matching a static child label", async () => {
  const top = { ...miscChild, slug: "custom-top-level", parent_id: null };
  const runtime = harness({ taxonomy: [top] });
  assert.equal((await runtime.store.listStoredListings())[0]?.categorySlug, top.slug);
});

test("missing category metadata preserves existing listing-kind fallbacks", async () => {
  for (const [listingType, expected] of [["sell", "raznoe"], ["buy", "raznoe"], ["free", "raznoe"], ["rent", "nedvizhimost"]]) {
    const runtime = harness({ taxonomy: [], rows: [listing(null, { listing_type: listingType })] });
    const value = (await runtime.store.listStoredListings())[0];
    assert.equal(value?.categorySlug, expected);
    assert.equal(value?.subcategory, "Объявление");
  }
});

test("missing view_count fallback retains parent identity, ordered media and hidden public location", async () => {
  const runtime = harness({ noViewCount: true });
  const value = await runtime.store.getStoredListingById(listingId, { publicOnly: true });
  assert.equal(value?.categorySlug, miscRoot.slug);
  assert.equal(value?.viewCount, 0);
  assert.equal(value?.address, undefined);
  assert.equal(value?.lat, undefined);
  assert.equal(value?.lng, undefined);
  assert.equal(value?.hasMapPoint, false);
  assert.deepEqual(Array.from(value.images), ["http://127.0.0.1:1/storage/v1/object/public/blizhniy-media/listings/first.jpg", "http://127.0.0.1:1/storage/v1/object/public/blizhniy-media/listings/second%20image.jpg"]);
  assert.equal(runtime.calls.length, 3, "existing view_count fallback then exactly one parent batch");
  assert.equal(runtime.calls[2].pathname, "/rest/v1/categories");
});

test("healthy mapping control: owner keeps location and public opted-in location remains visible", async () => {
  const owner = harness({ rows: [listing(clothingChild.id)] });
  assert.equal((await owner.store.getStoredListingForUser(listingId, ownerId))?.address, "Hidden Street, 18");
  const publicRuntime = harness({ rows: [listing(clothingChild.id, { show_exact_address: true })] });
  const value = await publicRuntime.store.getStoredListingById(listingId, { publicOnly: true });
  assert.equal(value?.address, "Hidden Street, 18");
  assert.equal(value?.lat, 45.10101);
  assert.equal(value?.lng, 38.99999);
  assert.equal(value?.viewCount, 7);
});

test("both reusable owner readers use parent identity through the no-view-count selector", async () => {
  const input = { authorId: ownerId, title: "Синтетический раздел: Разное", description: "Synthetic listing description", kind: "prodam", city: "Краснодар", price: "1200" };
  for (const method of ["findReusableStoredListingForPayment", "findReusableStoredDraftListing"]) {
    const runtime = harness({ rows: [listing(miscChild.id, { status: "draft" })] });
    assert.equal((await runtime.store[method](input))?.categorySlug, miscRoot.slug);
    assert.equal(runtime.calls.length, 2);
    assert.equal(runtime.calls[0].searchParams.get("select").includes("view_count"), false);
  }
});

test("category taxonomy lookup and a large mixed-parent page stay bounded, without N+1", async () => {
  const rows = Array.from({ length: 40 }, (_, index) => listing(index % 2 ? clothingChild.id : miscChild.id, { id: `listing-${index}` }));
  const runtime = harness({ rows });
  const values = await runtime.store.listStoredListings(40);
  assert.equal(values.length, 40);
  assert.equal(runtime.calls.length, 2);
  assert.equal(runtime.calls[1].searchParams.get("id"), `in.(${miscRoot.id},${clothingRoot.id})`);
  assert.equal(runtime.calls[1].searchParams.get("limit"), "2");
  for (const [index, value] of values.entries()) assert.equal(value.categorySlug, index % 2 ? clothingRoot.slug : miscRoot.slug);
  const category = harness();
  assert.equal((await category.store.listStoredListingsForCategory(miscRoot.slug))[0]?.categorySlug, miscRoot.slug);
  assert.equal(category.calls.length, 3, "existing taxonomy scope/listing reads then one parent batch");
});

test("no parent IDs means zero category lookup, including top-level and missing legacy category metadata", async () => {
  for (const taxonomy of [[], [{ ...miscChild, parent_id: null }]]) {
    const runtime = harness({ taxonomy });
    assert.equal((await runtime.store.listStoredListings()).length, 1);
    assert.equal(runtime.calls.length, 1);
  }
});

test("parent lookup failure preserves loaded rows/media/privacy without inventing a name-matched parent", async () => {
  for (const failure of [true, 500, "Synthetic parent lookup error mentions view_count"]) {
    const runtime = harness({ parentLookupFails: failure });
    const value = (await runtime.store.listStoredListings())[0];
    assert.equal(value?.categorySlug, miscChild.slug);
    assert.equal(value?.title, "Синтетический раздел: Разное");
    assert.equal(value?.images.length, 2);
    assert.equal(value?.viewCount, 7);
    assert.equal(value?.address, undefined);
    assert.equal(runtime.calls.length, 2, "one parent attempt; no view_count fallback for parent errors");
    assert.equal(runtime.errors.length, 1);
  }
});

function distinctParentFixture() {
  const uuid = (number) => `${number.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
  const parents = Array.from({ length: 201 }, (_, index) => ({ id: uuid(1000 + index), slug: `custom-root-${index}`, name: `Custom root ${index}`, parent_id: null }));
  const children = parents.map((parent, index) => ({ id: uuid(2000 + index), slug: `child-${index}`, name: "Разное", parent_id: parent.id }));
  const rows = children.map((child, index) => listing(child.id, { id: uuid(3000 + index) }));
  return { parents, children, rows, taxonomy: [...parents, ...children] };
}

test("201 distinct parents are read in complete 100/100/1 chunks, including the final row", async () => {
  const fixture = distinctParentFixture();
  const runtime = harness(fixture);
  const values = await runtime.store.listStoredListings(201);
  assert.equal(values.length, 201);
  assert.equal(values.at(-1)?.categorySlug, "custom-root-200", "no truncation at first batch");
  for (const [index, value] of values.entries()) assert.equal(value.categorySlug, fixture.parents[index].slug);
  const parentQueries = runtime.calls.filter((url) => url.pathname === "/rest/v1/categories");
  assert.deepEqual(parentQueries.map((url) => Number(url.searchParams.get("limit"))), [100, 100, 1]);
  assert.equal(runtime.calls.length, 4);
  const requested = parentQueries.flatMap((url) => url.searchParams.get("id").slice(4, -1).split(","));
  assert.equal(new Set(requested).size, 201);
  assert.ok(parentQueries.every((url) => url.pathname.length + url.search.length < 4100), "bounded URI per chunk");
});

test("failed first parent chunk retains its rows and does not prevent later 100/1 chunks resolving", async () => {
  const fixture = distinctParentFixture();
  for (const publicOnly of [true, false]) {
    const runtime = harness({ ...fixture, parentLookupFails: (chunk) => chunk === 1 ? 500 : false });
    const values = publicOnly ? await runtime.store.listStoredListings(201) : await runtime.store.listStoredListingsForUser(ownerId);
    assert.equal(values.length, 201);
    for (const [index, value] of values.entries()) {
      assert.equal(value.categorySlug, index < 100 ? fixture.children[index].slug : fixture.parents[index].slug);
      assert.equal(value.images.length, 2);
      assert.equal(value.address, publicOnly ? undefined : "Hidden Street, 18");
      assert.equal(value.lat, publicOnly ? undefined : 45.10101);
      assert.equal(value.viewCount, 7);
    }
    assert.deepEqual(runtime.calls.filter((url) => url.pathname === "/rest/v1/categories").map((url) => Number(url.searchParams.get("limit"))), [100, 100, 1]);
    assert.equal(runtime.calls.length, 4, "failure never retries or restarts listing read");
    assert.equal(runtime.errors.length, 1);
  }
});

test("Postgres-valid UUID v7/nonstandard variant parents are not lost to listing-ID validation", async () => {
  const parent = { ...miscRoot, id: "018f302a-0000-7000-0000-000000000001", slug: "uuid-v7-db-root" };
  const runtime = harness({ taxonomy: [parent, { ...miscChild, parent_id: parent.id }] });
  assert.equal((await runtime.store.listStoredListings())[0]?.categorySlug, parent.slug);
  assert.equal(runtime.calls.length, 2);
});

test("malformed legacy parent metadata issues no parent query and never guesses a static root", async () => {
  const runtime = harness({ taxonomy: [{ ...miscChild, parent_id: "not-a-uuid" }] });
  assert.equal((await runtime.store.listStoredListings())[0]?.categorySlug, miscChild.slug);
  assert.equal(runtime.calls.length, 1);
});

for (const mode of ["create", "update", "save"]) {
  test(`raw ${mode} response fallback retains parent identity when ordinary detail GET returns no row`, async () => {
    const runtime = harness({ rawWriteMode: mode, rows: [listing(miscChild.id, { status: "draft" })] });
    const input = { authorId: ownerId, categorySlug: miscRoot.slug, subcategory: miscChild.name, title: "Synthetic saved listing", kind: "prodam", city: "Краснодар", status: "draft" };
    const value = mode === "create" ? await runtime.store.createStoredListing(input)
      : mode === "update" ? await runtime.store.updateStoredListingForUser(listingId, ownerId, input)
        : await runtime.store.saveStoredListingForUser(listingId, ownerId, input);
    assert.equal(value?.categorySlug, miscRoot.slug);
    assert.equal(value?.subcategory, miscChild.name);
    assert.equal(value?.ownerKey, ownerId);
    assert.equal(value?.address, "Hidden Street, 18", "internal write response remains owner-private");
    assert.deepEqual(runtime.writes.map((write) => write.method), mode === "create" ? ["POST"] : mode === "update" ? ["PATCH", "DELETE"] : ["PATCH"]);
    assert.ok(runtime.calls.some((url) => url.pathname === "/rest/v1/listings" && url.searchParams.get("limit") === "1" && url.searchParams.get("select").includes("listing_images(")), "ordinary detail reader actually ran");
    assert.equal(runtime.calls.at(-1).searchParams.get("id"), `in.(${miscRoot.id})`, "raw fallback lazily resolves its stored parent");
    assert.equal(runtime.errors.length, 0);
  });
}
