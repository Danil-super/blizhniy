import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";

const canonicalPaths = [
  "/katalog/krasota-i-uhod/uhod-i-kosmetika",
  "/katalog/menyayu-ili-otdam-darom/menyayu",
  "/katalog/menyayu-ili-otdam-darom/otdam-darom",
  "/katalog/raznoe/kollektsii-i-antikvariat",
  "/katalog/uslugi-dlya-doma/bytovye-uslugi",
  "/katalog/uslugi-dlya-doma/remont-i-stroitelstvo",
];

const legacyRedirects = new Map([
  ["/katalog/krasota-i-uhod/уход-и-косметика", canonicalPaths[0]],
  ["/katalog/menyayu-ili-otdam-darom/меняю", canonicalPaths[1]],
  ["/katalog/menyayu-ili-otdam-darom/отдам-даром", canonicalPaths[2]],
  ["/katalog/raznoe/коллекции-и-антиквариат", canonicalPaths[3]],
  ["/katalog/uslugi-dlya-doma/бытовые-услуги", canonicalPaths[4]],
  ["/katalog/uslugi-dlya-doma/ремонт-и-строительство", canonicalPaths[5]],
]);

function runSmoke(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/check-public-seo.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, BASE_URL: baseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output));
    });
  });
}

test("public SEO smoke check protects the deployed sitemap, canonical paths and redirects", async (t) => {
  let baseUrl = "";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, baseUrl);
    const pathname = decodeURIComponent(url.pathname);

    if (url.pathname === "/robots.txt") {
      response.end([
        "User-Agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /cabinet",
        "Disallow: /oplata",
        "Disallow: /api",
        "",
        `Sitemap: ${baseUrl}/sitemap.xml`,
      ].join("\n"));
      return;
    }

    if (url.pathname === "/sitemap.xml") {
      const paths = [...canonicalPaths, ...Array.from({ length: 94 }, (_, index) => `/katalog/test-${index}`)];
      response.setHeader("Content-Type", "application/xml");
      response.end(`<?xml version="1.0"?><urlset>${paths.map((path) => `<url><loc>${baseUrl}${path}</loc></url>`).join("")}</urlset>`);
      return;
    }

    if (url.pathname === "/api/ready") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    const redirect = legacyRedirects.get(pathname);
    if (redirect) {
      response.writeHead(308, { Location: redirect });
      response.end();
      return;
    }

    if (canonicalPaths.includes(url.pathname)) {
      const robots = url.searchParams.get("page") === "2" ? '<meta name="robots" content="noindex, follow"/>' : "";
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><head>${robots}<link rel="canonical" href="${baseUrl}${url.pathname}"/></head><body>ok</body>`);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());

  const output = await runSmoke(baseUrl);
  assert.match(output, /PASS public SEO smoke: 100 sitemap URLs/);
});

test("deployment confirms a release only after the public SEO smoke check", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

  assert.match(workflow, /name: Check deployed public SEO and readiness[\s\S]*run: node scripts\/check-public-seo\.mjs/);
  assert.match(
    workflow,
    /run: node scripts\/check-public-seo\.mjs[\s\S]*name: Confirm deployed release/,
    "the smoke check must gate release confirmation",
  );
});
