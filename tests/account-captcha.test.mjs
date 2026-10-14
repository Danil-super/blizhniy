import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function widget(siteKey) {
  const effects = [], refs = [], timers = [], values = [], removed = [];
  let options;
  const window = { setTimeout: (fn) => { timers.push(fn); return 1; }, clearTimeout: () => {},
    turnstile: { render: (_element, value) => { options = value; return "fixture-widget"; }, remove: (id) => removed.push(id) } };
  const hooks = { useState: () => ["", () => {}], useRef: (value) => { const ref = { current: value }; refs.push(ref); return ref; },
    useEffect: (fn) => effects.push(fn) };
  const exports = {};
  const config = {};
  const document = { querySelector: selector => selector === 'meta[name="blizhniy-turnstile-site-key"]'
    ? { getAttribute: () => siteKey } : null };
  const configCode = readFileSync(new URL("../src/lib/turnstile-public-config.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(configCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: config, document });
  const code = readFileSync(new URL("../src/components/TurnstileWidget.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, window, document, process: { env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey } }, require: (name) => {
      if (name === "@/lib/turnstile-public-config") return config;
      return name === "react" ? hooks : require(name);
    } });
  exports.TurnstileWidget({ requireProvider: true, onVerify: (value) => values.push(value) });
  refs[0].current = {};
  return { effects, timers, values, removed, options: () => options };
}
test("account CAPTCHA cannot become ready through the quiet local fallback when no provider key exists", () => {
  const app = widget("");
  app.effects[0]();
  assert.deepEqual(app.values, [""]);
  assert.equal(app.timers.length, 0, "no synthetic CAPTCHA timer in production account forms");
});
test("CAPTCHA expiry, provider errors and a removed widget clear or cannot revive readiness", async () => {
  const app = widget("public-fixture-key");
  const cleanup = app.effects[0]();
  await Promise.resolve();
  const options = app.options();
  assert.ok(options);
  options.callback("fixture-response");
  assert.equal(app.values.at(-1), "fixture-response");
  options["expired-callback"]();
  assert.equal(app.values.at(-1), "");
  options.callback("fixture-response-2");
  options["error-callback"]();
  assert.equal(app.values.at(-1), "");
  cleanup();
  options.callback("stale-response");
  assert.equal(app.values.at(-1), "");
  assert.deepEqual(app.removed, ["fixture-widget"]);
});
