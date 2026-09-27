import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadConfirmRoute({ storedPayment } = {}) {
  const source = readFileSync(new URL("../src/app/api/payments/[paymentId]/confirm/route.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const counters = { confirmCalls: [], latestPendingLookups: 0 };
  const bPendingPayment = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    userId: "account-b",
    provider: "yookassa",
    status: "pending",
    targetType: "listing",
    targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    targetTitle: "Платеж B",
  };
  const stubs = {
    "next/server": {
      NextResponse: {
        json(payload, init = {}) {
          return { body: payload, status: init.status ?? 200 };
        },
      },
    },
    "@/lib/payment-provider": {
      canForceSucceedYooKassaReturn: () => false,
      getPayment: () => undefined,
      confirmPayment: async (payment) => {
        counters.confirmCalls.push(payment);
        return { payment };
      },
    },
    "@/lib/payment-store": {
      findStoredPaymentByProvider: async () => undefined,
      getStoredPayment: async () => storedPayment,
      // Kept in the harness to catch any accidental reintroduction of the
      // unsafe "latest pending payment" fallback.
      getLatestPendingStoredPaymentForUser: async () => {
        counters.latestPendingLookups += 1;
        return bPendingPayment;
      },
      markStoredPaymentTargetSucceeded: async () => "published",
      updateStoredPayment: async () => undefined,
    },
    "@/lib/server-auth": {
      getAuthenticatedRequestUser: async () => ({ user: { id: "account-b" } }),
      isAdminRequest: async () => false,
      isSupabaseServerConfigured: () => true,
    },
  };

  new Function("require", "module", "exports", "process", js)(
    (id) => {
      if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
    { env: { NODE_ENV: "production" } },
  );

  return { route: module.exports, counters, bPendingPayment };
}

test("an unknown return id never falls back to account B's latest pending payment", async () => {
  const { route, counters } = loadConfirmRoute();

  const response = await route.POST(
    { json: async () => ({ trustSuccessfulReturn: true }) },
    { params: Promise.resolve({ paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "Платеж не найден");
  assert.equal(counters.latestPendingLookups, 0);
  assert.deepEqual(counters.confirmCalls, []);
});
