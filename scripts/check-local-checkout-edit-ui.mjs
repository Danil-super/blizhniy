// Actual Chromium + owned synthetic stand. New fixtures remain for manual review.
// No provider network, real SMTP/Telegram, existing accounts or financial deletions.
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import pg from 'pg';
import sharp from 'sharp';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
import {stateFile, stateDirectory, docker, localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState, validateLocalPrimaryContainer} from './local-primary-config.mjs';

assert.equal(process.argv.length, 2);
const state = readLocalPrimaryState(stateFile, process.cwd()), origin = state.origin;
assert.equal(origin, 'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect', state.containerId]))[0], state);
const directory = join(stateDirectory, 'checkout-edit-ui'); await mkdir(directory, {recursive: true, mode: 0o700});
const headers = {Origin: origin, 'Content-Type': 'application/json', 'X-Blizhniy-Request': '1', 'Sec-Fetch-Site': 'same-origin'};
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}});
const errors = [], external = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external.push(url.origin); return route.abort(); }
  return route.continue();
});
function observe(page) {
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.name));
  page.on('dialog', dialog => dialog.accept());
}
const payment = await context.newPage(), editor = await context.newPage(); observe(payment); observe(editor);
const db = new pg.Client(localPrimaryDatabaseConfig(state, 'owner')); await db.connect();
const email = 'checkout-edit-ui-' + randomUUID() + '@local.invalid', password = 'SyntheticCheckoutEdit-' + randomUUID() + '!';
let owner, id, order;
async function api(path, data, method = 'post', status = 200) {
  const response = await context.request[method](origin + path, {headers, data, maxRedirects: 0});
  assert.equal(response.status(), status, `${method} ${path}`); return response.json();
}
async function snapshot() { return api('/api/account/listing-form', {expectedOwnerId: owner, listingId: id}); }
async function financial() {
  return (await db.query(`select o.id,o.status,o.target_revision::text,i.request_body,
    to_char(f.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as published_at,
    to_char(f.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as expires_at
    from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id
    left join app.payment_fulfillments f on f.intent_id=o.id where o.owner_id=$1 and o.target_id=$2 order by o.id`, [owner, id])).rows;
}
try {
  await api('/api/account/register', {name: 'Проверка оплаты и правок', email, password, captchaToken: '', acceptedAgreement: true,
    acknowledgedPrivacy: true, agreementVersion: legal.agreement, privacyVersion: legal.privacy}, 'post', 202);
  let confirmation; const deadline = Date.now() + 10000;
  while (!confirmation && Date.now() < deadline) {
    for (const name of (await readdir(stateDirectory)).filter(name => /^mail-[a-f0-9-]{36}\.json$/.test(name))) {
      const mail = JSON.parse(await readFile(join(stateDirectory, name), 'utf8'));
      if (mail.to === email) confirmation = mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
    }
    if (!confirmation) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(confirmation, 'Synthetic confirmation must arrive in the local mail capture');
  await api('/api/account/confirm', {token: confirmation});
  await payment.goto(origin + '/auth');
  await payment.getByLabel('Email', {exact: true}).fill(email); await payment.getByLabel('Пароль', {exact: true}).fill(password);
  await payment.getByRole('button', {name: 'Войти', exact: true}).click(); await payment.waitForURL(origin + '/');
  owner = (await api('/api/account/session', {})).user.id;
  const phone = '+7999' + String(randomBytes(4).readUInt32BE() % 10000000).padStart(7, '0');
  await db.query(`insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)
    on conflict(user_id) do update set profile=jsonb_set(app.cabinet_profiles.profile,'{phone}',to_jsonb($3::text))`,
  [owner, JSON.stringify({name: 'Проверка оплаты и правок', phone}), phone]);
  await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)', [owner, phone, 'synthetic-checkout-edit-ui-' + randomUUID()]);
  assert.equal((await db.query('select app.phone_is_confirmed($1) as confirmed', [owner])).rows[0].confirmed, true);
  const image = await sharp({create: {width: 400, height: 300, channels: 3, background: '#237c60'}}).webp().toBuffer();
  const upload = await context.request.post(origin + '/api/account/media', {
    headers: {...headers, 'Content-Type': 'image/webp', 'X-Blizhniy-Owner': owner, 'X-Blizhniy-Intent': randomUUID()}, data: image, maxRedirects: 0,
  });
  assert.equal(upload.status(), 200); const photo = await upload.json();
  const created = await api('/api/account/listing-drafts/collection', {expectedOwnerId: owner, creationKey: randomUUID()}, 'put'); id = created.id;
  const title = 'Проверка оплаты и правок — ' + randomUUID().slice(0, 8), changed = title + ' — исправлено';
  const form = parseListingFormDraft({kind: 'prodam', title, description: 'Синтетическое объявление для проверки двух вкладок и оплаты.', price: '3500',
    categorySlug: 'otdyh', subcategoryName: 'Турбазы', cityName: 'Краснодар', contactPhone: phone, photoIds: [photo.id]});
  const original = await api('/api/account/listing-form', {expectedOwnerId: owner, listingId: id, expectedRevision: created.revision, form}, 'put');
  await editor.goto(origin + `/razmestit/obyavlenie?draft=${id}`);
  await editor.locator('input[name="title"]').waitFor(); assert.equal(await editor.locator('input[name="title"]').inputValue(), title);
  await editor.locator('input[name="title"]').fill(changed);
  await editor.locator('input[name="placementRightsAccepted"]').check();
  const quote = await api('/api/account/listing-checkout', {expectedOwnerId: owner, action: 'testPreview', listingId: id, expectedRevision: original.revision});
  const creationKey = randomUUID();
  order = await api('/api/account/listing-checkout', {expectedOwnerId: owner, creationKey, listingId: id, expectedRevision: original.revision,
    expectedTariffId: quote.tariff.id, expectedAmount: quote.tariff.amount, expectedDurationDays: quote.tariff.durationDays}, 'put');
  const before = await financial(); assert.equal(before.length, 1); assert.equal(before[0].id, order.id);
  await payment.goto(origin + `/oplata/${order.id}`);
  const refusal = editor.waitForResponse(response => response.url() === origin + '/api/account/listing-form' && response.request().method() === 'PUT');
  await editor.getByRole('button', {name: 'Сохранить черновик', exact: true}).click();
  const rejected = await refusal; assert.equal(rejected.status(), 409); assert.deepEqual(await rejected.json(), {error: {code: 'CHECKOUT_ACTIVE'}});
  await editor.getByRole('alert').filter({hasText: 'уже начата оплата'}).waitFor();
  assert.equal(await editor.getByRole('status').filter({hasText: 'Сохраняется снимок формы'}).count(), 0, 'Known checkout refusal must not retain a processing status');
  const resume = editor.getByRole('link', {name: 'К начатой оплате в личном кабинете', exact: true}); await resume.waitFor();
  assert.equal(await resume.getAttribute('href'), '/cabinet/obyavleniya');
  assert.equal(await editor.locator('input[name="title"]').inputValue(), changed, 'The rejected write must preserve the typed local value');
  assert.deepEqual(await snapshot(), original); assert.deepEqual(await financial(), before);
  const recovered = await api('/api/account/listing-checkout', {expectedOwnerId: owner, action: 'intent', creationKey}); assert.equal(recovered.id, order.id);
  assert.equal((await financial()).length, 1, 'Recovery must not create another order');
  await editor.screenshot({path: join(directory, 'checkout-active-desktop.png'), fullPage: true});
  await payment.getByRole('button', {name: 'Открыть локальный симулятор', exact: true}).click();
  await payment.waitForURL(origin + `/__local/payment?intent=${order.id}`);
  await payment.getByRole('heading', {name: 'Локальная симуляция оплаты', exact: true}).waitFor();
  await payment.getByRole('button', {name: 'Подтвердить успешную оплату', exact: true}).click();
  await payment.getByText('Оплата подтверждена сервером, размещение выполнено.', {exact: false}).waitFor();
  const paid = await financial(); assert.equal(paid.length, 1); assert.equal(paid[0].status, 'succeeded'); assert.ok(paid[0].published_at && paid[0].expires_at);
  const placed = await snapshot(); assert.equal(placed.form.title, title); assert.deepEqual(placed.photos, original.photos);
  await editor.reload(); await editor.locator('input[name="title"]').waitFor(); await editor.locator('input[name="title"]').fill(changed);
  await editor.locator('input[name="placementRightsAccepted"]').check();
  const saved = editor.waitForResponse(response => response.url() === origin + '/api/account/listing-form' && response.request().method() === 'PUT');
  await editor.getByRole('button', {name: 'Сохранить изменения', exact: true}).click(); assert.equal((await saved).status(), 200);
  await editor.waitForURL(origin + '/cabinet/obyavleniya');
  const updated = await snapshot(); assert.equal(updated.form.title, changed); assert.equal(BigInt(updated.revision), BigInt(original.revision) + 1n); assert.deepEqual(updated.photos, original.photos);
  assert.deepEqual(await financial(), paid, 'The content edit must preserve the original intent bytes, period and receipt');
  const replay = await context.request.post(origin + `/__local/payment?intent=${order.id}`, {headers: {Origin: origin, 'Sec-Fetch-Site': 'same-origin'}, form: {action: 'succeed'}, maxRedirects: 0});
  assert.equal(replay.status(), 200); assert.deepEqual(await financial(), paid);
  assert.equal((await db.query('select count(*)::integer as n from app.payment_fulfillments where intent_id=$1', [order.id])).rows[0].n, 1);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({status: 'passed', realBrowser: 'Chromium', sameOwnerTabs: 2, actual409: 'CHECKOUT_ACTIVE', typedTitlePreserved: true,
    originalFormAndPhotoPreserved: true, sameIntentRecovered: true, simulatorFulfilledOnce: true, editAfterPayment: true, periodAndReceiptPreserved: true,
    realCharges: false, providerNetwork: false, productionTouched: false, fixtures: 'new synthetic history retained', screenshotDirectory: directory}));
} finally { try { await browser.close(); } finally { await db.end(); } }
