import assert from "node:assert/strict";
import { createDefaultCabinetProfile } from "../src/lib/cabinet-profile.ts";

// Owned transport fixtures only: no real accounts, storage or remote requests.
const identity = second => ({ id: second ? "22345678-1234-4321-8765-123456789abc" : "12345678-1234-4321-8765-123456789abc",
  email: second ? "second@example.invalid" : "first@example.invalid", role: "user", isBlocked: false });
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const focus = page => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const credentialMutations = calls => calls.filter(call => ["login", "logout", "register", "resend", "recover", "confirm", "reset"].includes(call.action));

async function checkSession(page, origin) {
  const response = page.waitForResponse(item => item.url() === origin + "/api/account/session");
  await focus(page);
  await response;
  await render(page);
}

async function openSettings(page, origin, state, owner = identity(false), name = "Сохранённое имя") {
  state.active = owner;
  state.profiles.set(owner.id, createDefaultCabinetProfile({ name, email: owner.email }));
  await page.goto(origin + "/cabinet");
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Имя", { exact: true }).waitFor();
}

async function interruptSessionRead(page, origin, state) {
  state.override = (route, action) => {
    assert.equal(action, "session", "a connection failure cannot issue credential mutations");
    return route.abort("internetdisconnected");
  };
  const failed = page.waitForEvent("requestfailed", { predicate: request => request.url() === origin + "/api/account/session" });
  await focus(page);
  await failed;
  await render(page);
}

export async function testCabinetOfflineScenarios({ run, origin }) {
  await run("a transient session network failure restores the same owner's unsaved profile fields without a false logout or automatic write", async ({ page, calls, state }) => {
    await openSettings(page, origin, state);
    await page.getByLabel("Имя", { exact: true }).fill("Несохранённое имя");
    await page.getByLabel("Брони и заказы", { exact: true }).uncheck();
    const writes = state.profileRequests.filter(request => request.method === "PUT").length;
    await interruptSessionRead(page, origin, state);
    assert.equal(page.url(), origin + "/cabinet", "an unreachable session API is not a reason to navigate away");
    assert.equal(await page.getByText("Войдите в аккаунт, чтобы открыть свои черновики.", { exact: true }).count(), 0,
      "a transport failure is not a confirmed sign-out");
    assert.equal(state.profileRequests.filter(request => request.method === "PUT").length, writes,
      "background verification never saves form values on the user's behalf");
    state.override = null;
    await checkSession(page, origin);
    await page.getByLabel("Имя", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Несохранённое имя",
      "a same-owner session recovery must restore the local editor, not replace it with the persisted profile");
    assert.equal(await page.getByLabel("Брони и заказы", { exact: true }).isChecked(), false);
    assert.equal(state.profiles.get(state.active.id).name, "Сохранённое имя", "unsaved text remains unsaved");
    assert.equal(state.profileRequests.filter(request => request.method === "PUT").length, writes);
    assert.deepEqual(calls, [], "focus and network recovery never log in, log out or submit credentials");
  });

  await run("a transient session failure on the ordinary placement form retains the same owner's unsaved listing buffer", async ({ page, calls, state }) => {
    const owner = identity(false), id = "32345678-1234-4321-8765-123456789abc";
    state.active = owner;
    state.drafts.set(owner.id, new Map([[id, { id, revision: "1", draft: { kind: "prodam", title: "Черновик для проверки сети",
      description: "Сохранённое описание", categoryId: null, cityId: null, price: null } }]]));
    await page.goto(origin + "/cabinet/obyavleniya");
    await page.getByRole("link", { name: "Черновик для проверки сети", exact: true }).waitFor();
    await page.getByRole("link", { name: "Создать объявление", exact: true }).first().click();
    await page.waitForURL(origin + "/razmestit/obyavlenie");
    await page.getByLabel("Название", { exact: true }).fill("Правки объявления до обрыва сети");
    await interruptSessionRead(page, origin, state);
    assert.equal(page.url(), origin + "/razmestit/obyavlenie");
    assert.equal(await page.getByText("Войдите в аккаунт, чтобы открыть свои черновики.", { exact: true }).count(), 0);
    state.override = null;
    await checkSession(page, origin);
    await page.getByLabel("Название", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Название", { exact: true }).inputValue(), "Правки объявления до обрыва сети");
    assert.equal(state.drafts.get(owner.id).get(id).draft.title, "Черновик для проверки сети");
    assert.equal(state.draftRequests.filter(request => request.method === "PUT").length, 0);
    assert.deepEqual(credentialMutations(calls), [], "normal moderation reads are not credential mutations; reconnecting must not log in or out");
  });

  await run("an online event rechecks the session and restores unsaved profile values without requiring focus or resubmitting them", async ({ page, calls, state }) => {
    await openSettings(page, origin, state);
    await page.getByLabel("Имя", { exact: true }).fill("Правки до возвращения сети");
    await page.getByLabel("Брони и заказы", { exact: true }).uncheck();
    await interruptSessionRead(page, origin, state);
    state.override = null;
    const readsBeforeOnline = state.sessionReads.length;
    const recovered = page.waitForResponse(response => response.url() === origin + "/api/account/session");
    // Only the browser connectivity event is emitted: no synthetic focus, login,
    // save or reload can accidentally make this reconnect scenario pass.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    assert.equal((await recovered).status(), 200);
    await render(page);
    await page.getByLabel("Имя", { exact: true }).waitFor();
    assert.ok(state.sessionReads.length > readsBeforeOnline, "online must trigger a fresh server-owned session check");
    assert.equal(page.url(), origin + "/cabinet");
    assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Правки до возвращения сети");
    assert.equal(await page.getByLabel("Брони и заказы", { exact: true }).isChecked(), false);
    assert.equal(state.profiles.get(state.active.id).name, "Сохранённое имя");
    assert.equal(state.profileRequests.filter(request => request.method === "PUT").length, 0, "connectivity recovery is not permission to save");
    assert.deepEqual(credentialMutations(calls), [], "connectivity recovery never resubmits credentials");
  });

  await run("a definitive session 401 destroys the previous owner's unsaved profile instead of resurrecting it after a later login", async ({ page, calls, state }) => {
    const owner = identity(false), unsaved = "Частное несохранённое имя";
    await openSettings(page, origin, state, owner);
    await page.getByLabel("Имя", { exact: true }).fill(unsaved);
    state.active = null;
    await checkSession(page, origin);
    assert.equal(await page.getByLabel("Имя", { exact: true }).count(), 0, "a confirmed sign-out removes the private editor");
    assert.equal((await page.locator("main").textContent()).includes(unsaved), false);
    state.active = owner;
    await checkSession(page, origin);
    await page.getByRole("heading", { name: "Сохранённое имя", exact: true }).waitFor();
    if (!await page.getByLabel("Имя", { exact: true }).count()) await page.getByRole("button", { name: "Настройки", exact: true }).click();
    assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Сохранённое имя",
      "a confirmed logout is a boundary: even the same account cannot recover the previous private edit buffer");
    assert.equal(state.profileRequests.filter(request => request.method === "PUT").length, 0);
    assert.deepEqual(calls, []);
  });

  await run("a verified owner switch destroys the old profile buffer and cannot resurrect it when that account returns", async ({ page, calls, state }) => {
    const first = identity(false), second = identity(true), unsaved = "Только первый владелец";
    await openSettings(page, origin, state, first, "Первый сохранённый");
    state.profiles.set(second.id, createDefaultCabinetProfile({ name: "Второй сохранённый", email: second.email }));
    await page.getByLabel("Имя", { exact: true }).fill(unsaved);
    state.active = second;
    await checkSession(page, origin);
    await page.getByRole("heading", { name: "Второй сохранённый", exact: true }).waitFor();
    assert.equal((await page.locator("main").textContent()).includes(unsaved), false);
    if (!await page.getByLabel("Имя", { exact: true }).count()) await page.getByRole("button", { name: "Настройки", exact: true }).click();
    assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Второй сохранённый");
    state.active = first;
    await checkSession(page, origin);
    await page.getByRole("heading", { name: "Первый сохранённый", exact: true }).waitFor();
    if (!await page.getByLabel("Имя", { exact: true }).count()) await page.getByRole("button", { name: "Настройки", exact: true }).click();
    assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Первый сохранённый",
      "owner isolation is not a multi-account cache of abandoned private inputs");
    assert.equal(state.profileRequests.filter(request => request.method === "PUT").length, 0);
    assert.deepEqual(calls, []);
  });
}
