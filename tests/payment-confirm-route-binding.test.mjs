import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadConfirmRoute({ storedPayment, forceAllowed = false, clock = Date } = {}) {
  const source = readFileSync(new URL("../src/app/api/payments/[paymentId]/confirm/route.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const counters = { confirmCalls: [], latestPendingLookups: 0, targetWrites: [], paymentWrites: [] };
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
      canForceSucceedYooKassaReturn: () => forceAllowed,
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
      markStoredPaymentTargetSucceeded: async (payment) => {
        counters.targetWrites.push({ ...payment });
        return "published";
      },
      updateStoredPayment: async (payment) => { counters.paymentWrites.push({ ...payment }); },
    },
    "@/lib/server-auth": {
      getAuthenticatedRequestUser: async () => ({ user: { id: "account-b" } }),
      isAdminRequest: async () => false,
      isSupabaseServerConfigured: () => true,
    },
  };

  new Function("require", "module", "exports", "process", "Date", js)(
    (id) => {
      if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
    { env: { NODE_ENV: forceAllowed ? "development" : "production" } },
    clock,
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

test("development test-return fallback records the complete settlement instant", async () => {
  const instant = "2026-10-07T18:27:45.123Z";
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
  }
  const storedPayment = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: "account-b",
    provider: "yookassa", status: "pending", targetType: "listing", targetTitle: "Synthetic test listing",
  };
  const { route, counters } = loadConfirmRoute({ storedPayment, forceAllowed: true, clock: FixedDate });
  const response = await route.POST(
    { json: async () => ({ trustSuccessfulReturn: true }) },
    { params: Promise.resolve({ paymentId: storedPayment.id }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.paidAt, instant);
  assert.equal(counters.targetWrites[0].paidAt, instant);
  assert.equal(counters.paymentWrites[0].paidAt, instant);
  assert.equal(storedPayment.paidAt, undefined);
  assert.equal(storedPayment.status, "pending");
});

test("development test-return fallback preserves an existing complete settlement instant", async () => {
  const paidAt = "2026-09-01T12:34:56.789Z";
  const storedPayment = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: "account-b",
    provider: "yookassa", status: "pending", targetType: "listing", targetTitle: "Synthetic replay", paidAt,
  };
  const { route, counters } = loadConfirmRoute({ storedPayment, forceAllowed: true });
  const response = await route.POST(
    { json: async () => ({ trustSuccessfulReturn: true }) },
    { params: Promise.resolve({ paymentId: storedPayment.id }) },
  );
  assert.equal(response.body.payment.paidAt, paidAt);
  assert.equal(counters.paymentWrites[0].paidAt, paidAt);
});
