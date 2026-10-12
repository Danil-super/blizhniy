import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryFailure, MailDeliveryWorker } from "../src/lib/mail-delivery.ts";

test("only explicit temporary SMTP rejection is retryable, with bounded backoff and five attempts", () => {
  for (let attempt=1; attempt<=4; attempt++) {
    assert.deepEqual(deliveryFailure("TEMPORARY", attempt), { state: "ready", delaySeconds: 60*2**(attempt-1) });
  }
  assert.deepEqual(deliveryFailure("TEMPORARY", 5), { state: "failed", delaySeconds: 0 });
  for (const code of ["AUTH_FAILED", "REJECTED"]) {
    assert.deepEqual(deliveryFailure(code, 1), { state: "failed", delaySeconds: 0 });
  }
  assert.deepEqual(deliveryFailure("UNKNOWN", 1), { state: "unknown", delaySeconds: 0 });
  for (const attempt of [0, 6, 1.5, "1"]) assert.throws(() => deliveryFailure("TEMPORARY", attempt), /Invalid delivery attempt/);
});

test("worker refuses browser use before touching storage or SMTP", () => {
  globalThis.window = {};
  try { assert.throws(() => new MailDeliveryWorker({}, {}, () => ({})), /server-only/); }
  finally { delete globalThis.window; }
});

test("claim identifiers and cleanup size are validated before database access", async () => {
  const worker = new MailDeliveryWorker({ query: async () => assert.fail("invalid request reached DB") }, {}, () => ({}));
  for (const limit of [0, 1001, 1.5, "1"]) await assert.rejects(worker.recoverAbandoned(limit), /Invalid delivery cleanup limit/);
  for (const claim of [null, {}, { id: "bad", userId: "bad", claimId: "bad" }]) {
    await assert.rejects(worker.prepare(claim), /Invalid mail claim/);
    await assert.rejects(worker.finish(claim, "accepted"), /Invalid mail claim/);
  }
});
