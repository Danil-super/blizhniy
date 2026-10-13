import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fairCategories } from "../src/lib/data.ts";

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const fair = { id: "fair-participation", action: "fair_participation", name: "Stored fair", price: 7.29, durationDays: null, active: true };
function display() {
  const exports = {};
  const source = readFileSync(new URL("../src/lib/tariff-display.ts", import.meta.url), "utf8");
  new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
  return exports;
}
function page(kind, tariffs) {
  const paths = { fair: "src/components/FairPages.tsx", tariffs: "src/app/tarify/page.tsx" };
  assert.ok(Object.hasOwn(paths, kind));
  const source = readFileSync(new URL(`../${paths[kind]}`, import.meta.url), "utf8"), exports = {};
  const dependencies = {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { __esModule: true, default: props => React.createElement("img", props) },
    "@/lib/public-tariffs": { getPublicTariffs: async () => tariffs },
    "@/components/SiteHeader": { SiteHeader: () => React.createElement("header") },
    "@/components/FairApplicationForm": { FairApplicationForm: () => React.createElement("form") },
    "@/components/LocationMap": { LocationMap: () => React.createElement("div") },
    "@/lib/data": { fairCategories },
    "@/lib/fair-application-store": { listStoredFairApplications: async () => [] },
    "@/lib/storage-upload": { publicMediaUrl: () => assert.fail("empty fixture must not fetch media") },
  };
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText)(path => {
    if (Object.hasOwn(dependencies, path)) return dependencies[path];
    if (path === "@/lib/tariff-display") return display();
    if (["react/jsx-runtime", "lucide-react"].includes(path)) return require(path);
    throw new Error("Unapproved tariff presentation import");
  }, exports);
  return exports;
}

test("fair homepage never advertises a static participation price when the tariff is missing", async () => {
  const html = renderToStaticMarkup(await page("fair", []).FairHomePage());
  assert.doesNotMatch(html, /1000\s*₽/);
  assert.match(html, /временно недоступен/);
});
test("fair application form never substitutes a static participation price", async () => {
  const html = renderToStaticMarkup(await page("fair", []).FairApplicationFormPage({}));
  assert.doesNotMatch(html, /1000\s*₽/);
  assert.match(html, /временно недоступен/);
});
test("inactive fair tariff remains unavailable rather than advertising its stale price", async () => {
  const html = renderToStaticMarkup(await page("fair", [{ ...fair, active: false }]).FairHomePage());
  assert.doesNotMatch(html, /7\.29\s*₽/);
  assert.match(html, /временно недоступен/);
});
test("inactive public tariff card has an explicit status instead of a purchase link", async () => {
  const tariff = { ...fair, action: "listing_publication", id: "listing-publication", active: false };
  const html = renderToStaticMarkup(await page("tariffs", [tariff]).default());
  assert.doesNotMatch(html, /href="\/razmestit\/obyavlenie"/);
  assert.match(html, /Тариф временно недоступен/);
});
test("active free fair tariff displays zero and preserves the application link", async () => {
  const html = renderToStaticMarkup(await page("fair", [{ ...fair, price: 0 }]).FairHomePage());
  assert.match(html, /0\s*₽/);
  assert.match(html, /href="\/yarmarka-masterov\/zayavka"/);
  assert.doesNotMatch(html, /1000\s*₽/);
});
test("active public tariff keeps its stored display price and existing action", async () => {
  const html = renderToStaticMarkup(await page("tariffs", [fair]).default());
  assert.match(html, /7\.29\s*₽/);
  assert.match(html, /href="\/yarmarka-masterov\/zayavka"/);
});
test("price labels distinguish active zero from missing or inactive tariffs", () => {
  const { formatTariffPrice } = display();
  assert.equal(formatTariffPrice({ ...fair, price: 0 }), "0 ₽");
  assert.equal(formatTariffPrice(fair), "7.29 ₽");
  assert.equal(formatTariffPrice(), "временно недоступен");
  assert.equal(formatTariffPrice({ ...fair, active: false }), "временно недоступен");
});
test("listing terms use the stored duration without inventing a thirty-day entitlement", () => {
  const { formatListingPublicationTerm } = display();
  assert.equal(formatListingPublicationTerm({ ...fair, durationDays: 7 }), "После оплаты объявление будет опубликовано на 7 дней.");
  for (const tariff of [undefined, { ...fair, active: false }, fair]) {
    assert.doesNotMatch(formatListingPublicationTerm(tariff), /30|на .* дней/);
  }
});

test("duration labels never invent a seven-day advertising term", () => {
  const { formatTariffDuration } = display();
  assert.equal(formatTariffDuration({ ...fair, durationDays: 10 }), "10 дн.");
  assert.equal(formatTariffDuration(fair), "не указан");
  assert.equal(formatTariffDuration(), "временно недоступен");
  assert.equal(formatTariffDuration({ ...fair, active: false, durationDays: 7 }), "временно недоступен");
});
