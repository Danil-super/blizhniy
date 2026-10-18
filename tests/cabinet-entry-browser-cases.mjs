import assert from 'node:assert/strict';
import { createDefaultCabinetProfile } from '../src/lib/cabinet-profile.ts';

export async function testCabinetEntryScenarios({ run, origin }) {
  const owner = { id: '12345678-1234-4321-8765-123456789abc', email: 'owner@example.invalid', role: 'user', isBlocked: false };
  await run('ordinary cabinet offers the full listing form without creating an empty draft', async ({ page, state }) => {
    state.active = owner;
    for (const path of ['/cabinet', '/cabinet/obyavleniya']) {
      await page.goto(origin + path);
      await page.getByRole('button', { name: 'Обновить список', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Новый черновик', exact: true }).count(), 0);
      const create = page.locator('main a[href="/razmestit/obyavlenie"]').filter({ hasText: 'Создать объявление' }).first();
      assert.equal(await create.isVisible(), true);
      assert.equal(state.draftRequests.filter(row => row.collection && row.method === 'PUT').length, 0);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: '/tmp/blizhniy-cabinet-create-320.png' });
    await page.locator('main a[href="/razmestit/obyavlenie"]').filter({ hasText: 'Создать объявление' }).first().click();
    await page.waitForURL(origin + '/razmestit/obyavlenie');
    await page.locator('input[name="title"]').waitFor();
    assert.equal(state.draftRequests.filter(row => row.collection && row.method === 'PUT').length, 0,
      'opening a creation form must not store an unnamed listing');
  });
  await run('profile displays the saved registration name and explains unavailable phone verification next to its control', async ({ page, state }) => {
    state.active = owner;
    state.profiles.set(owner.id, { ...createDefaultCabinetProfile({ name: 'Имя регистрации', email: owner.email }), phone: '+7-(999)-000-00-00' });
    await page.goto(origin + '/cabinet');
    await page.getByRole('heading', { name: 'Имя регистрации', exact: true }).waitFor();
    assert.equal(await page.getByText('Ваш профиль', { exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    const phone = page.getByRole('button', { name: 'Подтвердить номер', exact: true });
    assert.equal(await phone.isDisabled(), true);
    assert.equal(await page.locator('#phone-verification-availability').isVisible(), true);
    assert.equal(await phone.getAttribute('aria-describedby'), 'phone-verification-availability');
    assert.equal(await page.getByLabel('Имя', { exact: true }).inputValue(), 'Имя регистрации');
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `profile settings fit ${width}px`);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await phone.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/blizhniy-phone-availability-320.png' });
  });
}
