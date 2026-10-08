import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const paymentId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const tariffDbId = "44444444-4444-4444-8444-444444444444";
const providerId = "55555555-5555-4555-8555-555555555555";
const createdAt = "2026-10-07T10:00:00.123456Z";
const capturedAt = "2026-10-07T10:20:30.123456789Z";
const appliedAt = "2026-10-07T10:21:31.123456Z";
const actions = { listing: "listing_publication", vacancy: "vacancy_publication", workRequest: "work_request_publication", ad_marquee: "ad_marquee", application: "job_response", fair_application: "fair_participation" };
const tariffIds = { listing: "listing-publication", vacancy: "vacancy-publication", workRequest: "work-request-publication", ad_marquee: "ad-marquee", application: "job-response", fair_application: "fair-participation" };
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clone = (value) => structuredClone(value);

function fixtureRow(overrides = {}) {
  return { id: paymentId, user_id: ownerId, target_type: "listing", target_id: targetId, tariff_id: tariffDbId,
    amount: 199, provider: "yookassa", provider_payment_id: providerId, status: "pending", created_at: createdAt,
    paid_at: null, target_applied_at: null, purchased_duration_days: 9, fulfillment_status: "pending", fulfillment_reason: null, ...overrides };
}

// Real transpiled store/provider/routes/tariff/runtime/target modules. Only REST,
// provider HTTP and framework/authentication edges are replaced. This adapter
// fake does NOT replace the separate real-PG locking/transaction contract suite.
function harness(options = {}) {
  const state = { row: options.row === null ? null : fixtureRow(options.row), checkoutIntent: null, requests: [], providerFetches: [], effects: 0, notices: 0 };
  const production = options.production !== false;
  const configured = options.configured !== false;
  const globals = { setTimeout, clearTimeout };
  const env = { NODE_ENV: production ? "production" : "development", PAYMENT_PROVIDER: options.mock ? "mock" : "yookassa",
    YOOKASSA_SHOP_ID: "fixture-shop", YOOKASSA_SECRET_KEY: production ? "live_fixture_only" : "test_fixture_only",
    NEXT_PUBLIC_SITE_URL: "https://example.invalid", TURNSTILE_SECRET_KEY: "fixture-only", ...options.env };
  const tariffs = Object.entries(actions).map(([type, action]) => ({ id: tariffDbId, action, name: "Synthetic offer", price: 199,
    duration_days: ["application", "fair_application"].includes(type) ? null : type === "ad_marquee" ? 7 : 9, active: true }));
  const rest = async (path, optionsRest = {}) => {
    const optionsCopy = clone(optionsRest);
    state.requests.push({ path, ...optionsCopy });
    const method = optionsRest.method ?? "GET";
    // Wire adapters only. Historical known-ID fixtures deliberately have no
    // fabricated ledger; the separate PG17 suite proves these actual RPCs.
    if (path === "/rest/v1/rpc/prepare_yookassa_checkout_intent") {
      const p = optionsRest.body;
      assert.equal(p.p_payment_id, state.row.id);
      assert.equal(p.p_user_id, state.row.user_id);
      assert.equal(Number(p.p_amount), Number(state.row.amount));
      state.checkoutIntent = { payment_id: state.row.id, user_id: state.row.user_id, target_type: state.row.target_type,
        target_id: state.row.target_id, tariff_id: state.row.tariff_id, tariff_key: p.p_tariff_key,
        amount: state.row.amount, purchased_duration_days: state.row.purchased_duration_days,
        merchant_shop_id: p.p_merchant_shop_id, is_test: p.p_is_test, request_body: p.p_request_body,
        request_sha256: createHash("sha256").update(p.p_request_body).digest("hex"), first_attempt_authorized_at: new Date().toISOString() };
      return [{ ...state.checkoutIntent, remaining_ms: 3_600_000, decision: "post", provider_payment_id: null }];
    }
    if (path === "/rest/v1/rpc/authorize_yookassa_checkout_attempt") {
      if (!state.checkoutIntent) return [{ payment_id: state.row.id, decision: state.row.provider_payment_id ? "legacy_recover" : "manual",
        provider_payment_id: state.row.provider_payment_id }];
      assert.equal(optionsRest.body.p_merchant_shop_id, state.checkoutIntent.merchant_shop_id);
      assert.equal(optionsRest.body.p_is_test, state.checkoutIntent.is_test);
      return [{ ...state.checkoutIntent, remaining_ms: 3_600_000,
        decision: state.row.provider_payment_id ? "recover" : "post", provider_payment_id: state.row.provider_payment_id }];
    }
    // These historical wire fixtures intentionally model a FULL queue. Real
    // activation/capacity lives in PG tests; do not fake another fulfillment.
    if (path === "/rest/v1/rpc/reconcile_ad_marquee_queue") {
      assert.equal(state.row.status, "succeeded");
      assert.equal(state.row.fulfillment_status, "applied");
      assert.equal(optionsRest.attempts, 1);
      return [];
    }
    if (path.startsWith("/rest/v1/ad_marquee_placements") && path.includes("payment_id=eq.")) {
      const query = new URL(`https://fixture.invalid${path}`).searchParams;
      assert.equal(query.get("id"), `eq.${state.row.target_id}`);
      assert.equal(query.get("user_id"), `eq.${state.row.user_id}`);
      assert.equal(query.get("payment_id"), `eq.${state.row.id}`);
      return [{ id: state.row.target_id, user_id: state.row.user_id, payment_id: state.row.id,
        payment_status: "succeeded", status: "paid", starts_at: null, ends_at: null }];
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      assert.equal(path, "/rest/v1/rpc/apply_payment_fulfillment");
      assert.equal(state.row.status, "succeeded", "RPC may only follow persisted verified financial success");
      assert.deepEqual(optionsRest.body, { p_payment_id: state.row.id, p_expected_provider_payment_id: state.row.provider_payment_id });
      if (options.onRpc) return options.onRpc(state, optionsRest);
      if (state.row.fulfillment_status === "pending") {
        if (!state.row.paid_at || state.row.purchased_duration_days == null && !["application", "fair_application"].includes(state.row.target_type)) {
          state.row.fulfillment_status = "blocked";
          state.row.fulfillment_reason = !state.row.paid_at ? "payment_missing_paid_at" : "duration_missing";
        } else {
          state.effects += 1;
          state.notices += Number(state.row.target_type === "application");
          state.row.fulfillment_status = "applied";
          state.row.target_applied_at = appliedAt;
        }
      }
      return [rpcRow(state.row)];
    }
    if (path.startsWith("/rest/v1/tariffs")) {
      if (options.noTariff) return [];
      const action = new URL(`https://fixture.invalid${path}`).searchParams.get("action")?.slice(3);
      if (path.includes("select=id,action") || path.includes("select=action")) return tariffs.filter((tariff) => tariff.action === actions[state.row?.target_type ?? "listing"]);
      return action ? tariffs.filter((tariff) => tariff.action === action) : tariffs;
    }
    if (path.startsWith("/rest/v1/payments")) {
      if (method === "POST") {
        state.row = fixtureRow({ purchased_duration_days: null, ...optionsRest.body, created_at: createdAt });
        return [clone(state.row)];
      }
      if (method === "PATCH") {
        if (options.onFinancial) await options.onFinancial(state, optionsRest);
        const old = state.row;
        state.row = { ...old, ...optionsRest.body,
          status: old.status === "refunded" || old.status === "succeeded" && optionsRest.body.status !== "refunded" ? old.status : optionsRest.body.status,
          paid_at: old.paid_at ?? (["succeeded", "refunded"].includes(old.status) ? null : optionsRest.body.paid_at) };
        return [clone(state.row)];
      }
      if (!state.row) return [];
      if (path.includes("status=in.(created,pending)") && !["created", "pending"].includes(state.row.status)) return [];
      return [clone(state.row), ...(options.extraRows ?? [])];
    }
    if (path.startsWith("/rest/v1/cities")) return [{ id: targetId, name: "Synthetic city" }];
    if (path.startsWith("/rest/v1/fair_applications") && method === "POST") {
      state.createdFair = { id: targetId, created_at: createdAt, show_exact_address: false, ...optionsRest.body };
      return [clone(state.createdFair)];
    }
    if (method !== "GET") {
      state.effects += 1;
      if (path.startsWith("/rest/v1/fair_applications")) return [{ ...state.createdFair, ...optionsRest.body }];
      throw new Error(`Legacy direct target write is forbidden: ${path}`);
    }
    return [];
  };
  const providerFetch = async (url, request = {}) => {
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return new Response(JSON.stringify({ success: true }));
    assert.match(String(url), /^https:\/\/api\.yookassa\.ru\/v3\/payments/);
    state.providerFetches.push({ url, method: request.method ?? "GET" });
    if (request.method === "POST") {
      assert.ok(state.row, "checkout intent must commit before provider POST");
      assert.equal(state.row.purchased_duration_days, options.expectedDuration ?? 9);
    }
    const raw = { id: providerId, status: options.providerStatus ?? "succeeded", paid: (options.providerStatus ?? "succeeded") === "succeeded",
      test: !production, amount: { value: "199.00", currency: "RUB" },
      metadata: { localPaymentId: state.row.id, targetId: state.row.target_id, targetType: state.row.target_type },
      ...(options.missingCapture ? {} : { captured_at: capturedAt }), ...options.providerResponse };
    if (raw.status !== "succeeded") delete raw.captured_at;
    return new Response(JSON.stringify(raw), { status: 200 });
  };
  function load(relative, cache = new Map()) {
    const filename = resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const js = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const deps = (name) => {
      if (name === "@/lib/supabase-rest") return { isSupabaseRestConfigured: () => configured, isSupabaseServiceRoleConfigured: () => configured, isUuid: uuid, supabaseRest: rest };
      if (name === "@/lib/server-auth") return { isSupabaseServerConfigured: () => configured, getAuthenticatedRequestUser: async () => ({ user: { id: ownerId, email: "fixture@example.invalid" } }), isAdminRequest: async () => Boolean(options.admin) };
      if (name === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
      if (name === "next/cache") return { revalidatePath() {} };
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, cache);
      if (name.startsWith(".")) return load(resolve(filename, "..", `${name}.ts`), cache);
      return require(name);
    };
    new Function("require", "module", "exports", "fetch", "process", "globalThis", "crypto", js)(deps, module, module.exports, providerFetch, { env }, globals, webcrypto);
    return module.exports;
  }
  return { load, state, configured, tariff: (type = "listing", duration = 9) => ({ id: tariffIds[type], action: actions[type], name: "Synthetic offer", price: 199, durationDays: duration, active: true }) };
}

function rpcRow(row, overrides = {}) {
  return { payment_id: row.id, financial_status: row.status, fulfillment_status: row.fulfillment_status,
    fulfillment_reason: row.fulfillment_reason, paid_at: row.paid_at, target_applied_at: row.target_applied_at,
    applied_now: row.fulfillment_status === "applied", target_status: row.fulfillment_status === "applied" ? row.target_type === "application" ? "sent" : row.target_type === "ad_marquee" ? "paid" : "published" : null, ...overrides };
}

const paymentInput = (h, type = "listing", duration = 9) => ({ id: paymentId, userId: ownerId, targetType: type, targetId,
  targetTitle: "Synthetic publication", amount: 199, tariff: h.tariff(type, duration), status: "created", provider: "yookassa" });
const confirm = (h) => h.load("src/lib/payment-provider.ts").confirmPayment(paymentId);

test("checkout prerequisite API validates existing merchant/receipt contract without storage or provider calls", () => {
  for (const env of [{ YOOKASSA_SHOP_ID: "" }, { YOOKASSA_SECRET_KEY: "" }, { YOOKASSA_RECEIPTS_ENABLED: "true", YOOKASSA_RECEIPT_VAT_CODE: "1" }]) {
    const h = harness({ env });
    assert.throws(() => h.load("src/lib/payment-provider.ts").validatePaymentCreationPrerequisites({}), /credentials|email/i);
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.providerFetches.length, 0);
  }
  const ready = harness({ env: { YOOKASSA_RECEIPTS_ENABLED: "true", YOOKASSA_RECEIPT_VAT_CODE: "1" } });
  assert.doesNotThrow(() => ready.load("src/lib/payment-provider.ts").validatePaymentCreationPrerequisites({ customerEmail: "valid@example.invalid" }));
  const demo = harness({ production: false, mock: true, configured: false, env: { YOOKASSA_SHOP_ID: "", YOOKASSA_SECRET_KEY: "" } });
  assert.doesNotThrow(() => demo.load("src/lib/payment-provider.ts").validatePaymentCreationPrerequisites({}));
});

test("purchased duration and complete intent timestamp are persisted before the provider POST", async () => {
  const h = harness({ row: null, providerStatus: "pending" });
  const result = await h.load("src/lib/payment-provider.ts").createPayment({ tariffId: "listing-publication", targetId, targetType: "listing", userId: ownerId });
  assert.equal(h.state.row.purchased_duration_days, 9);
  assert.equal(result.createdAt, createdAt);
});

for (const type of Object.keys(actions)) {
  test(`${type}: snapshot follows the purchased server offer; application/fair have no period`, async () => {
    const h = harness();
    const store = h.load("src/lib/payment-store.ts");
    await store.createStoredPayment(paymentInput(h, type, 13));
    assert.equal(h.state.row.purchased_duration_days, ["application", "fair_application"].includes(type) ? null : 13);
  });
  test(`${type}: verified finance commits before the owner-bound RPC and replay preserves the entitlement`, async () => {
    const h = harness({ row: { target_type: type, purchased_duration_days: ["application", "fair_application"].includes(type) ? null : 9 } });
    const first = await confirm(h);
    assert.equal(first.payment.status, "succeeded");
    assert.equal(first.payment.fulfillmentStatus, "applied");
    assert.equal(first.payment.paidAt, capturedAt);
    assert.equal(first.payment.targetAppliedAt, appliedAt);
    assert.equal(first.nextStatus, type === "application" ? "sent" : type === "ad_marquee" ? "paid" : "published");
    const replay = await confirm(h);
    assert.equal(replay.payment.targetAppliedAt, appliedAt);
    assert.equal(h.state.effects, 1);
    assert.equal(h.state.notices, Number(type === "application"));
    assert.ok(h.state.requests.find((request) => request.path.includes("/rpc/apply_payment_fulfillment")).useServiceRole);
    assert.equal(h.state.requests.find((request) => request.path.includes("/rpc/apply_payment_fulfillment")).attempts, 1);
  });
}

test("duration targets reject NULL, fractional, zero and unbounded snapshots without writing an intent", async () => {
  for (const duration of [null, 0, 1.5, 366, NaN]) {
    const h = harness();
    await assert.rejects(h.load("src/lib/payment-store.ts").createStoredPayment(paymentInput(h, "listing", duration)), /duration/i);
    assert.equal(h.state.requests.some((request) => request.method === "POST"), false);
  }
});

test("missing work-request tariff cannot fall back to listing publication", async () => {
  const h = harness({ noTariff: true });
  await assert.rejects(h.load("src/lib/payment-store.ts").createStoredPayment(paymentInput(h, "workRequest")), /tariff/i);
  assert.equal(h.state.requests.some((request) => request.path.includes("action=eq.listing_publication")), false);
});

test("missing capture anchor keeps financial success but blocks without inventing time", async () => {
  const h = harness({ missingCapture: true });
  const result = await confirm(h);
  assert.equal(result.payment.status, "succeeded");
  assert.equal(result.payment.paidAt, undefined);
  assert.equal(result.payment.fulfillmentStatus, "blocked");
  assert.equal(result.payment.fulfillmentReason, "payment_missing_paid_at");
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.effects, 0);
});

test("stored capture time wins over a later verified capture and historical NULL stays NULL", async () => {
  for (const paid of ["2026-09-30T08:00:00.123456Z", null]) {
    const h = harness({ row: { status: "succeeded", paid_at: paid } });
    const result = await confirm(h);
    assert.equal(result.payment.paidAt, paid ?? undefined);
    assert.equal(result.payment.fulfillmentStatus, paid ? "applied" : "blocked");
  }
});

test("authoritative refund prevents RPC even if a stale provider snapshot says succeeded", async () => {
  const h = harness({ row: { status: "refunded", paid_at: capturedAt } });
  const result = await confirm(h);
  assert.equal(result.payment.status, "refunded");
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.requests.some((request) => request.path.includes("/rpc/apply_payment_fulfillment")), false);
  assert.equal(h.state.effects, 0);
});

test("a durable blocked financial success remains blocked without publication or misleading notification", async () => {
  const h = harness({ row: { status: "succeeded", paid_at: capturedAt, fulfillment_status: "blocked", fulfillment_reason: "target_owner_mismatch" } });
  const result = await confirm(h);
  assert.equal(result.payment.status, "succeeded");
  assert.equal(result.payment.fulfillmentStatus, "blocked");
  assert.equal(result.payment.fulfillmentReason, "target_owner_mismatch");
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.effects, 0);
  assert.doesNotMatch(result.notification.body, /статус изменен|published/);
});

test("RPC outage preserves succeeded/pending, no entitlement claim, and webhook5xx requests a genuine retry", async () => {
  const h = harness({ onRpc: () => { throw new Error("synthetic RPC outage"); } });
  const result = await confirm(h);
  assert.equal(result.payment.status, "succeeded");
  assert.equal(result.payment.fulfillmentStatus, "pending");
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.effects, 0);
  const response = await h.load("src/app/api/payments/yookassa/webhook/route.ts").POST({ json: async () => ({ type: "notification", event: "payment.succeeded", object: { id: providerId } }) });
  assert.equal(response.status, 503);
  assert.equal(h.state.row.status, "succeeded");
});

test("a lost RPC response re-reads committed outcome instead of treating payment as failed", async () => {
  const h = harness({ onRpc: (state) => {
    state.row.fulfillment_status = "applied";
    state.row.target_applied_at = appliedAt;
    state.effects += 1;
    throw new Error("synthetic lost committed RPC response");
  } });
  const result = await confirm(h);
  assert.equal(result.payment.fulfillmentStatus, "applied");
  assert.equal(result.payment.targetAppliedAt, appliedAt);
  assert.equal(result.nextStatus, undefined, "a read of only the marker cannot assert the current target status");
});

test("financial persistence failure prevents every entitlement write", async () => {
  const h = harness({ onFinancial: () => { throw new Error("synthetic save failure"); } });
  await assert.rejects(confirm(h), /synthetic save failure/);
  assert.equal(h.state.requests.some((request) => request.path.includes("/rpc/apply_payment_fulfillment")), false);
  assert.equal(h.state.effects, 0);
});

test("a deferred financial response must resolve before RPC or any target write", async () => {
  let release;
  let entered;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  const observed = new Promise((resolveObserved) => { entered = resolveObserved; });
  const h = harness({ onFinancial: async () => { entered(); await gate; } });
  const pending = confirm(h);
  await observed;
  try {
    assert.equal(h.state.row.status, "pending");
    assert.equal(h.state.requests.some((request) => request.path.includes("/rpc/apply_payment_fulfillment")), false);
    assert.equal(h.state.effects, 0);
  } finally { release(); }
  const result = await pending;
  assert.equal(result.payment.status, "succeeded");
  assert.equal(result.payment.fulfillmentStatus, "applied");
  assert.equal(h.state.effects, 1);
});

test("confirm route exposes succeeded/pending without publication while optional RPC is unavailable", async () => {
  const h = harness({ onRpc: () => { throw new Error("synthetic RPC unavailable"); } });
  const response = await h.load("src/app/api/payments/[paymentId]/confirm/route.ts").POST(new Request("https://example.invalid/confirm", { method: "POST" }), { params: Promise.resolve({ paymentId }) });
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.status, "succeeded");
  assert.equal(response.body.payment.fulfillmentStatus, "pending");
  assert.equal(response.body.nextStatus, undefined);
  assert.equal(h.state.effects, 0);
});

test("webhook acknowledges durable applied/blocked financial successes, never retries a blocked reset", async () => {
  for (const missingCapture of [false, true]) {
    const h = harness({ missingCapture });
    const response = await h.load("src/app/api/payments/yookassa/webhook/route.ts").POST({ json: async () => ({ type: "notification", event: "payment.succeeded", object: { id: providerId } }) });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.payment.status, "succeeded");
    assert.equal(response.body.result.payment.fulfillmentStatus, missingCapture ? "blocked" : "applied");
    assert.equal(h.state.effects, Number(!missingCapture));
  }
});

test("cabinet retries a genuine unsettled succeeded Yoo payment only through provider verification and RPC", async () => {
  const h = harness({ row: { status: "succeeded", paid_at: capturedAt } });
  const response = await h.load("src/app/api/cabinet/listings/route.ts").GET(new Request("https://example.invalid/api/cabinet/listings"));
  assert.equal(response.status, 200);
  assert.equal(h.state.providerFetches.length, 1);
  assert.equal(h.state.row.fulfillment_status, "applied");
  assert.equal(h.state.effects, 1);
});

test("independent provider module instances rely on the durable RPC, not a process-local map", async () => {
  const h = harness();
  const a = h.load("src/lib/payment-provider.ts", new Map());
  const b = h.load("src/lib/payment-provider.ts", new Map());
  const results = await Promise.all([a.confirmPayment(paymentId), b.confirmPayment(paymentId)]);
  assert.ok(results.every((result) => result.payment.fulfillmentStatus === "applied"));
  assert.equal(h.state.effects, 1);
  assert.equal(h.state.requests.filter((request) => request.path.includes("/rpc/apply_payment_fulfillment")).length, 2);
});

for (const production of [true, false]) {
  test(`${production ? "production" : "development test_"} return flag still verifies provider pending and cannot fabricate a blocked success`, async () => {
    const h = harness({ production, providerStatus: "pending" });
    const result = await h.load("src/lib/payment-provider.ts").confirmPayment(paymentId, { trustSuccessfulReturn: true });
    assert.equal(result.payment.status, "pending");
    assert.equal(result.payment.paidAt, undefined);
    assert.equal(result.nextStatus, undefined);
    assert.equal(h.state.providerFetches.length, 1);
    assert.equal(h.state.requests.some((request) => request.path.includes("/rpc/apply_payment_fulfillment")), false);
  });
}

test("stored mock settlement fails closed before any financial or target mutation", async () => {
  const h = harness({ production: false, mock: true, row: { provider: "mock", provider_payment_id: null } });
  await assert.rejects(confirm(h), /stored mock|mock.*storage/i);
  assert.equal(h.state.requests.some((request) => request.method === "PATCH" || request.method === "POST"), false);
  assert.equal(h.state.effects, 0);
});

test("explicit nonproduction in-memory mock keeps its synthetic successful flow", async () => {
  const h = harness({ production: false, mock: true, configured: false });
  const payment = { id: "pay-mock-synthetic", targetType: "listing", targetTitle: "Synthetic demo", tariffId: "listing-publication", amount: 199, status: "created", provider: "mock", createdAt };
  const result = await h.load("src/lib/payment-provider.ts").confirmPayment(payment);
  assert.equal(result.payment.status, "succeeded");
  assert.equal(result.payment.fulfillmentStatus, "applied");
  assert.ok(result.payment.paidAt);
  assert.ok(result.payment.targetAppliedAt);
  assert.equal(h.state.requests.length, 0);
});

test("RPC result mismatch cannot report a publication from another payment", async () => {
  const h = harness({ onRpc: (state) => [rpcRow(state.row, { payment_id: targetId, fulfillment_status: "applied", target_applied_at: appliedAt, target_status: "published" })] });
  const result = await confirm(h);
  assert.equal(result.payment.fulfillmentStatus, "pending");
  assert.equal(result.nextStatus, undefined);
});

test("cabinet sync never re-dispatches applied or blocked successes; unsettled Yoo uses the common path", async () => {
  const h = harness({ row: { status: "succeeded", paid_at: capturedAt, fulfillment_status: "applied", target_applied_at: appliedAt }, extraRows: [fixtureRow({ id: targetId, status: "succeeded", fulfillment_status: "blocked", fulfillment_reason: "duration_missing" })] });
  const response = await h.load("src/app/api/cabinet/listings/route.ts").GET(new Request("https://example.invalid/api/cabinet/listings"));
  assert.equal(response.status, 200);
  assert.equal(h.state.effects, 0);
  assert.equal(h.state.providerFetches.length, 0);
});

test("admin free fair waiver is distinct from settlement and bound to a just-created owned target", async () => {
  for (const admin of [false, true]) {
    const h = harness({ admin });
    const body = { participantName: "Synthetic participant", city: "Synthetic city", category: "Synthetic category", description: "Synthetic isolated admin waiver description", phone: "+70000000000", email: "synthetic@example.invalid", skipPayment: true, captchaToken: "synthetic-valid-fixture", targetId: providerId, userId: providerId };
    const response = await h.load("src/app/api/fair-applications/route.ts").POST({ json: async () => body, headers: new Headers({ "x-real-ip": "127.0.0.1" }) });
    assert.equal(response.status, admin ? 201 : 403);
    assert.equal(h.state.providerFetches.length, 0);
    assert.equal(h.state.requests.some((request) => request.path.includes("/payments") || request.path.includes("/rpc/")), false);
    if (admin) {
      assert.equal(h.state.createdFair.user_id, ownerId);
      assert.equal(response.body.application.id, targetId);
      const write = h.state.requests.find((request) => request.method === "PATCH");
      assert.ok(write.path.includes(`id=eq.${targetId}`));
      assert.equal(write.body.status, "published");
    } else assert.equal(h.state.requests.length, 0);
  }
});
