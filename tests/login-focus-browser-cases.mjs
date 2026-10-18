import assert from "node:assert/strict";

// All identities, passwords, CAPTCHA and account responses are owned local fixtures.
// Gates force the lifecycle races; no real cookies or browser storage are read.
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const anonymous = { status: 401, json: { error: { code: "UNAUTHENTICATED" } } };
const identity = second => ({ id: second ? "22345678-1234-4321-8765-123456789abc" : "12345678-1234-4321-8765-123456789abc",
  email: second ? "second@example.invalid" : "first@example.invalid", role: "user", isBlocked: false });
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const lifecycle = page => page.evaluate(() => {
  // Headless tab activation does not consistently emit OS focus; exercise both
  // supported lifecycle listeners explicitly after the actual tab activation.
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
});
const waitCaptcha = page => page.locator('[data-fixture-widget="captcha"]').waitFor();

export async function testLoginFocusScenarios({ run, origin, password }) {
  await run("standalone login opens home after verification, replaces login history and retains cabinet navigation", async ({ page, calls }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(origin + "/auth/recover");
    await page.locator('main a[href="/auth"]').click();
    await page.getByRole("heading", { name: "Вход", exact: true }).waitFor();
    await waitCaptcha(page);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL(origin + "/");
    await page.getByRole("heading", { name: /Все нужное рядом/ }).waitFor();
    await page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Профиль", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Ваш аккаунт", exact: true }).count(), 0);
    assert.equal(calls.filter(row => row.action === "login").length, 1);
    await page.screenshot({ path: "/tmp/blizhniy-login-home-320.png", fullPage: true });
    await page.goBack();
    await page.waitForURL(origin + "/auth/recover");
    // Revisiting /auth is an explicit account-management action, not a new login.
    await page.goto(origin + "/auth");
    await page.getByText("owner@example.invalid", { exact: true }).waitFor();
    assert.equal(await page.getByText(/права проверяет сервер/).count(), 0);
    await page.locator('main a[href="/cabinet"]').click();
    await page.waitForURL(origin + "/cabinet");
    await page.getByRole("heading", { name: "Синтетический", exact: true }).waitFor();
  });

  await run("anonymous login survives tab activation and repeated lifecycle checks without clearing fields or remounting CAPTCHA", async ({ page, context, calls, state }) => {
    await page.goto(origin + "/auth");await waitCaptcha(page);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    const emailNode = await page.getByLabel("Email", { exact: true }).elementHandle();
    const passwordNode = await page.getByLabel("Пароль", { exact: true }).elementHandle();
    const captchaNode = await page.locator('[data-fixture-widget="captcha"]').elementHandle();
    const gate = deferred(), started = deferred(), pending = [];
    state.override = (route, action) => {
      assert.equal(action, "session", "focus never sends credentials or another account mutation");
      started.resolve();
      const completion = gate.promise.then(() => route.fulfill(anonymous));
      pending.push(completion);return completion;
    };
    try {
      const other = await context.newPage();await other.goto("about:blank");await other.bringToFront();
      await page.bringToFront();await lifecycle(page);await started.promise;await render(page);
      assert.equal(await emailNode.evaluate(node => node.isConnected), true, "background anonymous recheck preserves the actual email control");
      assert.equal(await passwordNode.evaluate(node => node.isConnected), true, "password control is not removed on focus");
      assert.equal(await captchaNode.evaluate(node => node.isConnected), true, "completed CAPTCHA is not remounted by a session recheck");
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), password);
      gate.resolve();await Promise.all(pending);await render(page);
      assert.equal(await page.getByLabel("Email", { exact: true }).evaluate((node, previous) => node === previous, emailNode), true);
      assert.equal(await page.getByLabel("Пароль", { exact: true }).evaluate((node, previous) => node === previous, passwordNode), true);
      assert.equal(await page.locator('[data-fixture-widget="captcha"]').evaluate((node, previous) => node === previous, captchaNode), true);
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), password);
      assert.equal(await page.getByRole("button", { name: "Войти", exact: true }).isEnabled(), true);
      assert.deepEqual(calls, [], "switching tabs cannot submit, logout or reset credentials");
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });

  await run("known invalid login remains visible when focus overlaps the pending login and anonymous session recheck", async ({ page, calls, state }) => {
    const loginGate = deferred(), loginStarted = deferred(), sessionGate = deferred(), sessionStarted = deferred();
    const pending = [];let holdSessions = false;
    state.override = (route, action) => {
      if (action === "session") {
        if (!holdSessions) return route.fulfill(anonymous);
        sessionStarted.resolve();const completion = sessionGate.promise.then(() => route.fulfill(anonymous));
        pending.push(completion);return completion;
      }
      assert.equal(action, "login");loginStarted.resolve();
      const completion = loginGate.promise.then(() => route.fulfill({ status: 401, json: { error: { code: "INVALID_CREDENTIALS" } } }));
      pending.push(completion);return completion;
    };
    try {
      await page.goto(origin + "/auth");await waitCaptcha(page);
      await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();await loginStarted.promise;
      holdSessions = true;await lifecycle(page);loginGate.resolve();
      const alert = page.getByRole("alert").filter({ hasText: "Неверный email или пароль" });
      await alert.waitFor();await sessionStarted.promise;await render(page);
      assert.equal(await alert.isVisible(), true, "a background session check must not erase the definitive login error");
      assert.equal(await page.locator('main a[href="/auth/register#resend"]').first().isVisible(), true);
      sessionGate.resolve();await Promise.all(pending);await render(page);
      assert.equal(await alert.isVisible(), true, "an anonymous session response cannot turn a failed login into an unexplained form refresh");
      assert.equal(page.url(), origin + "/auth", "a rejected login cannot navigate home");
      assert.deepEqual(calls, [{ action: "login", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } }]);
    } finally { loginGate.resolve();sessionGate.resolve();await Promise.allSettled(pending); }
  });

  await run("successful login overlapping focus and visibility changes completes only after the cookie session is verified", async ({ page, calls, state }) => {
    const owner = identity(false), loginGate = deferred(), loginStarted = deferred(), sessionGate = deferred(), sessionStarted = deferred();
    const pending = [];let holdSessions = false;
    state.override = (route, action) => {
      if (action === "session") {
        if (!holdSessions) return route.fulfill(anonymous);
        sessionStarted.resolve();const completion = sessionGate.promise.then(() => route.fulfill({ json: { user: owner } }));
        pending.push(completion);return completion;
      }
      assert.equal(action, "login");loginStarted.resolve();
      const completion = loginGate.promise.then(() => {
        state.active = owner;return route.fulfill({ json: { status: "authenticated", user: owner } });
      });pending.push(completion);return completion;
    };
    try {
      await page.goto(origin + "/auth");await waitCaptcha(page);
      await page.getByLabel("Email", { exact: true }).fill(owner.email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();await loginStarted.promise;
      holdSessions = true;await lifecycle(page);loginGate.resolve();await sessionStarted.promise;await render(page);
      assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0, "unverified login result cannot publish an account identity");
      assert.equal(page.url(), origin + "/auth", "login response alone is not a verified cookie session");
      sessionGate.resolve();await Promise.all(pending);
      await page.waitForURL(origin + "/");
      await page.goto(origin + "/auth");
      await page.getByRole("heading", { name: "Ваш аккаунт", exact: true }).waitFor();
      await page.getByText(owner.email, { exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Личный кабинет", exact: true }).isVisible(), true);
      // Next's route-announcer owns an unrelated role=alert outside main.
      assert.equal(await page.locator("main").getByRole("alert").count(), 0);
      assert.deepEqual(calls, [{ action: "login", body: { email: owner.email, password, captchaToken: "fixture-captcha" } }]);
    } finally { loginGate.resolve();sessionGate.resolve();await Promise.allSettled(pending); }
  });

  await run("session revocation on focus still immediately hides the old identity and returns a blank login form", async ({ page, calls, state }) => {
    const owner = identity(false);state.active = owner;
    await page.goto(origin + "/auth");await page.getByText(owner.email, { exact: true }).waitFor();
    const gate = deferred(), started = deferred(), pending = [];
    state.active = null;
    state.override = (route, action) => {
      assert.equal(action, "session");started.resolve();
      const completion = gate.promise.then(() => route.fulfill(anonymous));pending.push(completion);return completion;
    };
    try {
      await lifecycle(page);await started.promise;await render(page);
      assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0, "private identity is hidden while its authority is unknown");
      assert.equal(await page.getByRole("link", { name: "Личный кабинет", exact: true }).count(), 0);
      gate.resolve();await Promise.all(pending);
      await page.getByLabel("Email", { exact: true }).waitFor();await waitCaptcha(page);
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), "");
      assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0);
      assert.deepEqual(calls, [], "revocation checks cannot automatically log in again");
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });

  await run("late pre-switch session responses cannot restore an old account after a newer focus check confirms another owner", async ({ page, calls, state }) => {
    const first = identity(false), second = identity(true);state.active = first;
    await page.goto(origin + "/auth");await page.getByText(first.email, { exact: true }).waitFor();
    const gate = deferred(), started = deferred(), pending = [];let oldCheck = true;
    state.override = (route, action) => {
      assert.equal(action, "session");
      if (!oldCheck) return route.fulfill({ json: { user: second } });
      started.resolve();const completion = gate.promise.then(() => route.fulfill({ json: { user: first } }));
      pending.push(completion);return completion;
    };
    try {
      await lifecycle(page);await started.promise;await render(page);
      assert.equal(await page.getByText(first.email, { exact: true }).count(), 0);
      state.active = second;oldCheck = false;await lifecycle(page);
      await page.getByText(second.email, { exact: true }).waitFor();
      gate.resolve();await Promise.all(pending);await render(page);
      assert.equal(await page.getByText(second.email, { exact: true }).isVisible(), true);
      assert.equal(await page.getByText(first.email, { exact: true }).count(), 0, "stale checks cannot resurrect the previous identity");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).count(), 0);
      assert.deepEqual(calls, []);
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });

  await run("a rejected login retains email and its error, clears the submitted password and renews the consumed CAPTCHA", async ({ page, calls, state }) => {
    state.override = (route, action) => route.fulfill(action === "session" ? anonymous :
      { status: 401, json: { error: { code: "INVALID_CREDENTIALS" } } });
    await page.goto(origin + "/auth");await waitCaptcha(page);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    const captcha = await page.locator('[data-fixture-widget="captcha"]').elementHandle();
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Неверный email или пароль" }).waitFor();
    await waitCaptcha(page);
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
    assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), "");
    assert.equal(await captcha.evaluate(node => node.isConnected), false, "a submitted CAPTCHA cannot be reused");
    assert.equal(await page.locator('[data-fixture-widget="captcha"]').count(), 1);
    assert.equal(await page.locator('main a[href="/auth/recover"]').isVisible(), true);
    assert.equal(calls.length, 1);
  });

  await run("a successful login response without a matching cookie session never silently returns to a fresh form", async ({ page, calls, state }) => {
    const owner = identity(false);
    state.override = (route, action) => route.fulfill(action === "session" ? anonymous :
      { json: { status: "authenticated", user: owner } });
    await page.goto(origin + "/auth");await waitCaptcha(page);
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Не удалось сохранить сессию входа" }).waitFor();
    assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Личный кабинет", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Пароль", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Проверить сессию", exact: true }).isVisible(), true);
    assert.equal(calls.length, 1, "cookie failure does not automatically retry a credential request");
    assert.equal(page.url(), origin + "/auth", "a missing cookie cannot navigate home");
  });

  await run("a different cookie owner cannot complete standalone login or trigger navigation", async ({ page, calls, state }) => {
    const owner = identity(false), other = identity(true);
    let submitted = false;
    state.override = (route, action) => {
      if (action === "session") return route.fulfill(submitted ? { json: { user: other } } : anonymous);
      assert.equal(action, "login");submitted = true;
      return route.fulfill({ json: { status: "authenticated", user: owner } });
    };
    await page.goto(origin + "/auth");await waitCaptcha(page);
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Не удалось сохранить сессию входа" }).waitFor();
    assert.equal(page.url(), origin + "/auth");
    assert.equal(await page.getByText(other.email, { exact: true }).count(), 0);
    assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0);
    assert.equal(calls.length, 1);
  });

  await run("account screens explain the necessary session cookie with a privacy link and no consent blocker", async ({ page, calls }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/auth", "/auth/register", "/auth/recover", "/auth/reset", "/auth/confirm"]) {
        await page.goto(origin + path);
        const notice = page.locator("main p").filter({ hasText: "Для входа используется защищённый cookie сессии." });
        await notice.waitFor();
        assert.equal(await notice.getByRole("link", { name: "Политика конфиденциальности" }).getAttribute("href"), "/legal/privacy");
        assert.equal(await notice.locator("button, input").count(), 0);
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    assert.deepEqual(calls, [], "reading the notice cannot send credentials or consent writes");
  });

  await run("focus during delayed post-login cookie verification cannot hide an explicit missing-session warning", async ({ page, calls, state }) => {
    const owner = identity(false), gate = deferred(), started = deferred(), pending = [];
    let verifying = false;
    state.override = (route, action) => {
      if (action === "login") {
        verifying = true;return route.fulfill({ json: { status: "authenticated", user: owner } });
      }
      assert.equal(action, "session");
      if (!verifying) return route.fulfill(anonymous);
      started.resolve();const completion = gate.promise.then(() => route.fulfill(anonymous));
      pending.push(completion);return completion;
    };
    try {
      await page.goto(origin + "/auth");await waitCaptcha(page);
      await page.getByLabel("Email", { exact: true }).fill(owner.email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();await started.promise;
      await lifecycle(page);await render(page);
      assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0);
      gate.resolve();await Promise.all(pending);
      const warning = page.getByRole("alert").filter({ hasText: "Не удалось сохранить сессию входа" });
      await warning.waitFor();await lifecycle(page);await render(page);
      assert.equal(await warning.isVisible(), true, "focus cannot erase the failed cookie verification result");
      assert.equal(await page.getByRole("button", { name: "Проверить сессию", exact: true }).isVisible(), true);
      assert.equal(await page.getByRole("link", { name: "Личный кабинет", exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Пароль", { exact: true }).count(), 0);
      assert.deepEqual(calls, [{ action: "login", body: { email: owner.email, password, captchaToken: "fixture-captcha" } }]);
    } finally { gate.resolve();await Promise.allSettled(pending); }
  });

  await run("unknown login commits retain their warning across deferred and later focus checks without retrying credentials", async ({ page, calls, state }) => {
    for (const mode of ["network-abort", "auth-unavailable"]) {
      const gate = deferred(), started = deferred(), pending = [];
      state.override = (route, action) => {
        if (action === "session") return route.fulfill(anonymous);
        assert.equal(action, "login");started.resolve();
        const completion = gate.promise.then(() => mode === "network-abort" ? route.abort() :
          route.fulfill({ status: 503, json: { error: { code: "AUTH_UNAVAILABLE" } } }));
        pending.push(completion);return completion;
      };
      try {
        const before = calls.length;
        await page.goto(origin + "/auth");await waitCaptcha(page);
        await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
        await page.getByLabel("Пароль", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Войти", exact: true }).click();await started.promise;
        await lifecycle(page);gate.resolve();await Promise.all(pending);
        const warning = page.getByRole("alert").filter({ hasText: "успешный вход или выход не подтверждён" });
        await warning.waitFor();await lifecycle(page);await render(page);
        assert.equal(await warning.isVisible(), true, `${mode}: later anonymous checks cannot erase an unknown outcome`);
        assert.equal(await page.getByRole("button", { name: "Проверить сессию", exact: true }).isVisible(), true);
        assert.equal(await page.getByRole("button", { name: "Выйти", exact: true }).isVisible(), true);
        assert.equal(await page.getByRole("link", { name: "Личный кабинет", exact: true }).count(), 0);
        assert.equal(await page.getByLabel("Пароль", { exact: true }).count(), 0);
        assert.equal(page.url(), origin + "/auth", "an unknown login outcome cannot navigate home");
        assert.deepEqual(calls.slice(before), [{ action: "login", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } }],
          "unknown commits require explicit recovery, never an automatic credential retry");
      } finally { gate.resolve();await Promise.allSettled(pending); }
    }
  });

  await run("failed background session reads preserve anonymous controls and CAPTCHA without replacing definitive login errors", async ({ page, calls, state }) => {
    for (const knownInvalid of [false, true]) {
      let failSession = false;const started = deferred(), completed = [];
      state.override = (route, action) => {
        if (action === "login") return route.fulfill({ status: 401, json: { error: { code: "INVALID_CREDENTIALS" } } });
        assert.equal(action, "session");
        if (!failSession) return route.fulfill(anonymous);
        started.resolve();const completion = route.abort();completed.push(completion);return completion;
      };
      const before = calls.length;
      await page.goto(origin + "/auth");await waitCaptcha(page);
      await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      if (knownInvalid) {
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Неверный email или пароль" }).waitFor();await waitCaptcha(page);
        await page.getByLabel("Пароль", { exact: true }).fill(password);
      }
      const emailNode = await page.getByLabel("Email", { exact: true }).elementHandle();
      const passwordNode = await page.getByLabel("Пароль", { exact: true }).elementHandle();
      const captchaNode = await page.locator('[data-fixture-widget="captcha"]').elementHandle();
      failSession = true;await lifecycle(page);await started.promise;await Promise.all(completed);await render(page);
      const warning = page.getByRole("alert").filter({ hasText: knownInvalid ? "Неверный email или пароль" : "Не удалось обновить состояние сессии" });
      await warning.waitFor();
      assert.equal(await emailNode.evaluate(node => node.isConnected), true);
      assert.equal(await passwordNode.evaluate(node => node.isConnected), true);
      assert.equal(await captchaNode.evaluate(node => node.isConnected), true, "a failed background read cannot consume or reset a completed CAPTCHA");
      assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "owner@example.invalid");
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), password);
      assert.equal(await page.getByRole("button", { name: "Войти", exact: true }).isEnabled(), true);
      assert.equal(await page.locator("main").getByRole("alert").count(), 1, "a transport problem does not replace or duplicate a definitive login error");
      assert.deepEqual(calls.slice(before), knownInvalid ? [{ action: "login", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } }] : []);
    }
  });
}
