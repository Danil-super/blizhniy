import assert from 'node:assert/strict';

// Owned local API and CAPTCHA transports only. No real account, cookie, provider,
// browser storage or mail is inspected by these scenarios.
const anonymous = { status: 401, json: { error: { code: 'UNAUTHENTICATED' } } };
const invalidLogin = { status: 401, json: { error: { code: 'INVALID_CREDENTIALS' } } };
const widget = page => page.locator('[data-fixture-widget="captcha"]');
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const proofHeader = expires => ({ 'X-Blizhniy-Human-Proof': String(expires) });
const email = 'owner@example.invalid';

async function enterLogin(page, origin, password) {
  await page.goto(origin + '/auth');
  await widget(page).waitFor();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
}

export async function testRememberedCaptchaScenarios({ run, origin, password }) {
  await run('human proof removes repeated CAPTCHA across failed login and a Next Link to recovery; server rejection restores the widget', async ({ page, calls, state }) => {
    let expiry;
    state.override = (route, action) => {
      if (action === 'session') return route.fulfill(anonymous);
      if (action === 'login') {
        expiry ??= Date.now() + 900000;
        return route.fulfill({ ...invalidLogin, headers: proofHeader(expiry) });
      }
      assert.equal(action, 'recover');
      return route.fulfill({ status: 403, headers: proofHeader(0), json: { error: { code: 'CAPTCHA_REQUIRED' } } });
    };
    await enterLogin(page, origin, password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Неверный email или пароль' });
    await error.waitFor();
    await widget(page).waitFor({ state: 'detached' });
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), '');
    assert.equal(await error.isVisible(), true);

    await page.getByLabel('Пароль', { exact: true }).fill(password);
    const secondLogin = page.waitForResponse(response => new URL(response.url()).pathname === '/api/account/login');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await secondLogin;await render(page);
    assert.equal(await widget(page).count(), 0);
    assert.equal(await error.isVisible(), true);
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.deepEqual(calls, [
      { action: 'login', body: { email, password, captchaToken: 'fixture-captcha' } },
      { action: 'login', body: { email, password, captchaToken: '' } },
    ]);

    await page.locator('main a[href="/auth/recover"]').click();
    await page.getByRole('heading', { name: 'Восстановление доступа', exact: true }).waitFor();
    assert.equal(await widget(page).count(), 0, 'client navigation retains the unexpired proof hint');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Отправить письмо восстановления', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Повторите проверку безопасности' }).waitFor();
    await widget(page).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.deepEqual(calls[2], { action: 'recover', body: { email, captchaToken: '' } });
    assert.equal(calls.length, 3, 'proof rejection cannot automatically send another recovery request');
  });

  await run('proof expires after its original short deadline despite ordinary focus checks, preserving typed fields and login error', async ({ page, calls, state }) => {
    let expiry;
    state.override = (route, action) => {
      if (action === 'session') return route.fulfill(anonymous);
      assert.equal(action, 'login');
      expiry = Date.now() + 500;
      return route.fulfill({ ...invalidLogin, headers: proofHeader(expiry) });
    };
    await enterLogin(page, origin, password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Неверный email или пароль' });
    await error.waitFor();await widget(page).waitFor({ state: 'detached' });
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    const emailNode = await page.getByLabel('Email', { exact: true }).elementHandle();
    const passwordNode = await page.getByLabel('Пароль', { exact: true }).elementHandle();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await render(page);
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), password);
    assert.equal(await error.isVisible(), true);
    await page.waitForFunction(deadline => Date.now() >= deadline, expiry);
    await widget(page).waitFor({ timeout: 2000 });
    assert.equal(await emailNode.evaluate(node => node.isConnected), true);
    assert.equal(await passwordNode.evaluate(node => node.isConnected), true);
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), password);
    assert.equal(await error.isVisible(), true);
    assert.deepEqual(calls, [{ action: 'login', body: { email, password, captchaToken: 'fixture-captcha' } }]);
  });

  await run('a CAPTCHA provider error exposes one explicit retry without a render loop or credential submission', async ({ page, calls }) => {
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
      contentType: 'application/javascript',
      body: `let sequence = 0; const widgets = new Map(); window.__fixtureCaptchaRenders = 0;
        window.turnstile = {
          render(container, options) {
            window.__fixtureCaptchaRenders++;
            const frame = document.createElement('div'); frame.dataset.fixtureWidget = 'captcha';
            const button = document.createElement('button'); button.type = 'button';
            button.textContent = 'Fixture: CAPTCHA error';
            button.onclick = () => options['error-callback'](); frame.appendChild(button);container.appendChild(frame);
            queueMicrotask(() => options.callback('fixture-captcha'));
            const id = 'fixture-error-widget-' + ++sequence;widgets.set(id, container);return id;
          }, remove(id) { widgets.get(id)?.replaceChildren();widgets.delete(id); }
        };`,
    }));
    await enterLogin(page, origin, password);
    await page.getByRole('button', { name: 'Fixture: CAPTCHA error', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Повторить проверку', exact: true });
    await retry.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Войти', exact: true }).isDisabled(), true);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__fixtureCaptchaRenders), 1, 'provider failure does not start an automatic render loop');
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), email);
    assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), password);
    await retry.click();
    await page.waitForFunction(() => window.__fixtureCaptchaRenders === 2);
    await page.waitForFunction(() => Boolean(document.querySelector('input[name="captchaToken"]')?.value));
    assert.equal(await page.getByRole('button', { name: 'Войти', exact: true }).isEnabled(), true);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__fixtureCaptchaRenders), 2);
    assert.deepEqual(calls, [], 'retrying the CAPTCHA cannot submit credentials');
  });
}
