import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function readSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("payment confirmation uses the payment id from the return URL without shared browser storage", async () => {
  const paymentId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const storageCalls = [];
  const notifications = [];
  const source = readSource("src/lib/client-payment-flow.ts");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const window = {
    dispatchEvent() {},
    localStorage: {
      getItem(key) {
        storageCalls.push(["get", key]);
        throw new Error("shared payment storage must not be read");
      },
      removeItem(key) {
        storageCalls.push(["remove", key]);
        throw new Error("shared payment storage must not be cleared");
      },
      setItem(key) {
        storageCalls.push(["set", key]);
        throw new Error("shared payment storage must not be written");
      },
    },
  };
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
    "@/lib/site-notifications": {
      addCurrentUserNotification: async (notification) => {
        notifications.push(notification);
      },
    },
    "@/lib/supabase-browser": {
      getSupabaseBrowserClient: () => {
        throw new Error("Supabase browser client should not be needed without a configured client");
      },
      isSupabaseBrowserConfigured: () => false,
    },
  };

  new Function("require", "module", "exports", "fetch", "window", "process", js)(
    (id) => {
      if (!(id in stubs)) {
        throw new Error(`Unexpected dependency: ${id}`);
      }

      return stubs[id];
    },
    module,
    module.exports,
    async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ payment: { id: paymentId, status: "succeeded", targetTitle: "Публикация" } }),
      };
    },
    window,
    { env: { NODE_ENV: "production" } },
  );

  const payload = await module.exports.confirmClientPayment(paymentId);

  assert.equal(payload.payment.id, paymentId);
  assert.deepEqual(calls.map((call) => call.url), [`/api/payments/${paymentId}/confirm`]);
  assert.deepEqual(storageCalls, []);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].dedupeKey, new RegExp(paymentId));
});

test("publication deletion remains in component memory and a fresh owner GET is the source of truth", () => {
  const cabinetSource = readSource("src/components/cabinet/CabinetClient.tsx");

  assert.doesNotMatch(cabinetSource, /blizhniy-deleted-publication-ids|deletedPublicationIdsStorageKey|readDeletedPublicationIds|rememberDeletedPublicationId/);
  assert.doesNotMatch(cabinetSource, /window\.localStorage\.(?:getItem|setItem|removeItem)/);
  assert.match(cabinetSource, /const \[hiddenItemIds, setHiddenItemIds\] = useState<Set<string>>\(\(\) => new Set\(\)\);/);
  assert.match(cabinetSource, /void deletePublication\(item\)\s*\.then\(\(\) => \{[\s\S]*?setHiddenItemIds\(\(current\) => \{/);
  assert.doesNotMatch(cabinetSource, /deletedIds\.has\(item\.id\)/);

  for (const endpoint of ["listings", "vacancies", "work-requests"]) {
    assert.match(
      cabinetSource,
      new RegExp(`fetch\\(\\"/api/cabinet/${endpoint}\\", \\{\\s*cache: \\"no-store\\"`, "m"),
    );
  }
});

test("client payment entry points no longer keep a global pending payment id", () => {
  const paymentSource = readSource("src/lib/client-payment-flow.ts");
  const publishButtonSource = readSource("src/components/AdminDemoPublishButton.tsx");

  for (const source of [paymentSource, publishButtonSource]) {
    assert.doesNotMatch(source, /blizhniy:pendingPaymentId|rememberPendingPaymentId|window\.localStorage\.(?:getItem|setItem|removeItem)/);
  }
});
