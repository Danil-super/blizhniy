import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as adapter from "../src/lib/local-reference-admin.ts";

const require = createRequire(import.meta.url);
function load(file) {
  const exports = {}; const source = readFileSync(new URL(`../src/components/admin/${file}.tsx`, import.meta.url), "utf8");
  vm.runInNewContext(require("typescript").transpileModule(source, { compilerOptions: { module: 1, target: 9, jsx: 4 } }).outputText, {
    exports, require: name => {
      if (["react", "react/jsx-runtime", "next/link"].includes(name)) return require(name);
      if (name === "@/lib/local-reference-admin") return adapter;
      if (name === "./LocalReferenceEditors") return load("LocalReferenceEditors").exports;
      throw new Error("Unexpected editor import");
    },
  });
  return { source, exports };
}
test("local screen starts with a labelled loading state and no cached reference/editor", () => {
  const { source, exports } = load("LocalReferenceAdmin");
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(exports.LocalReferenceAdmin));
  assert.match(html, /Управление справочниками/); assert.match(html, /role="status"/); assert.doesNotMatch(html, /<form|<input/);
  assert.match(html, /href="\/auth\/local\/login"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase|document\.cookie|console\./i);
});
test("editors render labelled controls, explicit activity and nullable duration using project tokens", () => {
  const { source, exports } = load("LocalReferenceEditors");
  const render = (component, row) => require("react-dom/server").renderToStaticMarkup(require("react").createElement(component, { row, save() {}, invalid() {} }));
  const category = render(exports.LocalCategoryEditor, { id: "cat", parent_id: null, slug: "tools", name: "<script>unsafe</script>", sort_order: 10, active: false });
  assert.match(category, /&lt;script&gt;/); assert.doesNotMatch(category, /<script>unsafe/);
  assert.match(category, /Название категории/); assert.match(category, /Порядок/); assert.match(category, /Категория видна/);
  const tariff = render(exports.LocalTariffEditor, { id: "tariff", action: "job_response", name: "Response", price: 0.29, durationDays: null, active: true });
  assert.match(tariff, /Цена, ₽/); assert.match(tariff, /Срок, дней/); assert.match(tariff, /Пусто — без срока/); assert.match(tariff, /value="0.29"/);
  assert.match(source, /focus-visible/); assert.doesNotMatch(source, /dangerouslySetInnerHTML|localStorage|sessionStorage/);
});
