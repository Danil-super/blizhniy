import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");

const base = new URL(baseUrl);

function pageUrl(pathname) {
  return new URL(pathname, base).href;
}

function requestOptions(options = {}) {
  return {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    ...options,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchOk(pathname) {
  const response = await fetch(pageUrl(pathname), requestOptions());
  assert.equal(response.status, 200, `${pathname}: expected HTTP 200`);
  return response;
}

function assertSelfCanonical(html, pathname) {
  const canonical = pageUrl(pathname);
  assert.match(
    html,
    new RegExp(`<link[^>]*rel="canonical"[^>]*href="${escapeRegExp(canonical)}"[^>]*>`),
    `${pathname}: self-canonical is required`,
  );
}

const requiredCatalogPaths = [
  "/katalog/krasota-i-uhod/uhod-i-kosmetika",
  "/katalog/menyayu-ili-otdam-darom/menyayu",
  "/katalog/menyayu-ili-otdam-darom/otdam-darom",
  "/katalog/raznoe/kollektsii-i-antikvariat",
  "/katalog/uslugi-dlya-doma/bytovye-uslugi",
  "/katalog/uslugi-dlya-doma/remont-i-stroitelstvo",
];

const legacyRedirects = [
  ["/katalog/krasota-i-uhod/%D1%83%D1%85%D0%BE%D0%B4-%D0%B8-%D0%BA%D0%BE%D1%81%D0%BC%D0%B5%D1%82%D0%B8%D0%BA%D0%B0", requiredCatalogPaths[0]],
  ["/katalog/menyayu-ili-otdam-darom/%D0%BC%D0%B5%D0%BD%D1%8F%D1%8E", requiredCatalogPaths[1]],
  ["/katalog/menyayu-ili-otdam-darom/%D0%BE%D1%82%D0%B4%D0%B0%D0%BC-%D0%B4%D0%B0%D1%80%D0%BE%D0%BC", requiredCatalogPaths[2]],
  ["/katalog/raznoe/%D0%BA%D0%BE%D0%BB%D0%BB%D0%B5%D0%BA%D1%86%D0%B8%D0%B8-%D0%B8-%D0%B0%D0%BD%D1%82%D0%B8%D0%BA%D0%B2%D0%B0%D1%80%D0%B8%D0%B0%D1%82", requiredCatalogPaths[3]],
  ["/katalog/uslugi-dlya-doma/%D0%B1%D1%8B%D1%82%D0%BE%D0%B2%D1%8B%D0%B5-%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8", requiredCatalogPaths[4]],
  ["/katalog/uslugi-dlya-doma/%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82-%D0%B8-%D1%81%D1%82%D1%80%D0%BE%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D1%82%D0%B2%D0%BE", requiredCatalogPaths[5]],
];

const robotsResponse = await fetchOk("/robots.txt");
const robots = await robotsResponse.text();
for (const expected of [
  "User-Agent: *",
  "Allow: /",
  "Disallow: /admin",
  "Disallow: /cabinet",
  "Disallow: /oplata",
  "Disallow: /api",
  `Sitemap: ${pageUrl("/sitemap.xml")}`,
]) {
  assert.ok(robots.includes(expected), `robots.txt: missing ${expected}`);
}

const sitemapResponse = await fetchOk("/sitemap.xml");
const sitemap = await sitemapResponse.text();
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.ok(sitemapUrls.length >= 100, "sitemap: unexpectedly few public URLs");
assert.doesNotMatch(sitemap, /<loc>[^<]*[А-Яа-яЁё]/, "sitemap: catalogue URLs must not contain Cyrillic slugs");

for (const url of sitemapUrls) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, base.origin, `sitemap: foreign URL ${url}`);
  assert.doesNotMatch(parsed.pathname, /^\/(admin|api|auth|cabinet|oplata)(?:\/|$)/, `sitemap: private URL ${url}`);
}

for (const pathname of requiredCatalogPaths) {
  assert.ok(sitemapUrls.includes(pageUrl(pathname)), `sitemap: missing ${pathname}`);
  const response = await fetchOk(pathname);
  assertSelfCanonical(await response.text(), pathname);
}

for (const [legacyPath, canonicalPath] of legacyRedirects) {
  const response = await fetch(pageUrl(legacyPath), requestOptions({ redirect: "manual" }));
  assert.equal(response.status, 308, `${legacyPath}: expected permanent redirect`);
  assert.equal(response.headers.get("location"), canonicalPath, `${legacyPath}: canonical redirect target`);
}

const paginationPath = `${requiredCatalogPaths[0]}?page=2`;
const pagination = await fetchOk(paginationPath);
const paginationHtml = await pagination.text();
assert.match(paginationHtml, /<meta\s+name="robots"\s+content="noindex, follow"\s*\/?\s*>/, "pagination: noindex, follow is required");
assertSelfCanonical(paginationHtml, requiredCatalogPaths[0]);

const readiness = await fetchOk("/api/ready");
const readinessPayload = await readiness.json();
assert.equal(readinessPayload.ok, true, "readiness: database-backed check must succeed");

console.log(`PASS public SEO smoke: ${sitemapUrls.length} sitemap URLs, canonical catalogue paths, legacy redirects and readiness`);
