import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const hookSource = readFileSync(new URL("../src/components/auth/useAuthState.ts", import.meta.url), "utf8");

const a = { id: "account-a" };
const b = { id: "account-b" };
const session = (user) => ({ user, access_token: `token-${user.id}` });

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function authStateResponse(state) {
  return {
    ok: true,
    json: async () => ({ state }),
  };
}

function assertSnapshot(snapshot, expected, message) {
  assert.equal(snapshot.state, expected.state, message);
  assert.equal(snapshot.userId, expected.userId, message);
}

function makeAuthHookHarness() {
  let authListener;
  let effectsStarted = false;
  let hookIndex = 0;
  const stateSlots = [];
  const pendingEffects = [];
  const timers = [];
  const requests = [];

  const react = {
    useState(initialValue) {
      const index = hookIndex;
      hookIndex += 1;

      if (stateSlots.length <= index) {
        stateSlots[index] = initialValue;
      }

      return [
        stateSlots[index],
        (nextValue) => {
          stateSlots[index] = typeof nextValue === "function" ? nextValue(stateSlots[index]) : nextValue;
        },
      ];
    },
    useEffect(effect) {
      if (!effectsStarted) {
        pendingEffects.push(effect);
      }
    },
  };

  const supabase = {
    auth: {
      getSession() {
        return Promise.resolve({ data: { session: session(a) } });
      },
      onAuthStateChange(callback) {
        authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      throw new Error("The /api/auth/state response should avoid the fallback role query in this test.");
    },
  };

  const js = ts.transpileModule(hookSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Promise,
    Set,
    window: {
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
    },
    fetch(_url, options) {
      const deferred = createDeferred();
      requests.push({ deferred, token: options?.headers?.Authorization });
      return deferred.promise;
    },
    require: (id) => {
      if (id === "react") return react;
      if (id === "@/lib/supabase-browser") return { getSupabaseBrowserClient: () => supabase };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  function readSnapshot() {
    hookIndex = 0;
    return module.exports.useAuthState();
  }

  readSnapshot();
  effectsStarted = true;
  pendingEffects.forEach((effect) => effect());

  return {
    emit(event, nextSession) {
      assert.ok(authListener, "the Auth subscription should be registered");
      authListener(event, nextSession);
    },
    readSnapshot,
    requests,
    runNextTimer() {
      const callback = timers.shift();
      assert.ok(callback, "an async role-resolution timer should be pending");
      void callback();
    },
  };
}

test("an A → B auth event synchronously hides A and stale A resolution cannot restore it", async () => {
  const h = makeAuthHookHarness();
  await flushPromises();
  assert.equal(h.requests.length, 1, "initial account A role lookup should start");

  h.emit("SIGNED_IN", session(b));
  assertSnapshot(h.readSnapshot(), { state: "loading", userId: "account-b" }, "B must replace A before B role resolution runs");

  h.runNextTimer();
  await flushPromises();
  assert.equal(h.requests.length, 2, "B should get its own role lookup");
  assert.equal(h.requests[1].token, "Bearer token-account-b");

  h.requests[1].deferred.resolve(authStateResponse("signed-in"));
  await flushPromises();
  assertSnapshot(h.readSnapshot(), { state: "signed-in", userId: "account-b" });

  h.emit("TOKEN_REFRESHED", session(b));
  assertSnapshot(h.readSnapshot(), { state: "signed-in", userId: "account-b" }, "a same-user token refresh should not reset private descendants");

  h.requests[0].deferred.resolve(authStateResponse("admin"));
  await flushPromises();
  assertSnapshot(h.readSnapshot(), { state: "signed-in", userId: "account-b" }, "the stale A response must not overwrite B");
});

function loadGate(fileName, exportName) {
  const source = readFileSync(new URL(`../src/components/auth/${fileName}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const Fragment = Symbol("Fragment");
  let authSnapshot = { state: "signed-in", userId: "account-a" };
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    window: { location: { pathname: "/cabinet", search: "" } },
    require: (id) => {
      if (id === "react/jsx-runtime") {
        return {
          Fragment,
          jsx(type, props, key) {
            return { type, props, key };
          },
          jsxs(type, props, key) {
            return { type, props, key };
          },
        };
      }

      if (id === "react") return { Fragment, useEffect() {}, useState: (initialValue) => [initialValue, () => {}] };
      if (id === "@/components/auth/useAuthState") return { useAuthState: () => authSnapshot };
      if (id === "next/link") return { default: "Link" };
      if (id === "@/components/auth/AuthForm") return { AuthForm: "AuthForm" };
      throw new Error(`Unexpected module: ${id}`);
    },
  });

  return {
    render(snapshot) {
      authSnapshot = snapshot;
      return module.exports[exportName]({ children: "private-child" });
    },
    Fragment,
  };
}

test("authenticated gates give each account a distinct child key and hide children while identity is unresolved", () => {
  for (const [fileName, exportName] of [
    ["CabinetAuthGate.tsx", "CabinetAuthGate"],
    ["PublicationAuthGate.tsx", "PublicationAuthGate"],
  ]) {
    const gate = loadGate(fileName, exportName);
    const forA = gate.render({ state: "signed-in", userId: "account-a" });
    const refreshedA = gate.render({ state: "admin", userId: "account-a" });
    const forB = gate.render({ state: "signed-in", userId: "account-b" });
    const loadingB = gate.render({ state: "loading", userId: "account-b" });

    assert.equal(forA.type, gate.Fragment);
    assert.equal(forA.key, "account-a");
    assert.equal(refreshedA.key, "account-a", `${exportName} should not remount on a same-user role/token refresh`);
    assert.equal(forB.type, gate.Fragment);
    assert.equal(forB.key, "account-b");
    assert.notEqual(forB.key, forA.key, `${exportName} must remount private descendants for account B`);
    assert.notEqual(loadingB.type, gate.Fragment, `${exportName} must not leave private descendants mounted while B resolves`);
  }
});
