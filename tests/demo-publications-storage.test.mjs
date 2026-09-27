import assert from "node:assert/strict";
import test from "node:test";
import { installLegacyBookingStorageCleanup } from "../src/lib/booking-notifications.ts";
import {
  canUseDemoPublicationsStorage,
  clearLegacyDemoPublicationsStorage,
  demoPublicationsStorageKey,
  readStoredDemoPublications,
  writeStoredDemoPublications,
} from "../src/lib/demo-publications.ts";

function withRuntime(nodeEnv, demoFlag, callback) {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldDemoFlag = process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT;
  process.env.NODE_ENV = nodeEnv;
  process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = demoFlag;

  try {
    callback();
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    if (oldDemoFlag === undefined) delete process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT;
    else process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = oldDemoFlag;
  }
}

test("production does not read A's local publications after a server failure for B", () => {
  withRuntime("production", "true", () => {
    const values = new Map([[demoPublicationsStorageKey, JSON.stringify([{ ownerKey: "A", phone: "private" }])]]);
    const storage = {
      getItem(key) {
        assert.fail(`production read shared storage: ${key}`);
      },
      setItem(key) {
        assert.fail(`production wrote shared storage: ${key}`);
      },
    };

    const serverItems = []; // The API request failed.
    const localItems = JSON.parse(readStoredDemoPublications(storage) ?? "[]");
    assert.deepEqual([...serverItems, ...localItems], []);
    assert.equal(writeStoredDemoPublications("B's private draft", storage), false);
    assert.ok(values.has(demoPublicationsStorageKey));
    assert.equal(canUseDemoPublicationsStorage(), false);
  });
});

test("explicit development demo still reads and writes local publications", () => {
  withRuntime("development", "true", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };

    assert.equal(canUseDemoPublicationsStorage(), true);
    assert.equal(writeStoredDemoPublications("demo draft", storage), true);
    assert.equal(readStoredDemoPublications(storage), "demo draft");
  });
});

test("A logout and B login clear the shared publication key", () => {
  const values = new Map([
    [demoPublicationsStorageKey, "A's private publication"],
    ["unrelated", "keep"],
  ]);
  const storage = { removeItem: (key) => values.delete(key) };
  let onAuthChange = () => {};
  const unsubscribe = installLegacyBookingStorageCleanup(
    storage,
    (callback) => {
      onAuthChange = callback;
      return () => {};
    },
    () => clearLegacyDemoPublicationsStorage(storage),
  );

  assert.equal(values.has(demoPublicationsStorageKey), false);
  values.set(demoPublicationsStorageKey, "A's private publication");
  onAuthChange(); // A logs out.
  assert.equal(values.has(demoPublicationsStorageKey), false);
  values.set(demoPublicationsStorageKey, "stale publication");
  onAuthChange(); // B logs in.
  assert.equal(values.has(demoPublicationsStorageKey), false);
  assert.equal(values.get("unrelated"), "keep");
  unsubscribe();
});
