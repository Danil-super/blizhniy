import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fairCategories } from "../src/lib/data.ts";
import { nextFairEvent } from "../src/lib/fair-calendar.ts";

const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const fair = { id: "fair-participation", action: "fair_participation", name: "Stored fair", price: 7.29, durationDays: null, active: true };
function display() {
  const exports = {};
  const source = readFileSync(new URL("../src/lib/tariff-display.ts", import.meta.url), "utf8");
  new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
  return exports;
}
function page(kind, tariffs, specialistCheckout = false) {
  const paths = { fair: "src/components/FairPages.tsx", tariffs: "src/app/tarify/page.tsx" };
  assert.ok(Object.hasOwn(paths, kind));
  const source = readFileSync(new URL(`../${paths[kind]}`, import.meta.url), "utf8"), exports = {};
  const dependencies = {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { __esModule: true, default: props => React.createElement("img", props) },
    "@/lib/public-tariffs": { getPublicTariffs: async () => tariffs },
    "@/lib/specialist-checkout-config": { readSpecialistCheckoutEnabled: () => specialistCheckout },
    "@/components/SiteHeader": { SiteHeader: () => React.createElement("header") },
    "@/components/FairApplicationForm": { FairApplicationForm: () => React.createElement("form") },
    "@/components/LocationMap": { LocationMap: () => React.createElement("div") },
    "@/lib/data": { fairCategories },
    "@/lib/fair-calendar": { nextFairEvent },
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
for (const [action, href, label] of [
  ["listing_publication", "/razmestit/obyavlenie", "Создать объявление"],
  ["vacancy_publication", "/rabota/vakansii/sozdat", "Разместить вакансию"],
  ["work_request_publication", "/rabota/zakazy/sozdat", "Разместить заказ"],
  ["specialist_publication", "/rabota/specialisty/anketa", "Подготовить черновик анкеты"],
  ["job_response", "/rabota/vakansii", "Найти вакансию"],
  ["fair_participation", "/yarmarka-masterov/zayavka", "Подать заявку"],
  ["ad_marquee", "/reklama/begushchaya-stroka", "Разместить текст"],
]) test(`public ${action} tariff opens its matching action`, async () => {
  const html = renderToStaticMarkup(await page("tariffs", [{ ...fair, action }]).default());
  assert.ok(html.includes(`href="${href}"`));
  assert.ok(html.includes(label));
});
test("public tariffs explain the limited TEST release before offering placement actions", async () => {
  const html = renderToStaticMarkup(await page("tariffs", [{ ...fair, action: "listing_publication" }]).default());
  assert.match(html, /Оплата пока доступна только участникам тестирования/);
  assert.match(html, /Реальные деньги не списываются/);
  assert.match(html, /Результат теста указан на экране оплаты/);
  assert.doesNotMatch(html, /После подтверждения платежа размещение становится активным/);
});
test("local specialist tariff describes moderation and synthetic placement only when enabled", async () => {
  const tariffs = [{ ...fair, action: "specialist_publication", id: "specialist-publication" }];
  const html = renderToStaticMarkup(await page("tariffs", tariffs, true).default());
  assert.match(html, /Локальная проверка: модерация, симуляция оплаты и публикация анкеты/);
  assert.doesNotMatch(html, /Публикация и оплата анкеты временно недоступны/);
  const disabled = renderToStaticMarkup(await page("tariffs", tariffs).default());
  assert.match(disabled, /Публикация и оплата анкеты временно недоступны/);
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

test("a missing placement term never turns a listing, job, order or profile into a one-off service", async () => {
  for (const action of ["listing_publication", "vacancy_publication", "work_request_publication", "specialist_publication"]) {
    const tariff = { ...fair, action, durationDays: null };
    const html = renderToStaticMarkup(await page("tariffs", [tariff]).default());
    assert.match(html, /Срок размещения не указан/);
    assert.doesNotMatch(html, /Разовое действие/);
    assert.match(html, /<a href=/);
  }
  const once = renderToStaticMarkup(await page("tariffs", [{ ...fair, action: "job_response" }]).default());
  assert.match(once, /Разовое действие/);
});
