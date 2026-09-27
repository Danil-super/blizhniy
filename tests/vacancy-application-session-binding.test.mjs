import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/components/VacancyApplicationButton.tsx", import.meta.url), "utf8");

function loadSubmissionHelper() {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Error,
    Promise,
    require(id) {
      if (id === "next/link") return { default: "Link" };
      if (id === "react") return { useEffect() {}, useRef() {}, useState() {} };
      if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
      if (id === "lucide-react") return { Send: "Send" };
      if (id === "@/components/LegalConsentCheckbox") return { LegalLink: "LegalLink" };
      if (id === "@/components/auth/useAuthState") return { useAuthState() {} };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return module.exports.submitBoundVacancyApplication;
}

function makeButtonHarness() {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  let authSnapshot = { state: "signed-in", userId: "account-a" };
  let stateIndex = 0;
  const stateSlots = [];

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Error,
    Promise,
    require(id) {
      if (id === "next/link") return { default: "Link" };
      if (id === "react") {
        return {
          useEffect() {},
          useRef(initialValue) {
            return { current: initialValue };
          },
          useState(initialValue) {
            const index = stateIndex;
            stateIndex += 1;

            if (stateSlots.length <= index) {
              stateSlots[index] = initialValue;
            }

            return [stateSlots[index], (nextValue) => {
              stateSlots[index] = typeof nextValue === "function" ? nextValue(stateSlots[index]) : nextValue;
            }];
          },
        };
      }
      if (id === "react/jsx-runtime") {
        return {
          jsx(type, props, key) {
            return { type, props, key };
          },
          jsxs(type, props, key) {
            return { type, props, key };
          },
        };
      }
      if (id === "lucide-react") return { Send: "Send" };
      if (id === "@/components/LegalConsentCheckbox") return { LegalLink: "LegalLink" };
      if (id === "@/components/auth/useAuthState") return { useAuthState: () => authSnapshot };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return {
    render(snapshot) {
      authSnapshot = snapshot;
      stateIndex = 0;
      return module.exports.VacancyApplicationButton({ vacancyId: "11111111-1111-4111-8111-111111111111", vacancyTitle: "Тест" });
    },
    stateSlots,
  };
}

function findElement(node, type) {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  if (node.type === type) {
    return node;
  }

  const children = node.props?.children;
  const queue = Array.isArray(children) ? children : [children];

  for (const child of queue) {
    const match = findElement(child, type);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function session(userId, accessToken) {
  return {
    data: { session: { user: { id: userId }, access_token: accessToken } },
    error: null,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test("vacancy application aborts before POST when the browser session switches from A to B", async () => {
  const submitBoundVacancyApplication = loadSubmissionHelper();
  const currentSession = createDeferred();
  const postTokens = [];
  const pending = submitBoundVacancyApplication(
    "account-a",
    () => currentSession.promise,
    async (accessToken) => {
      postTokens.push(accessToken);
      return { ok: true };
    },
    () => true,
  );

  await Promise.resolve();
  currentSession.resolve(session("account-b", "token-b"));

  await assert.rejects(pending, /Сессия изменилась/);
  assert.deepEqual(postTokens, []);
});

test("vacancy application keeps a same-owner token refresh but blocks B-side response effects", async () => {
  const submitBoundVacancyApplication = loadSubmissionHelper();
  const postTokens = [];
  let checks = 0;

  await assert.rejects(
    () => submitBoundVacancyApplication(
      "account-a",
      async () => {
        checks += 1;
        return checks === 1 ? session("account-a", "token-a-refreshed") : session("account-b", "token-b");
      },
      async (accessToken) => {
        postTokens.push(accessToken);
        return { ok: true };
      },
      () => true,
    ),
    /Сессия изменилась/,
  );

  assert.deepEqual(postTokens, ["token-a-refreshed"], "the POST can only use a token verified for the origin account");
  assert.equal(checks, 2, "the identity is checked again before applying the response");
});

test("vacancy form hides A profile and draft fields until B profile is loaded", () => {
  const harness = makeButtonHarness();
  harness.render({ state: "signed-in", userId: "account-a" });
  harness.stateSlots[0] = { ownerId: "account-a", value: { name: "Анна", status: "published" } };
  harness.stateSlots[1] = { ownerId: "account-a", value: "Личный текст Анны" };
  harness.stateSlots[2] = { ownerId: "account-a", value: true };
  harness.stateSlots[5] = null;

  const forA = harness.render({ state: "signed-in", userId: "account-a" });
  assert.equal(forA.props.className.includes("emerald"), true, "A can see their own application form");

  const whileBLoads = harness.render({ state: "loading", userId: "account-b" });
  assert.equal(whileBLoads.props.children, "Проверяем возможность отклика...", "A content must disappear during B auth transition");

  harness.stateSlots[0] = { ownerId: "account-b", value: { name: "Борис", status: "published" } };
  const forB = harness.render({ state: "signed-in", userId: "account-b" });
  assert.equal(findElement(forB, "textarea")?.props.value, "", "A message must not appear in B form");
  assert.equal(findElement(forB, "input")?.props.checked, false, "A offer consent must not appear in B form");
});
