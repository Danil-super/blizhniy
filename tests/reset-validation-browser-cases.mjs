import assert from 'node:assert/strict';

// Synthetic fragment and owned API/provider fixtures only; no live reset link,
// account, mail, cookie or browser storage is read by these scenarios.
const token = 'c'.repeat(64);
const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const passwordInput = page => page.getByLabel('Новый пароль', { exact: true });
const repeatInput = page => page.getByLabel('Повторите пароль', { exact: true });
const save = page => page.getByRole('button', { name: 'Сохранить новый пароль', exact: true });
const retry = page => page.getByRole('button', { name: 'Повторить проверку', exact: true });
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function enterPendingReset(page, origin) {
  await page.route(scriptUrl, route => route.fulfill({
    contentType: 'application/javascript',
    body: `let sequence = 0; const widgets = new Map(); window.__fixtureResetRenders = 0;
      window.turnstile = {
        render(container, options) {
          window.__fixtureResetRenders++;
          const frame = document.createElement('div'); frame.dataset.fixtureWidget = 'captcha';
          frame.style.width = '300px'; frame.style.height = '65px';
          container.appendChild(frame);
          if (window.__fixtureResetRenders > 1) queueMicrotask(() => options.callback('fixture-captcha'));
          const id = 'fixture-reset-widget-' + ++sequence; widgets.set(id, container); return id;
        }, remove(id) { widgets.get(id)?.replaceChildren(); widgets.delete(id); }
      };`,
  }));
  await page.goto(`${origin}/auth/reset#token=${token}`);
  await passwordInput(page).waitFor();
  await page.locator('[data-fixture-widget="captcha"]').waitFor();
  assert.equal(new URL(page.url()).hash, '', 'the synthetic recovery fragment is removed from the address bar');
}

async function assertFieldError(field, expected) {
  assert.equal(await field.getAttribute('aria-invalid'), 'true', 'the invalid field exposes its own error state');
  const associated = await field.evaluate(input => {
    const ids = `${input.getAttribute('aria-describedby') ?? ''} ${input.getAttribute('aria-errormessage') ?? ''}`.trim().split(/\s+/);
    return ids.map(id => document.getElementById(id)).filter(element => element && element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden' && element.getAttribute('aria-hidden') !== 'true')
      .map(element => element.textContent).join(' ');
  });
  if (typeof expected === 'string') assert.ok(associated.includes(expected), 'the visible field error is programmatically associated');
  else assert.match(associated, expected, 'the visible field error explains the violated password rule');
}

async function assertFieldCorrected(field) {
  assert.notEqual(await field.getAttribute('aria-invalid'), 'true', 'correcting a field removes its stale invalid state');
}

export async function testResetValidationScenarios({ run, origin, password }) {
  await run('a stalled reset CAPTCHA has a bounded wait and keeps the retry action inside the mobile form', async ({ page, calls }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.clock.install();
    await enterPendingReset(page, origin);
    await passwordInput(page).fill(password);
    await repeatInput(page).fill(password);
    await page.clock.fastForward(31000);
    await page.getByRole('alert').filter({ hasText: 'Проверка не завершена' }).waitFor();
    assert.equal(await save(page).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await retry(page).scrollIntoViewIfNeeded();
    const box = await retry(page).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320, 'retry stays on screen rather than beside the provider frame');
    await page.screenshot({ path: '/tmp/blizhniy-reset-pending-320.png', fullPage: true });
    assert.deepEqual(calls, [], 'a timeout never submits the password');
    await retry(page).click();
    await page.waitForFunction(() => document.querySelector('input[name="captchaToken"]')?.value === 'fixture-captcha');
    assert.equal(await save(page).isEnabled(), true);
    assert.equal(await passwordInput(page).inputValue(), password);
    assert.equal(await repeatInput(page).inputValue(), password);
  });
  await run('a blank pending reset CAPTCHA explains the disabled save action and offers a manual retry preserving both passwords', async ({ page, calls }) => {
    await enterPendingReset(page, origin);
    await passwordInput(page).fill(password);
    await repeatInput(page).fill(password);
    await repeatInput(page).blur();
    const form = page.locator('main form');
    const reason = form.getByText(/проверк[а-яё]* безопасности/i).first();
    await reason.waitFor();
    assert.equal(await reason.isVisible(), true, 'a blank provider cannot silently disable saving');
    assert.equal(await save(page).isDisabled(), true);
    await retry(page).waitFor();
    await render(page);
    assert.equal(await page.evaluate(() => window.__fixtureResetRenders), 1, 'pending CAPTCHA does not automatically loop renders');
    assert.deepEqual(calls, [], 'opening the link and entering valid passwords never consumes it');

    await retry(page).click();
    await page.waitForFunction(() => document.querySelector('input[name="captchaToken"]')?.value === 'fixture-captcha');
    assert.equal(await page.evaluate(() => window.__fixtureResetRenders), 2);
    assert.equal(await passwordInput(page).inputValue(), password);
    assert.equal(await repeatInput(page).inputValue(), password);
    assert.equal(await save(page).isEnabled(), true);
    assert.deepEqual(calls, [], 'retrying the provider does not submit or consume the reset token');
    await save(page).click();
    await page.getByRole('status').filter({ hasText: 'Пароль изменён.' }).waitFor();
    assert.deepEqual(calls, [{ action: 'reset', body: { token, password, captchaToken: 'fixture-captcha' } }]);
  });

  await run('reset password rules and mismatch are visible on blur while CAPTCHA is pending and clear as fields become valid', async ({ page, calls }) => {
    await enterPendingReset(page, origin);
    const first = passwordInput(page), repeat = repeatInput(page);
    assert.doesNotMatch(await page.locator('main').innerText(), /Надёжнее|Пробелы сохраняются/,
      'reset helper copy contains the actionable password rule');

    for (const [candidate, message] of [
      ['short', 'Не менее 8 символов.'],
      [' '.repeat(12), /парол|пробел|символ/i],
      ['Ж'.repeat(129), /128/],
    ]) {
      await first.fill(candidate);
      await repeat.fill(candidate);
      await first.focus();
      await first.blur();
      await render(page);
      await assertFieldError(first, message);
      assert.equal(await first.inputValue(), candidate, 'validation never normalizes the password');
      assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(calls, [], 'invalid passwords are explained before any CAPTCHA or reset request');
      await first.fill(password);
      await render(page);
      await assertFieldCorrected(first);
    }

    await repeat.fill(password + 'different');
    await repeat.blur();
    await render(page);
    await assertFieldError(repeat, 'Пароли не совпадают.');
    await assertFieldCorrected(first);
    assert.deepEqual(calls, [], 'a mismatch is local and does not consume the recovery link');
    await repeat.fill(password);
    await render(page);
    await assertFieldCorrected(repeat);
    assert.equal(await save(page).isDisabled(), true, 'valid fields still require the pending security check');

    await retry(page).click();
    await page.waitForFunction(() => document.querySelector('input[name="captchaToken"]')?.value === 'fixture-captcha');
    await repeat.fill(password + 'different');
    await repeat.blur();
    await page.locator('main form').evaluate(form => form.requestSubmit());
    await render(page);
    await assertFieldError(repeat, 'Пароли не совпадают.');
    assert.deepEqual(calls, [], 'a valid CAPTCHA cannot submit mismatched passwords');
    await repeat.fill(password);
    await render(page);
    await assertFieldCorrected(repeat);
    await save(page).click();
    await page.getByRole('status').filter({ hasText: 'Пароль изменён.' }).waitFor();
    assert.deepEqual(calls, [{ action: 'reset', body: { token, password, captchaToken: 'fixture-captcha' } }]);
  });

  await run('a remembered human-proof UI hint avoids repeated reset CAPTCHA and preserves the exact password with an empty CAPTCHA token', async ({ page, calls }) => {
    await enterPendingReset(page, origin);
    await passwordInput(page).fill(password);
    await repeatInput(page).fill(password);
    // This expiry notification is only the existing UI hint; all HTTP responses
    // remain owned transport fixtures and it grants no server-side authority.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('blizhniy-human-proof', {
      detail: { expiresAt: Date.now() + 899000 },
    })));
    await page.locator('[data-fixture-widget="captcha"]').waitFor({ state: 'detached' });
    await render(page);
    assert.equal(await page.evaluate(() => window.__fixtureResetRenders), 1, 'a remembered proof does not repeat the provider challenge');
    assert.equal(await passwordInput(page).inputValue(), password);
    assert.equal(await repeatInput(page).inputValue(), password);
    assert.equal(await save(page).isEnabled(), true);
    assert.deepEqual(calls, [], 'the expiry hint never sends an account request');
    await save(page).click();
    await page.getByRole('status').filter({ hasText: 'Пароль изменён.' }).waitFor();
    assert.deepEqual(calls, [{ action: 'reset', body: { token, password, captchaToken: '' } }]);
  });
}
