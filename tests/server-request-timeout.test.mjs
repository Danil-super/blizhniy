import assert from "node:assert/strict";
import test from "node:test";
import { withServerRequestTimeout } from "../src/lib/server-request-timeout.ts";

test("a server request timeout aborts an operation that never completes", async () => {
  let receivedSignal;
  const startedAt = Date.now();

  await assert.rejects(
    withServerRequestTimeout(25, async (signal) => {
      receivedSignal = signal;

      await new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }),
    { name: "AbortError" },
  );

  assert.equal(receivedSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 2000);
});

test("a server request timeout returns a successful result unchanged", async () => {
  const result = await withServerRequestTimeout(100, async (signal) => {
    assert.equal(signal.aborted, false);
    return { ok: true };
  });

  assert.deepEqual(result, { ok: true });
});
