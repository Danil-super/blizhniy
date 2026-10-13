import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const itemId = "11111111-1111-4111-8111-111111111111";
const privateTitle = "Account A private publication";
const checkoutUrl = "https://checkout.example.invalid/private-account-a";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function flush() {
  for (let count = 0; count < 50; count += 1) await Promise.resolve();
}

async function settlePromptly(promise) {
  let deadline;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("successful action remained blocked by optional profile")), 100);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

const session = (owner = "account-a", token = `token-${owner}`) => ({
  user: { id: owner, email: `${owner}@example.invalid`, user_metadata: { display_name: owner } },
  access_token: token,
});

function harness({ demo = false, configured = true } = {}) {
  let currentSession = session();
  let nextAuth;
  const listeners = [];
  const stored = new Map();
  const writes = [];
  const requests = [];
  const pendingProfiles = [];
  const authUpdates = [];
  const timers = new Map();
  const clearedTimers = [];
  let nextTimerId = 0;
  let pauseProfiles = false;
  let pauseProfileBodies = false;
  const events = [];
  const schedule = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearScheduled = (id) => { clearedTimers.push(id); timers.delete(id); };
  const localStorage = {
    get length() { return stored.size; },
    key(index) { return [...stored.keys()][index] ?? null; },
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { writes.push({ key, value }); stored.set(key, value); },
    removeItem(key) { stored.delete(key); },
  };
  const window = {
    localStorage,
    location: { href: "/cabinet" },
    dispatchEvent(event) { events.push(event); },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: schedule,
    clearTimeout: clearScheduled,
  };
  const auth = {
    onAuthStateChange(callback) {
      listeners.push(callback);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() {
      if (nextAuth) {
        const pending = nextAuth;
        nextAuth = null;
        return pending.promise;
      }
      return { data: { session: currentSession }, error: null };
    },
    updateUser(updates) {
      const entry = { updates, response: deferred(), owner: currentSession?.user?.id };
      authUpdates.push(entry);
      return entry.response.promise;
    },
  };
  const context = vm.createContext({
    console,
    Error,
    Promise,
    URL,
    AbortController,
    window,
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: schedule,
    clearTimeout: clearScheduled,
    process: { env: { NODE_ENV: demo ? "development" : "production", NEXT_PUBLIC_ENABLE_DEMO_CONTENT: String(demo) } },
    async fetch(url, options) {
      const entry = { url, options, response: deferred() };
      requests.push(entry);
      options?.signal?.addEventListener("abort", () => { entry.aborted = true; });
      if (url === "/api/cabinet/profile" && options?.method !== "PUT") {
        // Deliberately allow late completion even after abort: this tests that
        // the real source cannot resume with writes when a transport misbehaves.
        if (pauseProfiles) {
          pendingProfiles.push(entry);
          return entry.response.promise;
        }
        if (pauseProfileBodies) {
          pendingProfiles.push(entry);
          return { ok: true, json: () => entry.response.promise };
        }
        return profileResponse();
      }
      return entry.response.promise;
    },
  });
  const modules = new Map();
  function load(filename) {
    const modulePath = resolve(root, filename);
    if (modules.has(modulePath)) return modules.get(modulePath).exports;
    const module = { exports: {} };
    modules.set(modulePath, module);
    let source = readFileSync(modulePath, "utf8");
    if (modulePath.endsWith("/cabinet/CabinetClient.tsx")) {
      // Expose actual module-private action functions only inside this harness.
      source += "\nexport { deletePublication, markListingSold, restoreSoldListing, unpublishPaidPublication, restorePaidPublication };";
      const ast = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const settings = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsPanel");
      const submit = settings?.body?.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmit");
      assert.ok(submit, "extract the actual SettingsPanel callback, not a rewritten test implementation");
      source += `\nexport function __settingsSubmitForTest(identity, form, callbacks) {
        const { setForm, setMessage, setSaving, onClose, saveProfile } = callbacks;
        ${submit.getText(ast)}
        return handleSubmit;
      }`;
    }
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: modulePath,
    }).outputText;
    vm.runInContext(`(function(require, module, exports) { ${js}\n})`, context, { filename: modulePath })(
      (specifier) => {
        if (specifier === "@/lib/supabase-browser") {
          return {
            isSupabaseBrowserConfigured: () => configured,
            getSupabaseBrowserClient() {
              if (!configured) throw new Error("offline demo has no Auth client");
              return { auth };
            },
          };
        }
        if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
        const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(modulePath), specifier);
        const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
          .find((candidate) => /\.(ts|tsx)$/.test(candidate) && existsSync(candidate));
        assert.ok(dependency, `Missing real source dependency ${specifier}`);
        return load(dependency);
      }, module, module.exports,
    );
    return module.exports;
  }

  return {
    load, requests, writes, stored, pendingProfiles, window, events, authUpdates, timers, clearedTimers,
    deferAuth() { nextAuth = deferred(); return nextAuth; },
    pauseProfiles() { pauseProfiles = true; },
    pauseProfileBodies() { pauseProfileBodies = true; },
    expireTimers(maxDelay = 1500) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay <= maxDelay) { timers.delete(id); timer.callback(); }
      }
    },
    switchTo(owner, event = "SIGNED_IN", token) {
      currentSession = owner ? session(owner, token) : null;
      listeners.forEach((listener) => listener(event, currentSession));
    },
  };
}

function profileResponse() {
  return { ok: true, json: async () => ({ exists: true, profile: {
    notifyPayments: true, notifyPublicationStatus: true, notifySystem: true,
  } }) };
}

function operationResponse(url) {
  return { ok: true, json: async () => url === "/api/payments"
    ? { payment: { id: itemId, confirmationUrl: checkoutUrl, status: "pending" } }
    : url.includes("/confirm")
      ? { payment: { id: itemId, status: "succeeded", targetTitle: privateTitle } }
      : { deleted: true, workRequest: { id: itemId } } };
}

function noticeValues(h, owner) {
  return h.load("src/lib/site-notifications.ts").readSiteNotifications(owner);
}

function assertNoBLeak(h) {
  assert.equal(noticeValues(h, "account-b").length, 0);
  assert.equal(h.writes.some(({ key, value }) => key.endsWith(":account-b") && /private-account-a|Account A private/.test(value)), false);
  assert.doesNotMatch(JSON.stringify(h.events.filter((event) => event.detail?.ownerKey === "account-b")), /private-account-a|Account A private/);
  assert.notEqual(h.window.location.href, checkoutUrl, "a stale completion must not redirect B to A checkout");
}

const item = (type) => ({
  id: itemId, type, title: privateTitle, city: "Краснодар", status: "Опубликовано", createdAt: "2026-10-07T10:00:00Z",
});
const actions = [
  { name: "delete publication", run: (h) => h.load("src/components/cabinet/CabinetClient.tsx").deletePublication(item("workRequest")) },
  { name: "create checkout", run: (h) => h.load("src/lib/client-payment-flow.ts").createClientPayment({ tariffId: "vacancy-publication", targetId: itemId, targetType: "vacancy", targetTitle: privateTitle }) },
  { name: "confirm payment", run: (h) => h.load("src/lib/client-payment-flow.ts").confirmClientPayment(itemId) },
  { name: "mark sold", run: (h) => h.load("src/components/cabinet/CabinetClient.tsx").markListingSold(item("listing"), "platform") },
  { name: "restore sold", run: (h) => h.load("src/components/cabinet/CabinetClient.tsx").restoreSoldListing(item("listing")) },
  { name: "archive publication", run: (h) => h.load("src/components/cabinet/CabinetClient.tsx").unpublishPaidPublication(item("vacancy")) },
  { name: "restore publication", run: (h) => h.load("src/components/cabinet/CabinetClient.tsx").restorePaidPublication(item("workRequest")) },
  { name: "checkout redirect", run: (h) => h.load("src/lib/client-payment-flow.ts").createAndConfirmClientPayment({ tariffId: "fair-participation", targetId: itemId, targetType: "fair_application", targetTitle: privateTitle }) },
];

for (const action of actions) {
  test(`${action.name} discards an A result when B signs in during the request`, async () => {
    const h = harness();
    const outcome = action.run(h).then((result) => ({ result }), (error) => ({ error }));
    await flush();
    const request = h.requests.find(({ url }) => url !== "/api/cabinet/profile");
    assert.ok(request, "the A operation must have reached the transport boundary");
    assert.equal(request.options.headers.Authorization, "Bearer token-account-a");
    h.switchTo("account-b");
    request.response.resolve(operationResponse(request.url));
    const settled = await outcome;
    await flush();
    assertNoBLeak(h);
    assert.ok(settled.error, "stale results must not reach UI success handlers");
    assert.match(settled.error.message, /Сессия изменилась/);
  });
}

for (const action of actions.slice(0, 3)) {
  test(`${action.name} aborts if B replaces A before the first Auth read resolves`, async () => {
    const h = harness();
    const firstAuth = h.deferAuth();
    const outcome = action.run(h).then((result) => ({ result }), (error) => ({ error }));
    h.switchTo("account-b");
    firstAuth.resolve({ data: { session: session("account-a") }, error: null });
    await flush();
    for (const request of h.requests) request.response.resolve(operationResponse(request.url));
    const settled = await outcome;
    await flush();
    assertNoBLeak(h);
    assert.equal(h.requests.filter(({ url }) => url !== "/api/cabinet/profile").length, 0, "no stale operation may be sent with B's bearer");
    assert.match(settled.error?.message ?? "", /Сессия изменилась/);
  });
}

test("checkout cannot return or redirect while its optional notification profile changes to B", async () => {
  const h = harness();
  h.pauseProfiles();
  const outcome = actions.at(-1).run(h).then((result) => ({ result }), (error) => ({ error }));
  await flush();
  const request = h.requests.find(({ url }) => url === "/api/payments");
  request.response.resolve(operationResponse(request.url));
  await flush();
  assert.equal(h.pendingProfiles.length, 1);
  h.switchTo("account-b");
  h.pendingProfiles[0].response.resolve(profileResponse());
  const settled = await outcome;
  await flush();
  assertNoBLeak(h);
  assert.match(settled.error?.message ?? "", /Сессия изменилась/);
});

test("an A notification is discarded after A → B → A during its profile read", async () => {
  const h = harness();
  h.pauseProfiles();
  const notifications = h.load("src/lib/site-notifications.ts");
  const pending = notifications.addCurrentUserNotification({ category: "publication", title: "Удалено", message: privateTitle });
  await flush();
  h.switchTo("account-b");
  h.switchTo("account-a");
  h.pendingProfiles[0].response.resolve(profileResponse());
  assert.equal(await pending, null);
  assert.equal(noticeValues(h, "account-a").length, 0);
  assertNoBLeak(h);
});

for (const action of actions.slice(0, 3)) {
  test(`${action.name} keeps the captured A bearer through a same-owner token refresh`, async () => {
    const h = harness();
    const pending = action.run(h);
    await flush();
    const request = h.requests.find(({ url }) => url !== "/api/cabinet/profile");
    h.switchTo("account-a", "TOKEN_REFRESHED", "refreshed-token-a");
    request.response.resolve(operationResponse(request.url));
    await pending;
    await flush();
    assert.equal(request.options.headers.Authorization, "Bearer token-account-a");
    assert.equal(noticeValues(h, "account-a").length, 1);
    assertNoBLeak(h);
    const profileRequest = h.requests.find(({ url }) => url === "/api/cabinet/profile");
    assert.equal(profileRequest.options.headers.Authorization, "Bearer token-account-a", "notification uses the operation's captured bearer");
  });
}

test("explicit local demo notification behavior remains available without Auth", async () => {
  const h = harness({ demo: true, configured: false });
  const notices = h.load("src/lib/site-notifications.ts");
  const notification = await notices.addCurrentUserNotification({ category: "system", title: "Демо", message: "Локальное уведомление" });
  assert.ok(notification);
  assert.equal(notices.readSiteNotifications("local-user").length, 1);
  assert.ok(h.stored.has("blizhniy-site-notifications:local-user"));
});

for (const action of actions.slice(0, 3)) {
  test(`${action.name} succeeds promptly after a stalled optional profile times out and aborts`, async () => {
    const h = harness();
    h.pauseProfiles();
    const pending = action.run(h);
    await flush();
    const request = h.requests.find(({ url }) => url !== "/api/cabinet/profile");
    request.response.resolve(operationResponse(request.url));
    await flush();
    assert.equal(h.pendingProfiles.length, 1);
    h.expireTimers();
    await settlePromptly(pending);
    const profile = h.pendingProfiles[0];
    assert.equal(profile.options.signal?.aborted, true, "timeout must abort the actual transport signal");
    assert.equal(profile.aborted, true);
    assert.equal(h.timers.size, 0, "optional timer must be cleared on all exits");
    assert.equal(noticeValues(h, "account-a").length, 0, "no default-enabled notification after profile timeout");
    h.switchTo("account-b");
    profile.response.resolve(profileResponse());
    await flush();
    assertNoBLeak(h);
    assert.equal(noticeValues(h, "account-a").length, 0, "late response cannot add an A notification either");
  });
}

test("checkout timeout still rejects a stale result and a late profile cannot redirect B", async () => {
  const h = harness();
  h.pauseProfiles();
  const outcome = actions.at(-1).run(h).then((result) => ({ result }), (error) => ({ error }));
  await flush();
  const request = h.requests.find(({ url }) => url === "/api/payments");
  request.response.resolve(operationResponse(request.url));
  await flush();
  const profile = h.pendingProfiles[0];
  h.switchTo("account-b");
  h.expireTimers();
  const settled = await settlePromptly(outcome);
  assert.match(settled.error?.message ?? "", /Сессия изменилась/);
  assert.equal(profile.options.signal?.aborted, true);
  assertNoBLeak(h);
  profile.response.resolve(profileResponse());
  await flush();
  assertNoBLeak(h);
  assert.equal(noticeValues(h, "account-a").length, 0);
});

test("same-owner checkout redirects promptly despite optional profile timeout, never again on late completion", async () => {
  const h = harness();
  h.pauseProfiles();
  const pending = actions.at(-1).run(h);
  await flush();
  h.requests.find(({ url }) => url === "/api/payments").response.resolve(operationResponse("/api/payments"));
  await flush();
  h.expireTimers();
  await settlePromptly(pending);
  assert.equal(h.window.location.href, checkoutUrl, "A may use A's successful checkout");
  assert.equal(noticeValues(h, "account-a").length, 0);
  h.switchTo("account-b");
  h.window.location.href = "/cabinet-b";
  h.pendingProfiles[0].response.resolve(profileResponse());
  await flush();
  assert.equal(h.window.location.href, "/cabinet-b", "late profile completion cannot replay a redirect");
  assertNoBLeak(h);
});

test("notification timeout during JSON parsing prevents late legacy migration or notification writes", async () => {
  const h = harness();
  h.pauseProfileBodies();
  h.stored.set("blizhniy-user-profile:account-a", JSON.stringify({ name: "Private legacy A" }));
  const notifications = h.load("src/lib/site-notifications.ts");
  const pending = notifications.addCurrentUserNotification({ category: "system", title: "Updated", message: privateTitle });
  await flush();
  const profile = h.pendingProfiles[0];
  h.expireTimers();
  assert.equal(await settlePromptly(pending), null);
  assert.equal(profile.options.signal?.aborted, true);
  profile.response.resolve({ exists: false, profile: { notifySystem: true } });
  await flush();
  assert.equal(h.requests.filter(({ options }) => options?.method === "PUT").length, 0, "an aborted optional read cannot start a migration write");
  assert.equal(h.stored.has("blizhniy-user-profile:account-a"), true, "late read does not consume the legacy profile");
  assert.equal(noticeValues(h, "account-a").length, 0);
});

test("a failing optional profile leaves successful checkout usable and clears its timer", async () => {
  const h = harness();
  h.pauseProfiles();
  const pending = actions[1].run(h);
  await flush();
  h.requests.find(({ url }) => url === "/api/payments").response.resolve(operationResponse("/api/payments"));
  await flush();
  h.pendingProfiles[0].response.resolve({ ok: false, json: async () => ({ error: "optional profile unavailable" }) });
  assert.equal((await settlePromptly(pending)).confirmationUrl, checkoutUrl);
  assert.equal(noticeValues(h, "account-a").length, 0);
  assert.equal(h.timers.size, 0);
});

test("ordinary cabinet profile reads retain their existing unbounded default semantics", async () => {
  const h = harness();
  h.pauseProfiles();
  const profiles = h.load("src/lib/client-user-profile.ts");
  const identity = await profiles.resolveClientUserIdentity();
  let settled = false;
  const pending = profiles.readCabinetProfile(identity).then((profile) => { settled = true; return profile; });
  await flush();
  h.expireTimers();
  await flush();
  assert.equal(settled, false);
  assert.equal(h.pendingProfiles[0].options.signal, undefined);
  h.pendingProfiles[0].response.resolve(profileResponse());
  assert.equal((await pending).notifySystem, true);
});

for (const switched of [false, true]) {
  test(`pending-payment notifier ${switched ? "discards B-side completion" : "retains same-owner refresh"} after real confirmation retries`, async () => {
    const h = harness();
    h.pauseProfiles();
    const outcome = actions[2].run(h).then((result) => ({ result }), (error) => ({ error }));
    await flush();
    // Drive the actual module's retry timers; do not stub confirmation or its
    // pending-status notification branch. The cap catches a runaway retry.
    for (let attempt = 0; attempt < 25 && !h.pendingProfiles.length; attempt += 1) {
      const request = h.requests.filter(({ url }) => url.includes("/confirm")).at(-1);
      assert.ok(request);
      request.response.resolve({ ok: true, json: async () => ({ payment: { id: itemId, status: "pending", targetTitle: privateTitle } }) });
      await flush();
      if (!h.pendingProfiles.length) { h.expireTimers(); await flush(); }
    }
    assert.equal(h.pendingProfiles.length, 1, "real retries must reach the pending-payment notification");
    const profile = h.pendingProfiles[0];
    assert.equal(profile.options.headers.Authorization, "Bearer token-account-a");
    h.switchTo(switched ? "account-b" : "account-a", switched ? "SIGNED_IN" : "TOKEN_REFRESHED", "refreshed-token");
    profile.response.resolve(profileResponse());
    const settled = await settlePromptly(outcome);
    if (switched) {
      assert.match(settled.error?.message ?? "", /Сессия изменилась/);
      assert.equal(noticeValues(h, "account-a").length, 0);
    } else {
      assert.equal(settled.result?.payment?.status, "pending");
      assert.equal(noticeValues(h, "account-a")[0].title, "Платеж ожидает подтверждения");
    }
    assertNoBLeak(h);
    assert.equal([...h.timers.values()].every(({ delay }) => delay === 0), true, "only the Auth cleanup event can remain scheduled");
  });
}

async function settingsHarness() {
  const h = harness();
  const profiles = h.load("src/lib/client-user-profile.ts");
  const identity = await profiles.resolveClientUserIdentity();
  const profile = profiles.createDefaultCabinetProfile(identity);
  const state = { closed: 0, forms: [], messages: [], saving: [] };
  const submit = h.load("src/components/cabinet/CabinetClient.tsx").__settingsSubmitForTest(identity, profile, {
    setForm: (value) => state.forms.push(value),
    setMessage: (value) => state.messages.push(value),
    setSaving: (value) => state.saving.push(value),
    onClose: () => { state.closed += 1; },
  });
  return { h, state, submit: () => submit({ preventDefault() {}, currentTarget: { reportValidity: () => true } }) };
}

function assertSettingsDiscarded(h, state) {
  assert.equal(state.closed, 0);
  assert.equal(state.forms.length, 0, "stale saved profile never becomes the displayed settings form");
  assert.equal(state.messages.some((message) => message.startsWith("Настройки сохранены")), false);
  assert.equal(state.saving.at(-1), false);
  assertNoBLeak(h);
}

test("SettingsPanel.handleSubmit discards A settings if first Auth lookup resolves after B signs in", async () => {
  const { h, state, submit } = await settingsHarness();
  h.switchTo("account-a", "TOKEN_REFRESHED"); // clear cached identity, retaining A ownership
  const auth = h.deferAuth();
  const pending = submit();
  h.switchTo("account-b");
  auth.resolve({ data: { session: session("account-a") }, error: null });
  await pending;
  assert.equal(h.authUpdates.length, 0);
  assertSettingsDiscarded(h, state);
});

test("SettingsPanel.handleSubmit discards completion after account switch during Auth update", async () => {
  const { h, state, submit } = await settingsHarness();
  const pending = submit();
  await flush();
  assert.equal(h.authUpdates[0].owner, "account-a");
  h.switchTo("account-b");
  h.authUpdates[0].response.resolve({ error: null });
  await pending;
  assert.equal(h.requests.filter(({ options }) => options?.method === "PUT").length, 0);
  assertSettingsDiscarded(h, state);
});

test("SettingsPanel.handleSubmit discards completion after account switch during actual profile save", async () => {
  const { h, state, submit } = await settingsHarness();
  const pending = submit();
  await flush();
  h.authUpdates[0].response.resolve({ error: null });
  await flush();
  const save = h.requests.find(({ options }) => options?.method === "PUT");
  assert.equal(save.options.headers.Authorization, "Bearer token-account-a");
  h.switchTo("account-b");
  save.response.resolve(profileResponse());
  await pending;
  assertSettingsDiscarded(h, state);
});

test("SettingsPanel.handleSubmit discards completion after A → B → A during Auth update", async () => {
  const { h, state, submit } = await settingsHarness();
  const pending = submit();
  await flush();
  h.switchTo("account-b");
  h.switchTo("account-a");
  h.authUpdates[0].response.resolve({ error: null });
  await flush();
  assert.equal(h.requests.length, 0);
  await settlePromptly(pending);
  assertSettingsDiscarded(h, state);
});

test("SettingsPanel.handleSubmit discards completion if B signs in while optional profile stalls", async () => {
  const { h, state, submit } = await settingsHarness();
  h.pauseProfiles();
  const pending = submit();
  await flush();
  h.authUpdates[0].response.resolve({ error: null });
  await flush();
  h.requests.find(({ options }) => options?.method === "PUT").response.resolve(profileResponse());
  await flush();
  assert.equal(h.pendingProfiles.length, 1);
  h.switchTo("account-b");
  h.expireTimers();
  await settlePromptly(pending);
  assertSettingsDiscarded(h, state);
  h.pendingProfiles[0].response.resolve(profileResponse());
  await flush();
  assertSettingsDiscarded(h, state);
});

test("SettingsPanel.handleSubmit completes and closes for unchanged A despite optional profile timeout", async () => {
  const { h, state, submit } = await settingsHarness();
  h.pauseProfiles();
  const pending = submit();
  await flush();
  h.authUpdates[0].response.resolve({ error: null });
  await flush();
  h.requests.find(({ options }) => options?.method === "PUT").response.resolve(profileResponse());
  await flush();
  h.expireTimers();
  await settlePromptly(pending);
  assert.equal(state.messages.at(-1), "Настройки сохранены.");
  assert.equal(state.forms.length, 1);
  assert.equal(noticeValues(h, "account-a").length, 0);
  h.expireTimers(450);
  await flush();
  assert.equal(state.closed, 1);
});

test("SettingsPanel.handleSubmit remains usable through same-owner token refresh and checks delayed close", async () => {
  const { h, state, submit } = await settingsHarness();
  const pending = submit();
  await flush();
  h.switchTo("account-a", "TOKEN_REFRESHED", "refreshed-token-a");
  h.authUpdates[0].response.resolve({ error: null });
  await flush();
  const save = h.requests.find(({ options }) => options?.method === "PUT");
  assert.equal(save.options.headers.Authorization, "Bearer refreshed-token-a");
  save.response.resolve(profileResponse());
  await pending;
  assert.equal(state.forms.length, 1);
  assert.equal(noticeValues(h, "account-a").length, 1);
  assert.equal(state.messages.at(-1), "Настройки сохранены.");
  h.switchTo("account-b");
  h.expireTimers(450);
  await flush();
  assert.equal(state.closed, 0, "delayed close cannot affect the replacement account");
  assertNoBLeak(h);
});
