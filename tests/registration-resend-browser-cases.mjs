import assert from "node:assert/strict";

export async function testRegistrationResendScenarios({ run, origin, password }) {
  const completeRegistration = async (page, candidate, name = "Синтетический") => {
    await page.goto(`${origin}/auth/register`);
    await page.getByLabel("Имя", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByLabel("Пароль", { exact: true }).fill(candidate);
    await page.getByLabel("Повторите пароль", { exact: true }).fill(candidate);
    await page.getByRole("checkbox").nth(0).check();await page.getByRole("checkbox").nth(1).check();
    await page.locator('[data-fixture-sitekey="synthetic-runtime-only-public-site-key"]').waitFor();
  };

  await run("used, expired and malformed confirmation links explain all recovery choices without automatic account writes", async ({ page, calls, state }) => {
    state.override = (route, action) => action === "session"
      ? route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } })
      : route.fulfill({ status: 400, json: { error: { code: "INVALID_CONFIRMATION" } } });
    const content = page.locator("main > section > div");
    for (const scenario of [
      { fragment: `token=${"1".repeat(64)}`, destination: "/auth", heading: "Вход" },
      { fragment: `token=${"2".repeat(64)}`, destination: "/auth/recover", heading: "Восстановление доступа" },
      { fragment: "token=malformed", destination: "/auth/register#resend", heading: "Повторное письмо" },
    ]) {
      const before = calls.length;
      await page.goto(`${origin}/auth/confirm#${scenario.fragment}`);
      if (scenario.fragment !== "token=malformed") {
        await page.getByRole("button", { name: "Подтвердить email", exact: true }).waitFor();
        assert.equal(calls.length, before, "opening a failed confirmation link never consumes it automatically");
        await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
      }
      const alert = content.getByRole("alert");await alert.waitFor();
      const explanation = await alert.textContent();
      assert.match(explanation, /использован/i, "a used link is a possible cause, not automatically an expired link");
      assert.match(explanation, /уже подтвержд/i, "the generic failure explains that email may already be confirmed");
      assert.equal(await content.getByRole("button", { name: "Подтвердить email", exact: true }).count(), 0,
        "a definitively rejected link cannot present another primary confirmation action");
      if (scenario.fragment.startsWith("token=1")) {
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
          assert.ok(dimensions.width <= dimensions.viewport, "confirmation recovery choices fit mobile and desktop");
          await page.screenshot({ path: `/tmp/blizhniy-confirmation-recovery-${width}.png`, fullPage: true });
        }
      }
      for (const href of ["/auth", "/auth/recover", "/auth/register#resend"]) {
        assert.equal(await content.locator(`a[href="${href}"]`).first().isVisible(), true, `confirmation error offers ${href}`);
      }
      const afterConfirmation = calls.length;
      assert.equal(afterConfirmation, before + (scenario.fragment === "token=malformed" ? 0 : 1));
      assert.equal(new URL(page.url()).hash, "", "failed confirmation fragments are removed from the address bar");
      await content.locator(`a[href="${scenario.destination}"]`).first().click();
      await page.getByRole("heading", { name: scenario.heading, exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, scenario.destination.split("#")[0]);
      assert.equal(calls.length, afterConfirmation, "choosing login, recovery or resend never sends credentials automatically");
    }
    assert.deepEqual(calls, [
      { action: "confirm", body: { token: "1".repeat(64) } },
      { action: "confirm", body: { token: "2".repeat(64) } },
    ]);
  });
  await run("duplicate registration and generic resend explain confirmed-account non-delivery without revealing account state", async ({ page, calls, state }) => {
    state.override = (route, action) => action === "session"
      ? route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } })
      : route.fulfill({ status: 202, json: { status: "accepted" } });
    // The same wire response covers an existing confirmed account, pending wrong-password
    // requests and unknown addresses. Browser copy must not infer which case occurred.
    await completeRegistration(page, password);
    await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
    await page.getByRole("heading", { name: "Проверьте почту", exact: true }).waitFor();
    assert.equal(calls.length, 1);assert.equal(calls[0].action, "register");
    await page.getByRole("button", { name: "Повторить письмо", exact: true }).click();
    const content = page.locator("main > section > div");
    let acceptance;
    for (const [index, candidate] of [
      { email: "owner@example.invalid", password },
      { email: "pending@example.invalid", password: "A different synthetic passphrase!" },
      { email: "unknown@example.invalid", password },
    ].entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: "Повторить письмо", exact: true }).click();
      }
      assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), "", "resend always requires the original password again");
      assert.equal(calls.length, index + 1, "changing to resend never submits credentials automatically");
      await page.getByLabel("Email", { exact: true }).fill(candidate.email);
      await page.getByLabel("Пароль", { exact: true }).fill(candidate.password);
      await page.getByRole("button", { name: "Отправить повторное письмо", exact: true }).click();
      await page.getByRole("heading", { name: "Проверьте почту", exact: true }).waitFor();
      const status = await content.getByRole("status").textContent();
      const explanation = await content.textContent();
      assert.match(explanation, /если[^.]*уже подтвержд/i, "accepted resend conditionally explains an already confirmed email");
      assert.match(explanation, /(?:новое|повторное) письмо[^.]*не (?:отправ|прид)/i, "already confirmed accounts are not promised another confirmation email");
      if (index === 0) acceptance = status;
      else assert.equal(status, acceptance, "generic 202 cannot disclose whether the account exists or the original password matched");
      assert.equal(await content.locator('a[href="/auth"]').first().isVisible(), true);
      assert.equal(await content.locator('a[href="/auth/recover"]').first().isVisible(), true);
      assert.equal(await content.locator("form").count(), 0, "accepted resend never asks for more credentials automatically");
      assert.deepEqual(calls.at(-1), { action: "resend", body: { ...candidate, captchaToken: "fixture-captcha" } });
      assert.equal(calls.length, index + 2);
    }
    await content.locator('a[href="/auth/recover"]').first().click();
    await page.getByRole("heading", { name: "Восстановление доступа", exact: true }).waitFor();
    assert.deepEqual(calls.map(call => call.action), ["register", "resend", "resend", "resend"], "recovery navigation does not automatically request a recovery email");
  });
  await run("generic invalid login provides a visible manual password-gated confirmation recovery path", async ({ page, calls, state }) => {
    state.override = (route, action) => action === "session"
      ? route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } })
      : action === "login"
        ? route.fulfill({ status: 401, json: { error: { code: "INVALID_CREDENTIALS" } } })
        : route.fulfill({ status: 202, json: { status: "accepted" } });
    await page.goto(`${origin}/auth`);
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Неверный email или пароль" }).waitFor();
    const resendLink = page.locator('main a[href="/auth/register#resend"]').first();
    assert.equal(await resendLink.isVisible(), true, "unconfirmed or lost-email users can recover from the same generic login failure");
    assert.match(await resendLink.textContent(), /письм|подтвержд/i, "the recovery action explains its email-confirmation purpose");
    assert.deepEqual(calls, [{ action: "login", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } }]);
    await resendLink.click();
    await page.getByRole("heading", { name: "Повторное письмо", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/auth/register");
    assert.equal(await page.getByLabel("Пароль", { exact: true }).inputValue(), "", "failed login credentials are not reused for resend");
    assert.equal(await page.getByLabel("Имя", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.equal(calls.length, 1, "opening the resend path does not perform another account request");
    await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
    await page.getByRole("button", { name: "Отправить повторное письмо", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /8.*128/ }).waitFor();
    assert.equal(calls.length, 1, "resend with no original password is rejected before transport");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Отправить повторное письмо", exact: true }).click();
    await page.getByRole("heading", { name: "Проверьте почту", exact: true }).waitFor();
    assert.deepEqual(calls[1], { action: "resend", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } });
    assert.equal(calls.length, 2, "login recovery sends exactly one explicit resend and no extra login or registration");
  });
}
