import assert from "node:assert/strict";

const anonymous = { status: 401, json: { error: { code: "UNAUTHENTICATED" } } };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const lifecycle = page => page.evaluate(() => {
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
});
const fill = async (page, origin, password) => {
  await page.goto(origin + "/rabota/zakazy/sozdat");
  await page.locator('[data-fixture-widget="captcha"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
};

// This is the actual publication route, including its outer account gate. The
// standalone /auth screen cannot catch a parent unmounting the login component.
export async function testEmbeddedLoginScenarios({ run, origin, password }) {
  await run("successful embedded login stays on the publication route and makes the order form available", async ({ page, calls }) => {
    await fill(page, origin, password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByLabel("Название заказа", { exact: true }).waitFor();
    assert.equal(page.url(), origin + "/rabota/zakazy/sozdat");
    assert.equal(calls.filter(row => row.action === "login").length, 1);
    assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
  });

  await run("embedded anonymous login retains controls and CAPTCHA when its outer publication gate rechecks session on focus", async ({ page, calls, state }) => {
    await fill(page, origin, password);
    const email = await page.getByLabel("Email", { exact: true }).elementHandle();
    const secret = await page.getByLabel("Пароль", { exact: true }).elementHandle();
    const captcha = await page.locator('[data-fixture-widget="captcha"]').elementHandle();
    const gate = deferred(), started = deferred(), pending = [];
    state.override = (route, action) => {
      assert.equal(action, "session");started.resolve();
      const completion = gate.promise.then(() => route.fulfill(anonymous));pending.push(completion);return completion;
    };
    try {
      await lifecycle(page);await started.promise;await render(page);
      assert.equal(await email.evaluate(node => node.isConnected), true, "parent background loading cannot unmount an anonymous email input");
      assert.equal(await secret.evaluate(node => node.isConnected), true);
      assert.equal(await captcha.evaluate(node => node.isConnected), true);
      gate.resolve();await Promise.all(pending);await render(page);
      assert.equal(await page.getByLabel("Email", { exact: true }).evaluate((node, previous) => node === previous, email), true);
      assert.equal(await page.getByLabel("Пароль", { exact: true }).evaluate((node, previous) => node === previous, secret), true);
      assert.equal(await page.locator('[data-fixture-widget="captcha"]').evaluate((node, previous) => node === previous, captcha), true);
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), password);
      assert.equal(await page.getByRole("button", { name: "Войти", exact: true }).isEnabled(), true);
      assert.deepEqual(calls, [], "a publication-gate recheck cannot submit credentials");
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });

  await run("embedded invalid login keeps its definitive error and email through parent auth invalidation and later focus", async ({ page, calls, state }) => {
    state.override = (route, action) => route.fulfill(action === "session" ? anonymous :
      { status: 401, json: { error: { code: "INVALID_CREDENTIALS" } } });
    await fill(page, origin, password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const error = page.locator("main").getByRole("alert").filter({ hasText: "Неверный email или пароль" });
    await error.waitFor();
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
    assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), "");
    await lifecycle(page);await render(page);
    assert.equal(await error.isVisible(), true, "parent session refresh cannot swallow a known credential rejection");
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
    assert.equal(await page.locator('main a[href="/auth/register#resend"]').isVisible(), true);
    assert.deepEqual(calls, [{ action: "login", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } }]);
  });

  await run("embedded login preserves entered fields and CAPTCHA with an explicit warning when the background session read fails", async ({ page, calls, state }) => {
    await fill(page, origin, password);
    const email = await page.getByLabel("Email", { exact: true }).elementHandle();
    const secret = await page.getByLabel("Пароль", { exact: true }).elementHandle();
    const captcha = await page.locator('[data-fixture-widget="captcha"]').elementHandle();
    const gate = deferred(), started = deferred(), pending = [];
    state.override = (route, action) => {
      assert.equal(action, "session");started.resolve();
      const completion = gate.promise.then(() => route.abort());pending.push(completion);return completion;
    };
    try {
      await lifecycle(page);await started.promise;gate.resolve();await Promise.all(pending);await render(page);
      assert.equal(await email.evaluate(node => node.isConnected), true, "anonymous account checks cannot replace the form with a parent unavailable screen");
      assert.equal(await secret.evaluate(node => node.isConnected), true);
      assert.equal(await captcha.evaluate(node => node.isConnected), true);
      await page.locator("main").getByRole("alert").filter({ hasText: "Не удалось обновить состояние сессии" }).waitFor();
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), password);
      assert.equal(await page.getByRole("button", { name: "Войти", exact: true }).isEnabled(), true);
      assert.deepEqual(calls, [], "network recovery cannot retry credentials or create a publication");
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });
}
