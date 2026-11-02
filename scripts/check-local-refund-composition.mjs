// Full schema composition in an owned, disposable PG18.6 container only.
// Synthetic SQL owner fixtures; real stores/worker; provider GET is an in-process stub.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import pg from 'pg';
import {bootstrapPostgres, getBootstrapPlan} from './bootstrap-postgres.mjs';
import {getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {getLocalTelegramMigrations, withoutTransaction} from './local-telegram-migrations.mjs';
import {getLocalDeletionMigrations} from './local-deletion-schema.mjs';
import {getLocalCheckoutEditMigrations} from './local-checkout-edit-schema.mjs';
import {getLocalApplicationContactMigrations} from './local-application-contact-schema.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {PostgresPaymentIntentStore} = load('postgres-payment-intents');
const {PostgresPlacementRefundReservationStore} = load('postgres-placement-refund-reservations');
const {PostgresRefundRequestStore} = load('postgres-refund-requests');
const {PostgresListingPaymentFulfillmentStore} = load('postgres-listing-payment-fulfillment');
const {PostgresPaymentReconciliationQueue} = load('postgres-payment-reconciliation');
const {createPaymentReconciliationWorker} = load('payment-reconciliation-worker');
const {parseWorkPublicationForm} = load('work-publication-contract');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-composition-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-composition-fixture';
const password = randomBytes(24).toString('hex'), merchant = {shopId: 'composition-fixture', isTest: true, secretKey: 'test_synthetic_only'};
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
let container, admin, config, db, checks = 0, phoneSequence = 0, failure;
const clients = new Set(), pools = new Set(), pending = new Set(), transactions = new Set();
const fixtureEnvironment = {BLIZHNIY_LISTING_WORKFLOW: 'postmoderation', BLIZHNIY_LOCAL_PRIMARY: 'enabled', BLIZHNIY_LOCAL_PRIMARY_ORIGIN: 'https://127.0.0.1:14431'};
const previousEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));
Object.assign(process.env, fixtureEnvironment);
async function connection(role = 'postgres') { const c = new pg.Client({...config, user: role}); await c.connect(); clients.add(c); return c; }
function database(role = 'composition_finance') { const d = new PostgresDatabase(new pg.Pool({...config, user: role, max: 5})); pools.add(d); return d; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
function observe(work) { const p = Promise.resolve(work).then(value => ({value}), error => ({error})); pending.add(p); p.then(() => pending.delete(p)); return p; }
function unwrap(result) { if (Object.hasOwn(result, 'error')) throw result.error; return result.value; }
function txDatabase(client) { return {transaction: async work => { await client.query('begin'); try { const value = await work(client); await client.query('commit'); return value; } catch (error) { await client.query('rollback'); throw error; } }}; }
async function begin(client) { await client.query('begin'); transactions.add(client); }
async function commit(client) { await client.query('commit'); transactions.delete(client); }
async function blocked(pid) { const deadline = Date.now() + 4000; for (;;) { if ((await admin.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return; assert.ok(Date.now() < deadline, 'Expected observed PostgreSQL lock barrier'); await new Promise(resolve => setTimeout(resolve, 15)); } }
async function confirm(item, client = admin) {
  // Same owner-first order as the authenticated confirmation flow; SQL fixtures
  // remain owner-only and do not contact Telegram or fabricate runtime authority.
  await client.query('select id from app.users where id=$1 for update', [item.ownerId]);
  await client.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)', [item.ownerId, item.phone, 'synthetic-composition-' + randomUUID()]);
}
async function fixture({kind = 'listing', confirmed = true, orderStatus = 'succeeded', old = false} = {}) {
  const ownerId = (await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    ['composition-' + randomUUID() + '@example.invalid', `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  const phone = '+7999' + String(++phoneSequence).padStart(7, '0');
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)', [ownerId, JSON.stringify({name: 'Синтетический владелец', phone})]);
  if (confirmed) await confirm({ownerId, phone});
  let targetId;
  if (kind === 'listing') {
    targetId = (await admin.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at)
      select $1,'sell',c.id,city.id,'Синтетическая публикация','Полное синтетическое описание для композиционной проверки.',$2,clock_timestamp()-interval '42 days'
      from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id`, [ownerId, phone])).rows[0].id;
    await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())", [targetId]);
  } else {
    const profession = (await admin.query("select id,name from app.specialist_categories where name='Сантехник' and active limit 1")).rows[0];
    assert.ok(profession);
    const form = parseWorkPublicationForm(kind, {kind, title: 'Синтетическая работа', description: 'Полное синтетическое описание работы для композиционной проверки.',
      cityName: 'Краснодар', professionName: profession.name, professionId: profession.id, contactPhone: phone, placementRightConfirmed: true,
      ...(kind === 'vacancy' ? {salary: '1000.00', employerType: 'person', organization: 'Иван Иванов'} : {budget: '1000.00'})});
    targetId = (await admin.query(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,created_at)
      select $1,$2,$3,$4::jsonb,id,$5,clock_timestamp()-interval '42 days' from app.cities where name='Краснодар' returning id`,
      [ownerId, kind, randomUUID(), JSON.stringify(form), profession.id])).rows[0].id;
  }
  const id = randomUUID(), providerPaymentId = randomUUID();
  const binding = {id, ownerId, targetType: kind, targetId, targetRevision: '1', tariffId: kind === 'listing' ? 'listing-publication' : kind === 'vacancy' ? 'vacancy-publication' : 'work-request-publication', amount: '199.00', durationDays: 30, shopId: merchant.shopId, isTest: true};
  const metadata = {localPaymentId: id, targetId, targetType: kind, tariffId: binding.tariffId};
  const requestBody = JSON.stringify({amount: {value: binding.amount, currency: 'RUB'}, capture: true, confirmation: {type: 'redirect', return_url: 'https://fixture.example.invalid/return'}, metadata});
  await txDatabase(admin).transaction(async tx => {
    await new PostgresPaymentIntentStore(txDatabase(admin)).persistInTransaction(tx, {...binding, requestBody});
    await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)', [id, ownerId, randomUUID(), kind, targetId]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)', [id]);
    await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)', [id, providerPaymentId]);
  });
  const capturedAt = (await admin.query(`select to_char((clock_timestamp()-case when $1 then interval '40 days' else interval '2 hours' end) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`, [old])).rows[0].value;
  if (orderStatus === 'succeeded') {
    await admin.query("update app.payment_orders set status='succeeded' where id=$1", [id]);
    await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)", [id, providerPaymentId, capturedAt]);
  }
  return {...binding, providerPaymentId, phone, capturedAt, requestBody, metadata};
}
function fulfillment(kind, storage = db) { return new PostgresListingPaymentFulfillmentStore(storage, merchant, {postmoderation: true, ...(kind === 'listing' ? {} : {targetType: kind})}); }
async function target(item) { return (await admin.query('select status,is_paid,published_at,expires_at from app.' + (item.targetType === 'listing' ? 'listings' : 'work_publications') + ' where id=$1', [item.targetId])).rows[0]; }
async function receipts(id) { return (await admin.query('select intent_id,published_at,expires_at,fulfilled_at from app.payment_fulfillments where intent_id=$1', [id])).rows; }
async function financial(item) { return (await admin.query(`select i.request_body,i.request_sha256,i.amount::text,o.status,v.status as verified,v.captured_at from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id left join app.payment_verifications v on v.intent_id=i.id where i.id=$1`, [item.id])).rows[0]; }
async function job(id) { return (await admin.query('select state,last_code,attempts from app.payment_reconciliation_jobs where intent_id=$1', [id])).rows[0]; }
async function assertDraft(item) { assert.deepEqual(await target(item), {status: 'draft', is_paid: false, published_at: null, expires_at: null}); assert.deepEqual(await receipts(item.id), []); }
const reserve = item => new PostgresPlacementRefundReservationStore(db, merchant).reserve(item.id, randomUUID());
async function prepareWindow(item) { const reservation = await reserve(item), store = new PostgresRefundRequestStore(db, merchant), prepared = await store.prepare(reservation.id), window = await store.openWindow(reservation.id); assert.deepEqual(window.request, prepared); assert.ok(window.remainingMs > 0); assert.equal(prepared.paymentIntentId, item.id); assert.equal(prepared.amount, item.amount); assert.equal(prepared.requestBody, JSON.stringify({payment_id: item.providerPaymentId, amount: {value: item.amount, currency: 'RUB'}, metadata: {localRefundId: reservation.id, localPaymentId: item.id}})); return reservation; }
function provider(item) {
  let calls = 0;
  return {get calls() { return calls; }, fetch: async (input, init) => {
    assert.equal(String(input), 'https://api.yookassa.ru/v3/payments/' + item.providerPaymentId); assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    calls++;
    return Response.json({id: item.providerPaymentId, amount: {value: item.amount, currency: 'RUB'}, paid: true, status: 'succeeded', test: true, recipient: {account_id: merchant.shopId}, captured_at: item.capturedAt, metadata: item.metadata});
  }};
}
async function enqueue(item) { assert.equal(await new PostgresPaymentReconciliationQueue(db, merchant).enqueue(item.providerPaymentId), true); }
try {
  container = await docker(['run', '--detach', '--pull', 'never', '--name', name, '--label', `${label}=${name}`, '--memory', '512m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql:rw,size=268435456', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=blizhniy_test', image]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const info = JSON.parse(await docker(['inspect', container]))[0], port = info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(info.Config.Labels[label], name); assert.equal(info.Config.Image, image); assert.equal(port.HostIp, '127.0.0.1');
  config = {host: '127.0.0.1', port: Number(port.HostPort), database: 'blizhniy_test', user: 'postgres', password, statement_timeout: 10000};
  const deadline = Date.now() + 20000;
  for (;;) { try { await docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', config.database]); break; } catch { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 100)); } }
  admin = await connection(); assert.match((await admin.query('show server_version')).rows[0].server_version, /^18\.6/);
  const extras = [...await getLocalPrimaryExtraMigrations(), ...await getLocalTelegramMigrations(), ...await getLocalDeletionMigrations(), ...await getLocalCheckoutEditMigrations(), ...await getLocalApplicationContactMigrations()];
  for (const name of ['0036-placement-refund-reservations.sql', '0037-refund-requests.sql']) { const source = await readFile(new URL('../database/migrations/' + name, import.meta.url), 'utf8'); extras.push({name, source, sha256: createHash('sha256').update(source).digest('hex')}); }
  await bootstrapPostgres(admin, '127.0.0.1:blizhniy_test', {includeListingContactMethod: true});
  await txDatabase(admin).transaction(async tx => { for (const migration of extras) { await tx.query(withoutTransaction(migration.source)); await tx.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)', [migration.name, migration.sha256]); } });
  await check('all migrations 0001–0037 installed with exact repository hashes and no public journal grants', async () => {
    const expected = [...getBootstrapPlan({includeListingContactMethod: true}), ...extras].map(({name, sha256}) => ({name, sha256}));
    assert.equal(expected.length, 37); assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows, expected);
    const leak = (await admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname in ('app','blizhniy_meta') and a.grantee=0 and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`)).rows;
    assert.deepEqual(leak, []);
    assert.equal((await admin.query('select count(*)::integer as n from app.users')).rows[0].n, 0);
  });
  await admin.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    create role composition_finance login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to blizhniy_runtime,composition_finance;
    grant select(id,is_blocked,email_verified_at),update(id) on app.users to composition_finance;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_fulfillments,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_reconciliation_jobs,
      app.listings,app.listing_photos,app.listing_blocks,app.listing_moderation,app.categories,app.cities,app.tariffs,app.media_objects,app.work_publications,app.work_publication_photos,app.specialist_categories,app.applications to composition_finance;
    grant update(id) on app.payment_checkout_intents,app.categories,app.cities,app.media_objects,app.listing_moderation,app.specialist_categories to composition_finance;
    grant update(id,status) on app.payment_orders to composition_finance;
    grant insert(intent_id),update(state,attempts,claim_id,lease_until,next_attempt_at,last_code) on app.payment_reconciliation_jobs to composition_finance;
    grant insert(intent_id,provider_payment_id,status,captured_at),update(status,captured_at) on app.payment_verifications to composition_finance;
    grant insert(intent_id,published_at,expires_at) on app.payment_fulfillments to composition_finance;
    grant insert(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) on app.payment_refund_reservations to composition_finance;
    grant insert(operation_id,idempotence_key,request_body) on app.payment_refund_requests to composition_finance;
    grant insert(operation_id) on app.payment_refund_dispatch_anchors to composition_finance;
    grant update(status,is_paid,published_at,expires_at,updated_at) on app.listings,app.work_publications to composition_finance;
    grant select(id,title,revision),update(title,revision) on app.listings to blizhniy_runtime;
    update app.phone_verification_policy set available=true,required=true`);
  db = database(); const runtime = await connection('blizhniy_runtime');
  await check('runtime cannot read private journals or write financial truth; phone source gate stays P7601', async () => {
    for (const table of ['payment_checkout_intents','payment_orders','payment_verifications','payment_fulfillments','payment_refund_reservations','payment_refund_requests','payment_refund_dispatch_anchors']) {
      await assert.rejects(runtime.query('select * from app.' + table), {code: '42501'});
      await assert.rejects(runtime.query('delete from app.' + table + ' where false'), {code: '42501'});
      await assert.rejects(runtime.query('insert into app.' + table + ' default values'), {code: '42501'});
      const column = ['payment_checkout_intents','payment_orders','payment_refund_reservations'].includes(table) ? 'id' : table.startsWith('payment_refund_') ? 'operation_id' : 'intent_id';
      await assert.rejects(runtime.query('update app.' + table + ' set ' + column + '=' + column + ' where false'), {code: '42501'});
    }
    await assert.rejects(fixture({confirmed: false}), {code: 'P7601'});
    assert.deepEqual((await admin.query('select available,required from app.phone_verification_policy')).rows[0], {available: true, required: true});
    await assert.rejects((await connection('composition_finance')).query('select password_hash,email from app.users'), {code: '42501'});
  });
  for (const kind of ['listing','vacancy','workRequest']) {
    await check(kind + ': actual paid fulfillment gets full shifted period, one receipt and immutable replay after reservation', async () => {
      const item = await fixture({kind, old: true}), before = await financial(item), started = Date.now(), store = fulfillment(kind), result = await store.fulfill(item.id);
      assert.equal(result.state, 'fulfilled'); assert.ok(Date.parse(result.period.publishedAt) >= started - 1000); assert.equal(Date.parse(result.period.expiresAt) - Date.parse(result.period.publishedAt), 30 * 86400000);
      const published = await target(item), history = await receipts(item.id); assert.equal(history.length, 1); assert.equal(published.status, 'published'); assert.equal(published.is_paid, true);
      assert.equal(published.published_at.toISOString(), new Date(result.period.publishedAt).toISOString()); assert.equal(published.expires_at.toISOString(), new Date(result.period.expiresAt).toISOString());
      assert.deepEqual(await store.fulfill(item.id), result); await prepareWindow(item); assert.deepEqual(await receipts(item.id), history); assert.deepEqual(await target(item), published); assert.deepEqual(await financial(item), before); assert.deepEqual(await store.fulfill(item.id), result);
    });
    await check(kind + ': reservation before fulfillment raises PBR01 and rolls publication/receipt back; edit fence34 survives', async () => {
      const item = await fixture({kind}), before = await financial(item); await prepareWindow(item);
      await assert.rejects(fulfillment(kind).fulfill(item.id), {code: 'PBR01'}); await assertDraft(item); assert.deepEqual(await financial(item), before);
      await assert.rejects(admin.query(kind === 'listing' ? "update app.listings set title='Изменённый оригинал',revision=revision+1 where id=$1" : "update app.work_publications set form=jsonb_set(form,'{title}','\"Изменённый оригинал\"'),revision=revision+1 where id=$1", [item.targetId]), {code: 'PBL01'});
    });
  }
  await check('created checkout remains fenced; blocked account and changed profile phone cannot block refund preparation/window', async () => {
    const active = await fixture({orderStatus: 'created'}); await assert.rejects(runtime.query("update app.listings set title='Попытка изменить покупку',revision=revision+1 where id=$1", [active.targetId]), {code: 'PBL01'});
    const item = await fixture(), before = await financial(item); await admin.query('update app.users set is_blocked=true,email_verified_at=null where id=$1', [item.ownerId]); await admin.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{phone}','\"+79998887766\"') where user_id=$1", [item.ownerId]); await prepareWindow(item); assert.deepEqual(await financial(item), before); await assertDraft(item);
  });
  await check('legacy capture while policy false permits reserve/prepare/window under required policy without confirmed phone', async () => {
    await admin.query('update app.phone_verification_policy set required=false'); let item;
    try { item = await fixture({confirmed: false, old: true}); } finally { await admin.query('update app.phone_verification_policy set required=true'); }
    assert.equal((await admin.query('select app.phone_is_confirmed($1) as confirmed', [item.ownerId])).rows[0].confirmed, false); const before = await financial(item); await prepareWindow(item); assert.deepEqual(await financial(item), before); await assertDraft(item);
  });
  await check('actual worker GET defers old capture for phone, confirmation wakes queue, then publishes full period once', async () => {
    const item = await fixture({old: true}); await admin.query('delete from app.telegram_phone_bindings where user_id=$1', [item.ownerId]); await enqueue(item);
    const mock = provider(item), worker = createPaymentReconciliationWorker(db, merchant, mock.fetch), before = await financial(item);
    assert.deepEqual(await worker.tick(), {state: 'deferred', code: 'phone_required'}); assert.deepEqual(await job(item.id), {state: 'waiting_phone', last_code: 'phone_required', attempts: 0}); await assertDraft(item); assert.deepEqual(await worker.tick(), {state: 'idle'}); assert.equal(mock.calls, 1);
    await confirm(item); assert.equal((await job(item.id)).state, 'queued'); const started = Date.now(); assert.deepEqual(await worker.tick(), {state: 'completed'}); assert.deepEqual(await job(item.id), {state: 'completed', last_code: null, attempts: 1}); assert.equal(mock.calls, 2);
    const row = await target(item); assert.equal(row.status, 'published'); assert.ok(row.published_at.getTime() >= started - 1000); assert.equal(row.expires_at.getTime() - row.published_at.getTime(), 30 * 86400000); assert.equal((await receipts(item.id)).length, 1); assert.deepEqual(await financial(item), before); assert.deepEqual(await worker.tick(), {state: 'idle'}); assert.equal(mock.calls, 2);
  });
  await check('phone confirmation holds user lock before refund reservation; observed order preserves receipt fence', async () => {
    const item = await fixture(); await admin.query('delete from app.telegram_phone_bindings where user_id=$1', [item.ownerId]);
    const first = await connection(), second = await connection('composition_finance'); await begin(first); await confirm(item, first);
    const operation = observe(new PostgresPlacementRefundReservationStore(txDatabase(second), merchant).reserve(item.id, randomUUID())); await blocked(second.processID); await commit(first); unwrap(await operation);
    await assert.rejects(fulfillment('listing').fulfill(item.id), {code: 'PBR01'}); await assertDraft(item);
  });
  await check('refund reservation holds user lock before phone confirmation; observed order preserves receipt fence', async () => {
    const item = await fixture(); await admin.query('delete from app.telegram_phone_bindings where user_id=$1', [item.ownerId]);
    const first = await connection('composition_finance'), second = await connection(); await begin(first);
    await new PostgresPlacementRefundReservationStore({transaction: work => work(first)}, merchant).reserve(item.id, randomUUID());
    const operation = observe(txDatabase(second).transaction(tx => confirm(item, tx))); await blocked(second.processID); await commit(first); unwrap(await operation);
    await assert.rejects(fulfillment('listing').fulfill(item.id), {code: 'PBR01'}); await assertDraft(item);
  });
  await check('actual worker finishes reserved phone-wait payment BLOCKED publication_blocked once, without provider retry exhaustion', async () => {
    await admin.query('update app.phone_verification_policy set required=false'); let item;
    try { item = await fixture({confirmed: false, old: true}); } finally { await admin.query('update app.phone_verification_policy set required=true'); }
    await enqueue(item);
    const mock = provider(item), worker = createPaymentReconciliationWorker(db, merchant, mock.fetch), before = await financial(item);
    assert.deepEqual(await worker.tick(), {state: 'deferred', code: 'phone_required'}); await prepareWindow(item); await confirm(item); assert.equal((await job(item.id)).state, 'queued');
    const result = await worker.tick(); console.log(JSON.stringify({observation: 'reserved_phone_wait_worker', result, job: await job(item.id), providerGets: mock.calls}));
    assert.deepEqual(result, {state: 'blocked', code: 'publication_blocked'});
    assert.deepEqual(await job(item.id), {state: 'blocked', last_code: 'publication_blocked', attempts: 1}); await assertDraft(item); assert.deepEqual(await financial(item), before);
    for (let i = 0; i < 12; i++) assert.deepEqual(await worker.tick(), {state: 'idle'}); assert.equal(mock.calls, 2);
    await admin.query("update app.cabinet_profiles set updated_at=clock_timestamp() where user_id=$1", [item.ownerId]); assert.deepEqual(await job(item.id), {state: 'blocked', last_code: 'publication_blocked', attempts: 1});
  });
  console.log(JSON.stringify({status: 'passed', checks, migrations: 37, server: 'PostgreSQL18.6', fixture: 'owned disposable container', providerNetwork: false, refundPOST: false, realCharges: false, productionTouched: false, productionWorkerPreflightClaimed: false}));
} catch (error) { failure = error; throw error; } finally {
  for (const [key, value] of Object.entries(previousEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const rolled = await Promise.allSettled([...transactions].map(client => client.query('rollback'))), drained = await Promise.all([...pending]);
  const closed = await Promise.allSettled([...pools].map(pool => pool.close()).concat([...clients].map(async client => { try { await client.query('rollback'); } finally { await client.end(); } })));
  if (container) { const info = JSON.parse(await docker(['inspect', container]))[0]; assert.equal(info.Id, container); assert.equal(info.Name, '/' + name); assert.equal(info.Config.Image, image); assert.equal(info.Config.Labels[label], name); await docker(['rm', '--force', container]); }
  const errors = [...rolled, ...closed].filter(result => result.status === 'rejected').map(result => result.reason).concat(drained.filter(result => Object.hasOwn(result, 'error')).map(result => result.error));
  if (errors.length) throw new AggregateError([...(failure ? [failure] : []), ...errors], 'Owned composition fixture cleanup failed');
}
