import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as validation from '../src/lib/account-validation.ts';
import { PasswordField } from './password-field-module.mjs';
import * as captchaProvider from './account-captcha-provider-module.mjs';
import * as browserProof from '../src/lib/account-browser-proof.ts';
import * as trustedProxy from '../src/lib/trusted-proxy-ip.ts';

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
  './AccountCaptchaProvider': captchaProvider,
  '@/lib/account-validation': validation,
  './PasswordField': { PasswordField },
  "@/lib/local-account": load("src/lib/local-account.ts", {}),
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
  assert.doesNotMatch(html, /href="\/auth\/register"/);
  assert.match(html, /Уже есть аккаунт/);
  captured.length = 0;
  const failed = renderToStaticMarkup(React.createElement(page({ BLIZHNIY_AUTH_MODE: "postgres" }, {
    readProductionAuthConfig: () => { throw new Error("private configuration failure"); },
  }), { mode: "register" }));
  assert.match(failed, /Сервис аккаунтов временно недоступен/);
  assert.doesNotMatch(failed, /private configuration|Account form/);
  assert.equal(captured.length, 0);
});

test("shared root selects public backend and CAPTCHA settings after the request boundary and never serializes config secrets", async () => {
  let release;
  const connected = new Promise(resolve => { release = resolve; });
  const environment = { BLIZHNIY_DB_PASSWORD: "synthetic-root-password", TURNSTILE_SECRET_KEY: "synthetic-root-captcha",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-before-request-key", NEXT_PUBLIC_SUPABASE_URL: "https://synthetic-legacy.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-legacy-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-service-key",
    NEXT_PUBLIC_2GIS_API_KEY: 'synthetic-map-"<key>' };
  const backends = [];
  const { default: Root } = load("src/app/layout.tsx", {
    "next/server": { connection: () => connected },
    'next/headers': { headers: async () => new Headers() },
    '@/components/auth/AccountCaptchaProvider': captchaProvider,
    '@/lib/account-browser-proof': browserProof,
    '@/lib/trusted-proxy-ip': trustedProxy,
    "@/lib/site-url": { getPublicSiteUrl: () => "https://example.invalid" },
    "@/lib/turnstile-public-config": load("src/lib/turnstile-public-config.ts", {}, { process: { env: environment } }),
    "@/lib/public-runtime-config": load("src/lib/public-runtime-config.ts", {}, { process: { env: environment } }),
    "@/components/auth/AccountAuthProvider": { AccountAuthProvider: ({ backend, children }) => { backends.push(backend); return children; } },
    "@/components/SiteFooter": { SiteFooter: () => null },
    "@/components/MobileBottomNav": { MobileBottomNav: () => null },
    "@/components/BookingLegacyStorageCleanup": { BookingLegacyStorageCleanup: () => null },
    "./globals.css": {},
  }, { process: { env: environment }, URL });
  const pending = Root({ children: React.createElement("main", null, "Synthetic page") });
  environment.BLIZHNIY_AUTH_MODE = "postgres";
  environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "synthetic-root-site-key"; release();
  const html = renderToStaticMarkup(await pending);
  assert.match(html, /name="blizhniy-auth-backend" content="postgres"/);
  assert.match(html, /name="blizhniy-turnstile-site-key" content="synthetic-root-site-key"/);
  assert.equal(html.includes("synthetic-before-request-key"), false);
  assert.deepEqual(backends, ["postgres"]);
  assert.match(html, /name="blizhniy-legacy-url" content=""/);
  assert.match(html, /name="blizhniy-legacy-anon-key" content=""/);
  assert.match(html, /name="blizhniy-dgis-key" content="synthetic-map-&quot;&lt;key&gt;"/);
  assert.equal(html.includes(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY), false);
  assert.equal(html.includes(environment.SUPABASE_SERVICE_ROLE_KEY), false);
  for (const secret of [environment.BLIZHNIY_DB_PASSWORD, environment.TURNSTILE_SECRET_KEY]) assert.equal(html.includes(secret), false);
  environment.BLIZHNIY_AUTH_MODE = "invalid";
  assert.match(renderToStaticMarkup(await Root({ children: null })), /content="unavailable"/);
  delete environment.BLIZHNIY_AUTH_MODE;
  const legacy = renderToStaticMarkup(await Root({ children: null }));
  assert.match(legacy, /name="blizhniy-legacy-url" content="https:\/\/synthetic-legacy.invalid"/);
  assert.match(legacy, /name="blizhniy-legacy-anon-key" content="synthetic-legacy-anon"/);
  assert.equal(legacy.includes(environment.SUPABASE_SERVICE_ROLE_KEY), false);
});

test("primary administrator UI state never queries legacy roles and errors stay fail-closed", () => {
  for (const [state, expected] of [["loading", "loading"], ["admin", "admin"], ["signed-in", "forbidden"], ["signed-out", "signed-out"], ["unavailable", "error"]]) {
    const effects = [];
    const { useAdminAccess: readAdminSnapshot } = load("src/components/auth/useAdminAccess.ts", {
      "react": { useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect) },
      "@/components/auth/AccountAuthProvider": { usePrimaryAccountAuth: () => ({ state, userId: state === "admin" ? "synthetic-admin" : null }) },
      "@/lib/supabase-browser": {
        isSupabaseBrowserConfigured: () => assert.fail("primary UI cannot consult legacy configuration"),
        getSupabaseBrowserClient: () => assert.fail("primary UI cannot create a legacy client"),
      },
    });
    const snapshot = readAdminSnapshot(); effects.forEach(effect => effect());
    assert.equal(snapshot.state, expected);
    assert.equal(Boolean(snapshot.message), state === "unavailable");
  }
});

test("primary publication login retains one main h1 and does not render the legacy form", () => {
  const { LocalAccountForm } = load("src/components/auth/LocalAccountForm.tsx", dependencies);
  const { PublicationAuthGate } = load("src/components/auth/PublicationAuthGate.tsx", {
    ...dependencies,
    "@/components/auth/useAuthState": { useAuthState: () => ({ state: "signed-out", userId: null }) },
    "@/components/auth/AccountAuthProvider": { usePrimaryAccountAuth: () => ({ state: "signed-out", userId: null }) },
    "@/components/auth/LocalAccountForm": { LocalAccountForm },
    "@/components/auth/AuthForm": { AuthForm: () => assert.fail("primary gate cannot render legacy Auth") },
  });
  const html = renderToStaticMarkup(React.createElement(PublicationAuthGate));
  assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.match(html, /<h2[^>]*>Вход<\/h2>/);
});
