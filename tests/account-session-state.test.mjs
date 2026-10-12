import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountSessionState } from "../src/lib/account-session-state.ts";

const user = (id, role = "user") => ({ id, role, email: "synthetic@example.invalid", isBlocked: false });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("shared cookie state clears the previous account before checking and cannot restore a stale response", async () => {
  const first = deferred(), next = deferred();
  const queue = [Promise.resolve(user("A", "admin")), first.promise, next.promise];
  const state = createAccountSessionState(() => queue.shift());
  await state.refresh();
  assert.deepEqual(state.read(), { state: "admin", userId: "A" });
  const stale = state.refresh();
  assert.deepEqual(state.read(), { state: "loading", userId: null });
  const current = state.refresh();
  next.resolve(user("B")); await current;
  first.resolve(user("A", "admin")); await stale;
  assert.deepEqual(state.read(), { state: "signed-in", userId: "B" });
});

test("mutation fences hide identity and suppress reads until all local changes finish", async () => {
  let calls = 0;
  const pending = deferred();
  const state = createAccountSessionState(() => { calls++; return calls === 1 ? Promise.resolve(user("A")) : pending.promise; });
  await state.refresh();
  state.beginChange(); state.beginChange();
  assert.deepEqual(state.read(), { state: "loading", userId: null });
  await state.refresh(); await state.endChange();
  assert.equal(calls, 1);
  const finish = state.endChange();
  assert.equal(calls, 2);
  pending.resolve(null); await finish;
  assert.deepEqual(state.read(), { state: "signed-out", userId: null });
});

test("unavailable and blocked sessions never leave an authenticated identity visible", async () => {
  const outcomes = [user("A"), new Error("Synthetic unavailable"), { ...user("A"), isBlocked: true }, null];
  const state = createAccountSessionState(async () => {
    const value = outcomes.shift(); if (value instanceof Error) throw value; return value;
  });
  await state.refresh(); await state.refresh();
  assert.deepEqual(state.read(), { state: "unavailable", userId: null });
  await state.refresh();
  assert.deepEqual(state.read(), { state: "unavailable", userId: null });
  await state.refresh();
  assert.deepEqual(state.read(), { state: "signed-out", userId: null });
});

test("stop invalidates pending responses and the same store can restart after Strict Mode cleanup", async () => {
  const old = deferred(); let calls = 0;
  const state = createAccountSessionState(() => ++calls === 1 ? old.promise : Promise.resolve(user("B")));
  const observed = [];
  state.subscribe(snapshot => observed.push(snapshot));
  const pending = state.refresh(); state.stop();
  state.subscribe(snapshot => observed.push(snapshot));
  await state.refresh(); old.resolve(user("A", "admin")); await pending;
  assert.deepEqual(state.read(), { state: "signed-in", userId: "B" });
  assert.equal(observed.some(snapshot => snapshot.userId === "A"), false);
});
