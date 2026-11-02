// Actual local Chromium. Only new synthetic identities/direct paid delivery
// fixtures; no provider, refund execution or deletion of financial history.
import assert from 'node:assert/strict';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {chromium} from 'playwright';
import pg from 'pg';
import {stateFile, stateDirectory, docker, localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState, validateLocalPrimaryContainer} from './local-primary-config.mjs';

assert.equal(process.argv.length, 2);
const state = readLocalPrimaryState(stateFile, process.cwd()), origin = state.origin;
assert.equal(origin, 'https://127.0.0.1:3045');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect', state.containerId]))[0], state);
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const db = new pg.Client(localPrimaryDatabaseConfig(state, 'owner')); await db.connect();
const directory = join(stateDirectory, 'contact-views-ui'); await mkdir(directory, {recursive: true, mode: 0o700});
const source = await readFile(new URL('../database/migrations/0035-application-contact-views.sql', import.meta.url));
const installed = (await db.query("select sha256 from blizhniy_meta.migrations where name='0035-application-contact-views.sql'")).rows[0];
assert.equal(installed?.sha256, createHash('sha256').update(source).digest('hex'), 'Owned stand must already have the reviewed contact-view migration');
const browser = await chromium.launch({headless: true}), errors = [], external = [];
async function account(name) {
  const email = 'contact-view-ui-' + randomUUID() + '@local.invalid', password = 'SyntheticContactViews-' + randomUUID() + '!';
  const id = (await db.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    [email, await load('identity').hashPassword(password)])).rows[0].id;
  const phone = '+7999' + String(randomBytes(4).readUInt32BE() % 10000000).padStart(7, '0');
  await db.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)', [id, JSON.stringify({name, phone})]);
  await db.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)', [id, phone, 'synthetic-contact-views-ui-' + randomUUID()]);
  const context = await browser.newContext({ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.name));
  await page.goto(origin + '/auth'); await page.getByLabel('Email', {exact: true}).fill(email); await page.getByLabel('Пароль', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Войти', exact: true}).click(); await page.waitForURL(origin + '/');
  return {id, email, phone, name, page};
}
const isAction = (response, action, method = 'POST') => response.url() === origin + '/api/account/applications' && response.request().method() === method && response.request().postDataJSON()?.action === action;
let appId, recipient, releaseViewed;
async function evidence() {
  return (await db.query('select evidence,recorded_at::text from app.application_contact_views where application_id=$1 and recipient_id=$2 order by evidence', [appId, recipient.id])).rows;
}
async function open(actor, mode, work) {
  await actor.page.goto(origin + '/cabinet/otkliki');
  if (mode === 'recipient') {
    const listing = actor.page.waitForResponse(response => isAction(response, 'list') && response.request().postDataJSON()?.mode === 'recipient');
    await actor.page.getByRole('button', {name: 'Входящие отклики', exact: true}).click(); assert.equal((await listing).status(), 200);
  }
  const list = actor.page.getByRole('list', {name: mode === 'recipient' ? 'Список входящих откликов' : 'Список своих откликов', exact: true}); await list.waitFor();
  return list.locator('li').filter({has: actor.page.locator(`a[href="/rabota/zakazy/${work}"]`)});
}
try {
  recipient = await account('Заказчик проверки контактов'); const applicant = await account('Мастер проверки контактов');
  const form = load('work-publication-contract').parseWorkPublicationForm('workRequest', {kind: 'workRequest', title: 'Синтетическая проверка просмотра контактов',
    description: 'Нужно заменить смеситель и проверить соединения.', cityName: 'Краснодар', professionName: 'Сантехник', budget: '3500.00', contactPhone: recipient.phone, placementRightConfirmed: true});
  const work = (await db.query(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,created_at,published_at,expires_at)
    select $1,'workRequest',$2,$3::jsonb,c.id,p.id,'published',true,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days'
    from app.cities c cross join app.specialist_categories p where c.name='Краснодар' and p.name='Сантехник' limit 1 returning id`, [recipient.id, randomUUID(), JSON.stringify(form)])).rows[0].id;
  const profile = {name: applicant.name, profession: 'Сантехник', price: '3500.00', skills: 'Ремонт и монтаж сантехники', about: 'Соблюдаю сроки и договорённости.',
    phone: applicant.phone, email: applicant.email, messengerUrl: null};
  appId = (await db.query(`insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,message,status,is_paid,sent_at,created_at)
    values($1,$2,$3,1,1,$4::jsonb,'Синтетический оплаченный отклик для проверки показа контактов.','sent',true,clock_timestamp(),clock_timestamp()-interval '1 minute') returning id`,
    [applicant.id, work, randomUUID(), JSON.stringify(profile)])).rows[0].id;
  assert.deepEqual(await evidence(), []);

  const own = await open(applicant, 'applicant', work), ownRead = applicant.page.waitForResponse(response => isAction(response, 'read'));
  await own.getByRole('button', {name: 'Подробнее', exact: true}).click(); assert.equal((await ownRead).status(), 200);
  await applicant.page.getByRole('region', {name: 'Детали отклика', exact: true}).waitFor(); assert.deepEqual(await evidence(), []);

  const incoming = await open(recipient, 'recipient', work); assert.equal(await incoming.count(), 1); assert.deepEqual(await evidence(), [], 'Incoming summaries must not count as contact views');
  // Delay, never fake, the legacy auto-viewed request so its SQL trigger cannot
  // mask a missing detail-read journal insert in the browser acceptance proof.
  const viewedBarrier = new Promise(resolve => { releaseViewed = resolve; });
  await recipient.page.route(origin + '/api/account/applications', async route => {
    const request = route.request(), body = request.postDataJSON();
    if (request.method() === 'PUT' && body?.action === 'decide' && body.state === 'viewed') await viewedBarrier;
    return route.continue();
  });
  const detailRead = recipient.page.waitForResponse(response => isAction(response, 'read'));
  await incoming.getByRole('button', {name: 'Подробнее', exact: true}).click(); const read = await detailRead;
  assert.equal(read.status(), 200); assert.equal((await read.json()).snapshot.phone, applicant.phone);
  const detail = recipient.page.getByRole('region', {name: 'Детали отклика', exact: true}); await detail.waitFor();
  await detail.locator(`a[href="tel:${applicant.phone}"]`).waitFor();
  const emailLink = detail.getByRole('link', {name: applicant.email, exact: true}); await emailLink.waitFor();
  assert.equal(decodeURIComponent(await emailLink.getAttribute('href')), 'mailto:' + applicant.email);
  const first = await evidence(); assert.equal(first.length, 1); assert.equal(first[0].evidence, 'recipient_read');
  releaseViewed();
  await detail.getByRole('button', {name: 'Закрыть детали', exact: true}).click();
  await incoming.getByRole('button', {name: 'Подробнее', exact: true}).click(); await detail.waitFor();
  await detail.getByRole('button', {name: 'Отклонить отклик', exact: true}).waitFor(); assert.deepEqual(await evidence(), first);
  await recipient.page.screenshot({path: join(directory, 'recipient-contact-detail.png'), fullPage: true});
  await detail.getByRole('button', {name: 'Отклонить отклик', exact: true}).click();
  const rejected = recipient.page.waitForResponse(response => isAction(response, 'decide', 'PUT') && response.request().postDataJSON()?.state === 'rejected');
  await detail.getByRole('group', {name: 'Подтверждение решения', exact: true}).getByRole('button', {name: 'Подтвердить отказ', exact: true}).click();
  const result = await rejected; assert.equal(result.status(), 200); assert.equal((await result.json()).status, 'rejected');
  await detail.getByText('Отклонён', {exact: true}).waitFor(); assert.deepEqual(await evidence(), first);
  assert.equal((await db.query('select status from app.applications where id=$1 and applicant_id=$2', [appId, applicant.id])).rows[0].status, 'rejected');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({status: 'passed', realBrowser: 'Chromium', applicantDetailsNotRecipientView: true, incomingListNotView: true,
    actualDetailAPIRead: true, clickablePhoneAndEmail: true, oneDurableRecipientView: true, closeReopenPreservesFirstDate: true, rejectPreservesEvidence: true,
    providerNetwork: false, productionTouched: false, realCharges: false, fixtures: 'new synthetic direct paid/sent application retained', screenshotDirectory: directory}));
} finally { releaseViewed?.(); try { await browser.close(); } finally { await db.end(); } }
