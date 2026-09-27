import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const componentSource = readFileSync(new URL("../src/components/AdMarqueePlacementClient.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/reklama/begushchaya-stroka/page.tsx", import.meta.url), "utf8");

function session(userId, accessToken) {
  return {
    data: {
      session: {
        access_token: accessToken,
        user: { email: `${userId}@example.test`, id: userId, user_metadata: { display_name: userId } },
      },
    },
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

function loadAdMarqueeHelpers() {
  const js = ts.transpileModule(componentSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Error,
    Promise,
    require(id) {
      if (id === "react") return { useEffect() {}, useMemo() {}, useRef() {}, useState() {} };
      if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
      if (id === "lucide-react") return { CheckCircle2: "CheckCircle2", Clock3: "Clock3", Loader2: "Loader2", Send: "Send", WalletCards: "WalletCards" };
      if (id === "@/lib/client-user-profile") return { readCabinetProfile() {} };
      if (id === "@/lib/site-notifications") return { addSiteNotification() {} };
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient() {}, isSupabaseBrowserConfigured() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return module.exports;
}

const origin = {
  accessToken: "token-a",
  email: "account-a@example.test",
  name: "Account A",
  userId: "account-a",
};

test("ad marquee does not send an A action with B's session", async () => {
  const { runBoundAdMarqueeRequest } = loadAdMarqueeHelpers();
  const tokens = [];

  await assert.rejects(
    () => runBoundAdMarqueeRequest(
      origin,
      async () => session("account-b", "token-b"),
      async (accessToken) => {
        tokens.push(accessToken);
        return { ok: true };
      },
      () => true,
    ),
    /Сессия изменилась/,
  );

  assert.deepEqual(tokens, []);
});

test("ad marquee keeps the captured A token through a same-owner refresh", async () => {
  const { runBoundAdMarqueeRequest } = loadAdMarqueeHelpers();
  const tokens = [];
  let sessionChecks = 0;

  const result = await runBoundAdMarqueeRequest(
    origin,
    async () => {
      sessionChecks += 1;
      return session("account-a", "token-a-refreshed");
    },
    async (accessToken) => {
      tokens.push(accessToken);
      return { ok: true };
    },
    () => true,
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(tokens, ["token-a"]);
  assert.equal(sessionChecks, 2, "the session is checked before and after the request");
});

test("ad marquee discards a result when the session becomes B after its request", async () => {
  const { runBoundAdMarqueeRequest } = loadAdMarqueeHelpers();
  const requestStarted = createDeferred();
  const response = createDeferred();
  const tokens = [];
  let currentSession = session("account-a", "token-a");

  const pending = runBoundAdMarqueeRequest(
    origin,
    async () => currentSession,
    async (accessToken) => {
      tokens.push(accessToken);
      requestStarted.resolve();
      return response.promise;
    },
    () => true,
  );

  await requestStarted.promise;
  currentSession = session("account-b", "token-b");
  response.resolve({ ok: true });

  await assert.rejects(pending, /Сессия изменилась/);
  assert.deepEqual(tokens, ["token-a"]);
});

test("a payment notification cannot be written after A switches to B", async () => {
  const { addBoundAdMarqueePaymentNotification } = loadAdMarqueeHelpers();
  const profileStarted = createDeferred();
  const profile = createDeferred();
  const writes = [];
  let currentSession = session("account-a", "token-a");

  const pending = addBoundAdMarqueePaymentNotification(
    origin,
    async () => currentSession,
    async () => {
      profileStarted.resolve();
      return profile.promise;
    },
    (...args) => writes.push(args),
    { category: "payment", message: "Создан", title: "Платеж", tone: "info" },
    () => true,
  );

  await profileStarted.promise;
  currentSession = session("account-b", "token-b");
  profile.resolve({ notifyPayments: true });

  await assert.rejects(pending, /Сессия изменилась/);
  assert.deepEqual(writes, []);
});

test("the ad-marquee route uses the keyed publication gate and local bound payment flow", () => {
  assert.match(pageSource, /<PublicationAuthGate/);
  assert.match(pageSource, /<AdMarqueePlacementClient/);
  assert.match(componentSource, /runBoundAdMarqueeRequest/);
  assert.match(componentSource, /addBoundAdMarqueePaymentNotification/);
  assert.doesNotMatch(componentSource, /createClientPayment/);
});
