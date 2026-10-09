import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright';
import { createLocalSupabase } from '../scripts/local-supabase.mjs';

// Explicit opt-in integration test. Never reads dotenv or accepts a remote URL.
// All created accounts, drafts and files are synthetic and removed by exact IDs.
test('real local Auth, PostgREST, Storage and application routes', { timeout: 180_000 }, async t => {
  const stack = createLocalSupabase();
  assert.equal((await stack.status()).ready, true, 'Start the owned local Supabase stack first');
  const credentials = await stack.credentials();
  const { api, site } = stack.config;
  const createdUsers = [];
  const createdDrafts = [];
  const files = [];
  const headers = token => ({ apikey: credentials.ANON_KEY, Authorization: `Bearer ${token ?? credentials.ANON_KEY}` });
  const serviceHeaders = { apikey: credentials.SERVICE_ROLE_KEY, Authorization: `Bearer ${credentials.SERVICE_ROLE_KEY}` };
  const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
  const auth = (path, body) => request(`${api}/auth/v1/${path}`, {
    method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rest = (path, token) => request(`${api}/rest/v1/${path}`, { headers: headers(token) });
  const post = (path, body, token) => request(`${site}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const signUp = async (register = body => auth('signup', body)) => {
    const email = `local-${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}`;
    const response = await register({ email, password, data: { display_name: 'Локальный тест', registration_legal: {
      purpose: 'account_registration', agreement_acceptance_asserted: true, agreement_version: '2026-06-18',
      privacy_review_asserted: true, privacy_version: '2026-06-18',
    } } });
    assert.equal(response.status, 200, 'Local signup must succeed');
    const signup = await response.json();
    assert.match(signup.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    createdUsers.push(signup.id);
    assert.equal(signup.access_token, undefined, 'Confirmation cannot be bypassed');
    const unconfirmed = await auth('token?grant_type=password', { email, password });
    assert.equal((await unconfirmed.json()).error_code, 'email_not_confirmed');
    let message;
    const deadline = performance.now() + 15_000;
    do {
      const inbox = await request(`http://127.0.0.1:54344/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      assert.equal(inbox.status, 200);
      message = (await inbox.json()).messages?.[0];
      if (!message) await new Promise(resolve => setTimeout(resolve, 100));
    } while (!message && performance.now() < deadline);
    assert.ok(message, 'Signup email must be captured by local Mailpit');
    const detail = await (await request(`http://127.0.0.1:54344/api/v1/message/${encodeURIComponent(message.ID)}`)).json();
    const href = detail.HTML.match(/href="([^"]+\/auth\/v1\/verify\?[^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
    assert.ok(href, 'Confirmation email must contain an Auth verification link');
    const verify = new URL(href);
    assert.equal(verify.origin, api);
    assert.equal(verify.pathname, '/auth/v1/verify');
    const confirmed = await request(verify, { redirect: 'manual' });
    assert.equal(confirmed.status, 303);
    assert.equal(new URL(confirmed.headers.get('location')).origin, site);
    const login = await auth('token?grant_type=password', { email, password });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal(session.user.id, signup.id);
    assert.ok(session.access_token);
    return { id: signup.id, token: session.access_token, email, password };
  };
  try {
    let owner, other, mediaPath, draft;
    await t.test('clean reference catalog and tariffs are available through real PostgREST', async () => {
      const response = await rest('categories?select=id');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).length, 105);
      assert.equal((await (await rest('tariffs?select=id')).json()).length, 7);
      assert.equal((await request(`${site}/auth`)).status, 200, 'Start npm run dev:local first');
    });
    await t.test('two real accounts require captured email confirmation and can sign in', async () => {
      owner = await signUp(); other = await signUp();
      const roles = await request(`${api}/rest/v1/user_roles?select=role&user_id=eq.${owner.id}`, { headers: serviceHeaders });
      assert.deepEqual((await roles.json()).map(row => row.role), ['user']);
      const legal = await request(`${api}/rest/v1/registration_legal_events?select=event_type&user_id=eq.${owner.id}`, { headers: serviceHeaders });
      assert.equal((await legal.json()).length, 2);
    });
    await t.test('server uploads a photo to the real bucket and the public image URL serves its bytes', async () => {
      const form = new FormData();
      form.set('folder', 'listings');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEDsAAAAASUVORK5CYII=', 'base64');
      form.append('files', new Blob([png], { type: 'image/png' }), 'synthetic.png');
      const response = await request(`${site}/api/uploads/media`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` }, body: form });
      assert.equal(response.status, 201);
      const uploaded = (await response.json()).files[0];
      mediaPath = uploaded.path; files.push(mediaPath);
      assert.ok(mediaPath.startsWith(`listings/${owner.id}/`));
      assert.equal(new URL(uploaded.publicUrl).origin, api);
      const image = await request(uploaded.publicUrl);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    });
    await t.test('draft with the uploaded photo is stored through the authenticated Next.js route', async () => {
      const response = await post('/api/listings/draft', { title: `Локальная проверка ${randomUUID()}`, kind: 'prodam',
        categorySlug: 'dlya-doma-i-dachi', city: 'Краснодар', phone: '+79995550123', price: '1500',
        description: 'Синтетический черновик локального теста.', mediaPaths: [mediaPath] }, owner.token);
      assert.equal(response.status, 201);
      draft = (await response.json()).listing;
      createdDrafts.push(draft.id);
      assert.equal(draft.status, 'draft');
      const row = await request(`${api}/rest/v1/listings?select=id,status,is_paid&author_id=eq.${owner.id}`, { headers: serviceHeaders });
      assert.equal((await row.json())[0].is_paid, false);
    });
    await t.test('raw contacts/private profiles and client payment writes are denied; foreign media cannot be attached', async () => {
      for (const token of [undefined, owner.token, other.token]) {
        for (const table of ['listings', 'vacancies', 'work_requests', 'cabinet_private_profiles']) {
          const response = await rest(`${table}?select=*`, token);
          assert.equal(response.status, token ? 403 : 401, `Raw ${table} access must be denied`);
          assert.equal((await response.json()).code, '42501');
        }
        const paymentWrite = await request(`${api}/rest/v1/payments`, { method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(paymentWrite.status, token ? 403 : 401);
        assert.equal((await paymentWrite.json()).code, '42501', 'Permission rejection, not a missing-column/constraint error');
        const list = await request(`${api}/storage/v1/object/list/blizhniy-media`, { method: 'POST',
          headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '' }) });
        if (list.ok) assert.deepEqual(await list.json(), []); // Public URL access is not bucket listing permission.
      }
      const response = await post('/api/listings/draft', { title: 'Чужое фото', mediaPaths: [mediaPath] }, other.token);
      assert.equal(response.status, 400);
      const publicDraft = await request(`${site}/obyavlenie/${draft.id}`);
      assert.equal(publicDraft.status, 404);
    });
    await t.test('isolated Chromium: UI signup/login, photo draft, logout and second-account isolation', async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
        const externalOrigins = new Set();
        await context.route('**/*', route => {
          const origin = new URL(route.request().url()).origin;
          if ([site, api].includes(origin)) return route.continue();
          externalOrigins.add(origin);
          return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        await page.goto(`${site}/auth`);
        const uiUser = await signUp(async body => {
          await page.getByLabel('Имя или организация', { exact: false }).fill('Локальный тест');
          await page.getByLabel('Email', { exact: false }).fill(body.email);
          await page.getByLabel('Придумайте пароль', { exact: false }).fill(body.password);
          await page.getByLabel('Повторите пароль', { exact: false }).fill(body.password);
          await page.getByRole('checkbox').nth(0).check();
          await page.getByRole('checkbox').nth(1).check();
          const [response] = await Promise.all([
            page.waitForResponse(r => new URL(r.url()).origin === api && new URL(r.url()).pathname === '/auth/v1/signup'),
            page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click(),
          ]);
          return { status: response.status(), json: () => response.json() };
        });
        const login = async account => {
          await page.goto(`${site}/auth`);
          await page.getByRole('button', { name: 'Вход', exact: true }).click();
          await page.getByLabel('Email', { exact: false }).fill(account.email);
          await page.locator('input[type="password"]').fill(account.password);
          await page.getByRole('button', { name: 'Войти', exact: true }).click();
          await page.waitForURL('**/cabinet');
        };
        await login(uiUser);
        const title = `Браузерный черновик ${randomUUID()}`;
        await page.goto(`${site}/razmestit/obyavlenie?category=dlya-doma-i-dachi&kind=prodam`);
        await page.getByRole('heading', { name: 'Создать объявление', exact: true }).waitFor();
        await page.locator('input[name="title"]').fill(title);
        await page.locator('textarea[name="description"]').fill('Синтетическая проверка через настоящий браузер.');
        await page.locator('input[name="phone"]').fill('+79995550123');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEDsAAAAASUVORK5CYII=', 'base64');
        await page.locator('input[type="file"][name="photos"]').setInputFiles({ name: 'browser.png', mimeType: 'image/png', buffer: png });
        await page.locator('input[name="placementRightsAccepted"]').check();
        const [uploadResponse, draftResponse] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/api/uploads/media'),
          page.waitForResponse(r => new URL(r.url()).pathname === '/api/listings/draft'),
          page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click(),
        ]);
        assert.equal(uploadResponse.status(), 201);
        assert.equal(draftResponse.status(), 201);
        await page.waitForURL('**/cabinet/obyavleniya');
        await page.getByText(title, { exact: true }).waitFor();
        // Navigation can discard Chromium response bodies. Read durable truth
        // from the real Data API, not browser storage or intercepted session data.
        const rows = await (await request(`${api}/rest/v1/listings?select=id,status&author_id=eq.${uiUser.id}&title=eq.${encodeURIComponent(title)}`, { headers: serviceHeaders })).json();
        assert.equal(rows.length, 1);
        createdDrafts.push(rows[0].id);
        assert.equal(rows[0].status, 'draft');
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
        await page.waitForURL('**/auth');
        await login(other);
        const [secondCabinet] = await Promise.all([
          page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/cabinet/listings'),
          page.goto(`${site}/cabinet/obyavleniya`),
        ]);
        assert.equal(secondCabinet.status(), 200);
        assert.deepEqual((await secondCabinet.json()).listings, []);
        await page.getByRole('heading', { name: 'Мои объявления', exact: true }).waitFor();
        assert.equal(await page.getByText(title, { exact: true }).count(), 0);
        assert.deepEqual([...externalOrigins], [], 'The full browser flow must not contact cloud Supabase, Cloudflare or maps');
      } finally { await browser.close(); }
    });
  } finally {
    // Discover this run's exact synthetic records even if the browser navigated
    // before its response body was available. Never clean up pre-existing users.
    for (const userId of createdUsers) {
      const drafts = await request(`${api}/rest/v1/listings?select=id&author_id=eq.${userId}&status=eq.draft&is_paid=eq.false`, { headers: serviceHeaders });
      assert.ok(drafts.ok);
      createdDrafts.push(...(await drafts.json()).map(row => row.id));
      const objects = JSON.parse(await stack.sql(`select coalesce(json_agg(name),'[]') from storage.objects where bucket_id='blizhniy-media' and name like 'listings/${userId}/%';`));
      files.push(...objects);
    }
    for (const id of new Set(createdDrafts)) {
      const deleted = await request(`${api}/rest/v1/listings?id=eq.${id}`, { method: 'DELETE', headers: serviceHeaders });
      assert.ok(deleted.ok, 'Remove only this test’s exact synthetic draft IDs before removing their owner profiles');
    }
    if (files.length) {
      const deleted = await request(`${api}/storage/v1/object/blizhniy-media`, { method: 'DELETE',
        headers: { ...serviceHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [...new Set(files)] }) });
      assert.ok(deleted.ok, 'Clean up only this test’s exact synthetic object paths');
    }
    for (const id of createdUsers) {
      const deleted = await request(`${api}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: serviceHeaders });
      assert.ok(deleted.ok, 'Clean up only this test’s synthetic account IDs');
    }
  }
});
