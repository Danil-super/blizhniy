import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const paymentId = "11111111-1111-4111-8111-111111111111";

function session(userId, accessToken) {
  return {
    data: { session: { user: { id: userId, email: `${userId}@example.test` }, access_token: accessToken } },
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

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function loadReturnHelpers() {
  const source = readFileSync(new URL("../src/components/payments/PaymentReturnClient.tsx", import.meta.url), "utf8");
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
      if (id === "next/navigation") return { useRouter() {} };
      if (id === "react") return { useEffect() {}, useState() {} };
      if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
      if (id === "lucide-react") return { CheckCircle2: "CheckCircle2", Loader2: "Loader2" };
      if (id === "@/lib/client-payment-flow") return { confirmClientPayment() {} };
      if (id === "@/lib/client-user-profile") return { readCabinetProfile() {} };
      if (id === "@/lib/site-notifications") return { addSiteNotification() {} };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient() {}, isSupabaseBrowserConfigured() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return module.exports;
}

function makePaymentReturnComponentHarness() {
  const source = readFileSync(new URL("../src/components/payments/PaymentReturnClient.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const initialSession = createDeferred();
  const effects = [];
  const stateSlots = [];
  const confirmCalls = [];
  let authListener;
  let hookIndex = 0;
  let sessionReadCount = 0;
  const react = {
    useEffect(effect) {
      effects.push(effect);
    },
    useState(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (stateSlots.length <= index) {
        stateSlots[index] = initialValue;
      }

      return [
        stateSlots[index],
        (nextValue) => {
          stateSlots[index] = typeof nextValue === "function" ? nextValue(stateSlots[index]) : nextValue;
        },
      ];
    },
  };
  const supabase = {
    auth: {
      getSession() {
        sessionReadCount += 1;
        return sessionReadCount === 1 ? initialSession.promise : Promise.resolve(session("account-b", "token-b"));
      },
      onAuthStateChange(callback) {
        authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Error,
    Promise,
    window: { setTimeout() {} },
    require(id) {
      if (id === "next/link") return { default: "Link" };
      if (id === "next/navigation") return { useRouter: () => ({ replace() {} }) };
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
      if (id === "lucide-react") return { CheckCircle2: "CheckCircle2", Loader2: "Loader2" };
      if (id === "@/lib/client-payment-flow") {
        return {
          confirmClientPayment(...args) {
            confirmCalls.push(args);
            return Promise.resolve({ payment: { status: "succeeded" } });
          },
        };
      }
      if (id === "@/lib/client-user-profile") return { readCabinetProfile: async () => ({ notifyPayments: true }) };
      if (id === "@/lib/site-notifications") return { addSiteNotification() {} };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient: () => supabase, isSupabaseBrowserConfigured: () => true };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return {
    confirmCalls,
    emitAuthSwitch() {
      assert.ok(authListener, "the Auth listener should be registered before the first session resolves");
      authListener("SIGNED_IN", session("account-b", "token-b").data.session);
    },
    render() {
      hookIndex = 0;
      module.exports.PaymentReturnClient({ paymentId });
      assert.equal(effects.length, 1, "the return component should register one confirmation effect");
      effects[0]();
    },
    resolveInitialSession() {
      initialSession.resolve(session("account-a", "token-a"));
    },
  };
}

function loadClientPaymentFlow({ fetchImpl, getSession }) {
  const source = readFileSync(new URL("../src/lib/client-payment-flow.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    "@/lib/cabinet-data-cache": { markCabinetDataChanged() {} },
    "@/lib/client-media-store": { getStoredMediaFile: async () => undefined },
    "@/lib/client-runtime-mode": { shouldShowClientFallbackContent: () => false },
    "@/lib/demo-publications": {
      demoPublicationsUpdatedEvent: "demo-publications-updated",
      readStoredDemoPublications: () => null,
      withPublicationStatusHistory: (item) => item,
      writeStoredDemoPublications() {},
    },
    "@/lib/listing-price": { normalizeListingPrice: (value) => value ?? "" },
    "@/lib/site-notifications": { addCurrentUserNotification: async () => undefined },
    "@/lib/supabase-browser": {
      getSupabaseBrowserClient: () => ({ auth: { getSession } }),
      isSupabaseBrowserConfigured: () => true,
    },
  };

  new Function("require", "module", "exports", "fetch", "window", "process", js)(
    (id) => {
      if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
    fetchImpl,
    { dispatchEvent() {} },
    { env: { NODE_ENV: "production" } },
  );

  return module.exports;
}

test("payment return aborts before confirmation when the browser session switches from A to B", async () => {
  const { confirmBoundPaymentReturn } = loadReturnHelpers();
  const sentTokens = [];

  await assert.rejects(
    () => confirmBoundPaymentReturn(
      { userId: "account-a", accessToken: "token-a", email: "a@example.test", name: "A" },
      async () => session("account-b", "token-b"),
      async (accessToken) => {
        sentTokens.push(accessToken);
        return { payment: { status: "succeeded" } };
      },
      () => true,
    ),
    /Сессия изменилась/,
  );

  assert.deepEqual(sentTokens, []);
});

test("an A → B switch before the first getSession result cannot reach confirmation", async () => {
  const h = makePaymentReturnComponentHarness();

  h.render();
  h.emitAuthSwitch();
  h.resolveInitialSession();
  await flushPromises();

  assert.deepEqual(h.confirmCalls, []);
});

test("payment return continues after A refreshes a token but keeps the captured token for POST", async () => {
  const { confirmBoundPaymentReturn } = loadReturnHelpers();
  const sentTokens = [];

  const result = await confirmBoundPaymentReturn(
    { userId: "account-a", accessToken: "token-a", email: "a@example.test", name: "A" },
    async () => session("account-a", "token-a-refreshed"),
    async (accessToken, assertCurrentSession) => {
      sentTokens.push(accessToken);
      await assertCurrentSession();
      return { payment: { status: "succeeded" } };
    },
    () => true,
  );

  assert.deepEqual(result, { payment: { status: "succeeded" } });
  assert.deepEqual(sentTokens, ["token-a"]);
});

test("payment return posts only with the captured token after stable session checks", async () => {
  const { confirmBoundPaymentReturn } = loadReturnHelpers();
  const sentTokens = [];
  let sessionChecks = 0;

  const result = await confirmBoundPaymentReturn(
    { userId: "account-a", accessToken: "token-a", email: "a@example.test", name: "A" },
    async () => {
      sessionChecks += 1;
      return session("account-a", "token-a");
    },
    async (accessToken, assertCurrentSession) => {
      sentTokens.push(accessToken);
      await assertCurrentSession();
      return { payment: { status: "succeeded" } };
    },
    () => true,
  );

  assert.deepEqual(result, { payment: { status: "succeeded" } });
  assert.deepEqual(sentTokens, ["token-a"]);
  assert.ok(sessionChecks >= 3, "the initiating session is checked before, during, and after confirmation");
});

test("payment return never writes a notification after its account changes during profile loading", async () => {
  const { addBoundPaymentNotification } = loadReturnHelpers();
  const writes = [];
  let currentSession = session("account-a", "token-a");
  let resolveProfile;
  const profile = new Promise((resolve) => {
    resolveProfile = resolve;
  });

  const pending = addBoundPaymentNotification(
    { userId: "account-a", accessToken: "token-a", email: "a@example.test", name: "A" },
    async () => currentSession,
    async () => profile,
    (...args) => writes.push(args),
    { category: "payment", title: "Оплата прошла", message: "A", tone: "success" },
    () => true,
  );

  await Promise.resolve();
  currentSession = session("account-b", "token-b");
  resolveProfile({ notifyPayments: true });

  await assert.rejects(pending, /Сессия изменилась/);
  assert.deepEqual(writes, []);
});

test("client confirmation uses the supplied origin token and checks before sending", async () => {
  const calls = [];
  const flow = loadClientPaymentFlow({
    getSession: async () => {
      throw new Error("the return flow must not read B's token when an origin token is supplied");
    },
    fetchImpl: async (_url, init) => {
      calls.push(init);
      return { ok: true, json: async () => ({ payment: { id: paymentId, status: "succeeded" } }) };
    },
  });

  await flow.confirmClientPayment(paymentId, {
    authorizationToken: "token-a",
    assertCurrentSession: async () => {},
    notify: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer token-a");

  const blockedCalls = [];
  const blockedFlow = loadClientPaymentFlow({
    getSession: async () => session("account-b", "token-b"),
    fetchImpl: async (_url, init) => {
      blockedCalls.push(init);
      return { ok: true, json: async () => ({ payment: { id: paymentId, status: "succeeded" } }) };
    },
  });

  await assert.rejects(
    () => blockedFlow.confirmClientPayment(paymentId, {
      authorizationToken: "token-a",
      assertCurrentSession: async () => { throw new Error("Сессия изменилась"); },
      notify: false,
    }),
    /Сессия изменилась/,
  );
  assert.deepEqual(blockedCalls, []);
});
