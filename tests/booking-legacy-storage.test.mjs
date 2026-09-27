import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingNotificationsStorageKey,
  bookingRequestsStorageKey,
  installLegacyBookingStorageCleanup,
} from "../src/lib/booking-notifications.ts";
import { shouldShowClientFallbackContent } from "../src/lib/client-runtime-mode.ts";

test("shared booking storage is enabled only in explicit development demo mode", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDemoContent = process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT;

  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = "true";
    assert.equal(shouldShowClientFallbackContent(), false);

    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = "false";
    assert.equal(shouldShowClientFallbackContent(), false);

    process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = "true";
    assert.equal(shouldShowClientFallbackContent(), true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDemoContent === undefined) delete process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT;
    else process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT = previousDemoContent;
  }
});

test("legacy booking data is cleared on load, logout, and the next login", () => {
  const values = new Map([
    [bookingRequestsStorageKey, "account A request"],
    [bookingNotificationsStorageKey, "account A notification"],
    ["unrelated-key", "keep"],
  ]);
  const storage = { removeItem: (key) => values.delete(key) };
  let onAuthChange = () => {};
  let subscribed = true;
  const unsubscribe = installLegacyBookingStorageCleanup(storage, (callback) => {
    onAuthChange = callback;
    return () => { subscribed = false; };
  });

  assert.equal(values.has(bookingRequestsStorageKey), false);
  assert.equal(values.has(bookingNotificationsStorageKey), false);
  assert.equal(values.get("unrelated-key"), "keep");

  values.set(bookingRequestsStorageKey, "account A request");
  values.set(bookingNotificationsStorageKey, "account A notification");
  onAuthChange(); // A logs out
  assert.equal(values.has(bookingRequestsStorageKey), false);
  assert.equal(values.has(bookingNotificationsStorageKey), false);

  values.set(bookingRequestsStorageKey, "stale request");
  onAuthChange(); // B logs in on the same browser
  assert.equal(values.has(bookingRequestsStorageKey), false);
  assert.equal(values.get("unrelated-key"), "keep");

  unsubscribe();
  assert.equal(subscribed, false);
});

test("a blocked storage key does not prevent removal of the other booking key", () => {
  const removed = [];
  const storage = {
    removeItem(key) {
      if (key === bookingRequestsStorageKey) throw new Error("blocked");
      removed.push(key);
    },
  };

  installLegacyBookingStorageCleanup(storage, () => () => {});
  assert.deepEqual(removed, [bookingNotificationsStorageKey]);
});
