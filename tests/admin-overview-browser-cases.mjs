import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

/** Runs against the existing owned, synthetic-auth Next browser fixture; no production network or credentials. */
export async function testAdminOverviewBrowser({context, page, origin}) {
  const actor = '12345678-1234-4321-8765-123456789abc';
  const summary = {users: {total: 23, blocked: 2}, publications: {total: 42, awaitingReview: 7}, tariffs: {total: 8, active: 6}, adMarquee: {total: 3, awaitingReview: 1}};
  const calls = [], legacy = [];
  let role = 'admin', unavailable = false, pending = null, entered;
  const sessionRoute = async route => route.fulfill({json: {user: {id: actor, email: 'overview@example.invalid', role, isBlocked: false}}});
  const adminRoute = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== '/api/admin/overview') {legacy.push(url.pathname); return route.fulfill({status: 503, json: {error: 'Legacy API must not be called'}});}
    calls.push(request.postDataJSON());
    assert.equal(request.method(), 'POST'); assert.equal(request.headers().authorization, undefined);
    assert.equal(request.headers()['x-blizhniy-request'], '1'); assert.deepEqual(request.postDataJSON(), {expectedAdminId: actor});
    if (pending) {entered(); await pending;}
    return route.fulfill(unavailable ? {status: 503, json: {error: {code: 'OVERVIEW_UNAVAILABLE'}}} : {json: summary});
  };
  await context.route('**/api/account/session', sessionRoute);
  await context.route('**/api/admin/**', adminRoute);
  try {
    await page.goto(origin + '/admin', {waitUntil: 'domcontentloaded'});
    const overview = page.getByRole('region', {name: 'Рабочий обзор админки', exact: true});
    await overview.getByText('42', {exact: true}).waitFor();
    assert.equal(await overview.getByText('23', {exact: true}).count(), 1);
    assert.equal(await overview.getByText('6/8', {exact: true}).count(), 1);
    assert.equal(await overview.getByText('7 ожидают модерации', {exact: true}).count(), 1);
    const navigation = page.getByRole('navigation', {name: 'Разделы админки', exact: true});
    assert.equal(await navigation.getByRole('link').count(), 11);
    assert.equal(await navigation.locator('[aria-current="page"]').getAttribute('href'), '/admin');
    unavailable = true;
    await overview.getByRole('button', {name: 'Обновить обзор', exact: true}).click();
    await overview.getByRole('alert').waitFor();
    assert.equal(await overview.locator('dl dd').filter({hasText: /^—$/}).count(), 4);
    assert.equal(await overview.getByText('0', {exact: true}).count(), 0);
    unavailable = false;
    await overview.getByRole('button', {name: 'Обновить обзор', exact: true}).click();
    await overview.getByText('42', {exact: true}).waitFor();
    await page.addScriptTag({path: createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
      const violations = await overview.evaluate(async node => {
        const result = await window.axe.run(node);
        return result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id);
      });
      assert.deepEqual(violations, []);
    }
    await page.screenshot({path: '/tmp/blizhniy-primary-admin-overview.png', fullPage: true});
    let release;
    pending = new Promise(resolve => {release = resolve;});
    const started = new Promise(resolve => {entered = resolve;});
    await overview.getByRole('button', {name: 'Обновить обзор', exact: true}).click();
    await started;
    role = 'user';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText('У этого аккаунта нет роли администратора.', {exact: true}).waitFor();
    release(); pending = null;
    assert.equal(await page.getByRole('region', {name: 'Рабочий обзор админки', exact: true}).count(), 0);
    assert.equal(await page.getByText('42', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('navigation', {name: 'Разделы админки', exact: true}).count(), 0);
    assert.equal(calls.length, 4); assert.deepEqual(legacy, []);
  } finally {
    await context.unroute('**/api/account/session', sessionRoute);
    await context.unroute('**/api/admin/**', adminRoute);
  }
}
