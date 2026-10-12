import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(path, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { ...globals, exports, require: (name) => Object.hasOwn(deps, name) ? deps[name] : require(name) });
  return exports;
}
const dependencies = {
  "next/link": { default: ({ children, href, className }) => React.createElement("a", { href, className }, children) },
  "@/lib/registration-legal": { REGISTRATION_LEGAL_VERSIONS: { agreement: "test-version", privacy: "test-version" } },
  "@/components/TurnstileWidget": { TurnstileWidget: (props) => React.createElement("div", { "data-provider-required": String(props.requireProvider) }) },
};
test("primary registration reuses the validated form without showing local-only instructions and requires real CAPTCHA", () => {
  const { LocalRegistrationForm } = load("src/components/auth/LocalRegistrationForm.tsx", dependencies);
  const { ProductionRegistrationForm } = load("src/components/auth/ProductionRegistrationForm.tsx", { ...dependencies, "./LocalRegistrationForm": { LocalRegistrationForm } });
  const html = renderToStaticMarkup(React.createElement(ProductionRegistrationForm, { mode: "register" }));
  assert.doesNotMatch(html, /\.invalid|локальн|тестовый аккаунт/i);
  assert.match(html, /data-provider-required="true"/);
  assert.match(html, /пользовательское соглашение/);
  assert.match(html, /политикой обработки персональных данных/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
  const local = renderToStaticMarkup(React.createElement(LocalRegistrationForm, { mode: "register" }));
  assert.match(local, /\.invalid/);
  assert.doesNotMatch(local, /data-provider-required/);
});
test("primary confirmation does not consume a link during SSR and navigation stays out of local routes", () => {
  const { LocalRegistrationForm } = load("src/components/auth/LocalRegistrationForm.tsx", dependencies);
  const html = renderToStaticMarkup(React.createElement(LocalRegistrationForm, { mode: "confirm", production: true }));
  assert.match(html, /href="\/auth\/register"/);
  assert.doesNotMatch(html, /auth\/local|#token=|Подтвердить email<\/button>/);
});

test("recovery SSR has a labelled email and a fail-closed CAPTCHA; reset waits for a fragment without collecting a password", () => {
  const { ProductionRecoveryForm } = load("src/components/auth/ProductionRecoveryForm.tsx", dependencies);
  const html = renderToStaticMarkup(React.createElement(ProductionRecoveryForm, { mode: "recover" }));
  assert.match(html, /type="email"/);
  assert.match(html, /data-provider-required="true"/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(html, /type="password"/);
  const reset = renderToStaticMarkup(React.createElement(ProductionRecoveryForm, { mode: "reset" }));
  assert.match(reset, /Подготавливаем ссылку/);
  assert.doesNotMatch(reset, /type="password"|#token=/);
});

test("primary pages are opt-in, configuration failures never fall back or reveal server data", () => {
  const captured = [];
  const form = props => { captured.push(props); return React.createElement("div", null, "Account form"); };
  const deps = { ...dependencies,
    "next/navigation": { notFound: () => { throw new Error("not-found"); } },
    "@/lib/production-auth-config": { readProductionAuthConfig: () => ({ origin: "https://example.invalid", rateSecret: "must-stay-server-side", mailKeyFile: "/private/key" }) },
    "./ProductionRegistrationForm": { ProductionRegistrationForm: form },
    "./LocalAccountForm": { LocalAccountForm: form }, "./ProductionRecoveryForm": { ProductionRecoveryForm: form },
  };
  const page = (env, config = deps["@/lib/production-auth-config"]) => load("src/components/auth/ProductionAuthPage.tsx", {
    ...deps, "@/lib/production-auth-config": config,
  }, { process: { env } }).ProductionAuthPage;
  for (const mode of [undefined, "local", "unexpected"]) assert.throws(() => page({ BLIZHNIY_AUTH_MODE: mode })({ mode: "register" }), /not-found/);
  const html = renderToStaticMarkup(React.createElement(page({ BLIZHNIY_AUTH_MODE: "postgres" }), { mode: "register" }));
  assert.deepEqual(JSON.parse(JSON.stringify(captured)), [{ mode: "register" }]);
  assert.doesNotMatch(html, /must-stay-server-side|\/private\/key/);
  captured.length = 0;
  const failed = renderToStaticMarkup(React.createElement(page({ BLIZHNIY_AUTH_MODE: "postgres" }, {
    readProductionAuthConfig: () => { throw new Error("private configuration failure"); },
  }), { mode: "register" }));
  assert.match(failed, /Сервис аккаунтов временно недоступен/);
  assert.doesNotMatch(failed, /private configuration|Account form/);
  assert.equal(captured.length, 0);
});
