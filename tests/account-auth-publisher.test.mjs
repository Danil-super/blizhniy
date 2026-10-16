import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyAccountSessionChange } from "../src/lib/local-account.ts";

test("login publishes through its existing channel without notifying itself or closing the listener", () => {
  const previousWindow = globalThis.window;
  const previousChannel = globalThis.BroadcastChannel;
  const events = [], messages = [];
  let opened = 0, closed = 0;
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  globalThis.BroadcastChannel = class { constructor() { opened++; } postMessage(value) { messages.push(value); } close() { closed++; } };
  const publisher = { postMessage: message => messages.push(message), close: () => { closed++; } };
  try {
    notifyAccountSessionChange(true, publisher);
    assert.deepEqual(events, ["blizhniy-account-changing"]);
    assert.deepEqual(messages, []);
    notifyAccountSessionChange(false, publisher);
    assert.deepEqual(events, ["blizhniy-account-changing", "blizhniy-account-changed"]);
    assert.deepEqual(messages, [{ type: "changed" }]);
    assert.equal(opened, 0, "a second channel would deliver our own mutation back into the form");
    assert.equal(closed, 0, "the form retains ownership of its receiving channel");
    notifyAccountSessionChange(false);
    assert.equal(opened, 1, "other callers keep their independent ephemeral publisher");
    assert.equal(closed, 1, "an ephemeral publisher is closed by its owner");
    assert.deepEqual(messages, [{ type: "changed" }, { type: "changed" }]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  }
});
