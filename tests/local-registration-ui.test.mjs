import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import * as validation from '../src/lib/account-validation.ts';
import { PasswordField } from './password-field-module.mjs';

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/components/auth/LocalRegistrationForm.tsx", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { exports, require: (name) => {
  if (name === "react" || name === "react/jsx-runtime" || name === "next/link") return require(name);
  if (name === "@/lib/registration-legal") return { REGISTRATION_LEGAL_VERSIONS };
  if (name === '@/lib/account-validation') return validation;
  if (name === './PasswordField') return { PasswordField };
  throw new Error("Unapproved UI import");
} });

test("new form has no Supabase/captcha/third-party client or token persistence and renders labelled document checks", () => {
  assert.doesNotMatch(source, /supabase|localStorage|sessionStorage|Turnstile/i);
  const html = require("react-dom/server").renderToStaticMarkup(exports.LocalRegistrationForm({ mode: "register" }));
  assert.match(html, /Регистрация/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.match(html, /href="\/legal\/agreement"/);
  assert.match(html, /href="\/legal\/privacy"/);
  assert.match(html, /minLength="8"/i);
  assert.match(html, /autoComplete="given-name"/i);
  assert.match(html, /Показать пароль/);
  assert.match(html, /Показать повтор пароля/);
  assert.match(html, /maxLength="256"/i);
  assert.match(html, /autoComplete="new-password"/i);
  assert.match(html, /role="status"/);
});
test("confirmation waits for explicit interaction and does not accept query-string tokens", () => {
  const html = require("react-dom/server").renderToStaticMarkup(exports.LocalRegistrationForm({ mode: "confirm" }));
  assert.match(html, /Подтверждение email/);
  assert.match(html, /не подтверждает аккаунт автоматически/);
  assert.match(source, /window\.location\.hash/);
  assert.doesNotMatch(source, /window\.location\.search|submit\("confirm"[^]*?\}, \[\]\)/);
  assert.match(source, /window\.history\.replaceState/);
});
