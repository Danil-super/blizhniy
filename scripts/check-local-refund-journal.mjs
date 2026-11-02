// Owned disposable PG18.6 only. Provider GET is an in-process fixture.
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
const {PostgresRefundJournalStore, RefundJournalError} = load('postgres-refund-journal');
const {parseWorkPublicationForm} = load('work-publication-contract');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-journal-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-journal-fixture';
const password = randomBytes(24).toString('hex'), merchant = {shopId: 'journal-fixture', isTest: true, secretKey: 'test_fixture'};
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024})).stdout.trim();
let container, admin, config, db, ownerDb, checks = 0, phoneSequence = 0, failure;
const clients = new Set(), pools = new Set(), pending = new Set(), transactions = new Set(), barriers = new Set();
async function connection(role = 'postgres') { const c = new pg.Client({...config, user: role}); await c.connect(); clients.add(c); return c; }
function database(role = 'journal_worker') { const d = new PostgresDatabase(new pg.Pool({...config, user: role, max: 6})); pools.add(d); return d; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
function observe(work) { const p = Promise.resolve(work).then(value => ({value}), error => ({error})); pending.add(p); p.then(() => pending.delete(p)); return p; }
function unwrap(result) { if (Object.hasOwn(result, 'error')) throw result.error; return result.value; }
function txDatabase(client) { return {transaction: async work => { await client.query('begin'); try { const value = await work(client); await client.query('commit'); return value; } catch (error) { await client.query('rollback'); throw error; } }}; }
async function begin(client) { await client.query('begin'); transactions.add(client); }
async function commit(client) { await client.query('commit'); transactions.delete(client); }
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); const release = () => { barriers.delete(release); resolve(); }; barriers.add(release); return {promise, release}; }
async function blocked(pid) { const deadline = Date.now() + 4000; for (;;) { if ((await admin.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return; assert.ok(Date.now() < deadline, 'Expected PostgreSQL row-lock barrier'); await new Promise(resolve => setTimeout(resolve, 15)); } }
async function fixture({kind = 'listing', orderStatus = 'succeeded', old = false} = {}) {
  const ownerId = (await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    ['composition-' + randomUUID() + '@example.invalid', `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  const phone = '+7999' + String(++phoneSequence).padStart(7, '0');
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)', [ownerId, JSON.stringify({name: 'Синтетический владелец', phone})]);

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
  if (orderStatus === 'succeeded' || orderStatus === 'refunded') {
    await admin.query("update app.payment_orders set status='succeeded' where id=$1", [id]);
    await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)", [id, providerPaymentId, capturedAt]);
  }
  const providerRefundId = randomUUID(), operationId = randomUUID();
  await new PostgresPlacementRefundReservationStore(ownerDb, merchant).reserve(id, operationId);
  return {...binding, providerPaymentId, providerRefundId, operationId, phone, capturedAt, createdAt: new Date(Date.parse(capturedAt) + 60000).toISOString(), requestBody, metadata};
}
async function prepared(options = {}) {
  const item = await fixture(options), requests = new PostgresRefundRequestStore(ownerDb, merchant);
  await requests.prepare(item.operationId); await requests.openWindow(item.operationId); return item;
}
function provider(item, {status = 'pending', paymentPatch = {}, refundPatch = {}, hold} = {}) {
  const calls = [];
  return {calls, fetch: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert.equal(init.body, undefined); assert.equal(init.headers['Idempotence-Key'], undefined);
    calls.push(String(url)); if (hold) await hold(String(url));
    if (String(url) === 'https://api.yookassa.ru/v3/payments/' + item.providerPaymentId) return Response.json({id: item.providerPaymentId, amount: {value: item.amount, currency: 'RUB'}, paid: true, status: 'succeeded', test: true, recipient: {account_id: merchant.shopId}, captured_at: item.capturedAt, metadata: item.metadata, ...paymentPatch});
    assert.equal(String(url), 'https://api.yookassa.ru/v3/refunds/' + item.providerRefundId);
    return Response.json({id: item.providerRefundId, payment_id: item.providerPaymentId, amount: {value: item.amount, currency: 'RUB'}, status, created_at: item.createdAt, metadata: {localRefundId: item.operationId, localPaymentId: item.id}, ...refundPatch});
  }};
}
function store(item, options, storage = db) { const fake = provider(item, options); return {fake, journal: new PostgresRefundJournalStore(storage, merchant, fake.fetch)}; }
async function rows(item) { return {links: (await admin.query('select * from app.payment_refund_provider_links where operation_id=$1', [item.operationId])).rows, observations: (await admin.query('select * from app.payment_refund_observations where operation_id=$1 order by status', [item.operationId])).rows}; }
async function financial(item) { return (await admin.query(`select i.request_body,i.request_sha256,i.amount::text,o.status,v.status as verified,v.captured_at,
  (select count(*)::integer from app.payment_fulfillments f where f.intent_id=i.id) as receipts,
  (select row_to_json(t) from (select status,is_paid,published_at,expires_at from app.${item.targetType === 'listing' ? 'listings' : 'work_publications'} where id=$1::uuid) t) as target
  from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id join app.payment_verifications v on v.intent_id=i.id where i.id=$2`, [item.targetId, item.id])).rows[0]; }
function expected(item, status = 'pending') { return {operationId: item.operationId, paymentIntentId: item.id, providerRefundId: item.providerRefundId, providerPaymentId: item.providerPaymentId, amount: item.amount, currency: 'RUB', status, createdAt: item.createdAt}; }
async function rawLink(client, item) { return client.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)', [item.operationId, item.providerRefundId]); }
async function rawObservation(client, item, status = 'pending', createdAt = item.createdAt) { return client.query('insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at) values($1,$2,$3,$4)', [item.operationId, item.providerRefundId, status, createdAt]); }
async function inject(table, sql, values) {
  assert.ok(['payment_checkout_intents','payment_orders','payment_verifications','payment_refund_reservations','payment_refund_requests','payment_refund_dispatch_anchors','payment_refund_observations'].includes(table));
  await admin.query('alter table app.' + table + ' disable trigger user');
  try { await admin.query(sql, values); } finally { await admin.query('alter table app.' + table + ' enable trigger user'); }
}
try {
  container = await docker(['run', '--detach', '--pull', 'never', '--name', name, '--label', `${label}=${name}`, '--memory', '512m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql:rw,size=268435456', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=blizhniy_test', image]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const info = JSON.parse(await docker(['inspect', container]))[0], port = info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(info.Config.Labels[label], name); assert.equal(info.Config.Image, image); assert.equal(port.HostIp, '127.0.0.1');
  config = {host: '127.0.0.1', port: Number(port.HostPort), database: 'blizhniy_test', user: 'postgres', password, statement_timeout: 8000};
  const deadline = Date.now() + 20000;
  for (;;) { try { await docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', config.database]); break; } catch { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 100)); } }
  admin = await connection(); assert.match((await admin.query('show server_version')).rows[0].server_version, /^18\.6/);
  const extras = [...await getLocalPrimaryExtraMigrations(), ...await getLocalTelegramMigrations(), ...await getLocalDeletionMigrations(), ...await getLocalCheckoutEditMigrations(), ...await getLocalApplicationContactMigrations()];
  for (const name of ['0036-placement-refund-reservations.sql','0037-refund-requests.sql','0038-refund-journal.sql']) { const source = await readFile(new URL('../database/migrations/' + name, import.meta.url), 'utf8'); extras.push({name, source, sha256: createHash('sha256').update(source).digest('hex')}); }
  await bootstrapPostgres(admin, '127.0.0.1:blizhniy_test', {includeListingContactMethod: true});
  await txDatabase(admin).transaction(async tx => { for (const migration of extras) { await tx.query(withoutTransaction(migration.source)); await tx.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)', [migration.name, migration.sha256]); } });
  const migration = extras.at(-1).source, down = await readFile(new URL('../database/migrations/0038-refund-journal.down.sql', import.meta.url), 'utf8');
  await check('all 38 exact migration hashes compose; empty down drops only new journal and reapplies', async () => {
    const expected = [...getBootstrapPlan({includeListingContactMethod: true}), ...extras].map(({name, sha256}) => ({name, sha256})); assert.equal(expected.length, 38);
    assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows, expected);
    const fence = (await admin.query("select pg_get_functiondef('app.fence_refunded_payment_fulfillment()'::regprocedure) as value")).rows[0].value;
    await admin.query(down); assert.deepEqual((await admin.query("select to_regclass('app.payment_refund_provider_links') as link,to_regclass('app.payment_refund_observations') as observation")).rows[0], {link: null, observation: null});
    assert.equal((await admin.query("select pg_get_functiondef('app.fence_refunded_payment_fulfillment()'::regprocedure) as value")).rows[0].value, fence); await admin.query(migration);
  });
  await admin.query(`create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    create role journal_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to journal_worker;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_refund_provider_links,app.payment_refund_observations to journal_worker;
    grant update(id) on app.payment_checkout_intents,app.payment_orders to journal_worker;
    grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to journal_worker;
    grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to journal_worker`);
  db = database(); ownerDb = database('postgres');
  for (const kind of ['listing','vacancy','workRequest']) await check(kind + ': GET-only pending/terminal/read/recovery are durable and leave all financial and service state unchanged', async () => {
    const item = await prepared({kind}), before = await financial(item), first = store(item);
    assert.equal(await first.journal.read(item.operationId), null);
    assert.deepEqual(await first.journal.reconcile(item.operationId, item.providerRefundId), expected(item)); assert.equal(first.fake.calls.length, 2);
    const pending = await rows(item); assert.equal(pending.links.length, 1); assert.equal(pending.observations.length, 1);
    assert.deepEqual(await store(item).journal.reconcile(item.operationId), expected(item)); assert.deepEqual(await rows(item), pending);
    assert.deepEqual(await store(item, {status: 'succeeded'}).journal.reconcile(item.operationId), expected(item, 'succeeded'));
    const terminal = await rows(item); assert.equal(terminal.observations.length, 2);
    assert.deepEqual(await store(item).journal.reconcile(item.operationId), expected(item, 'succeeded')); assert.deepEqual(await rows(item), terminal);
    assert.deepEqual(await first.journal.read(item.operationId), expected(item, 'succeeded')); assert.equal(first.fake.calls.length, 2);
    assert.deepEqual(await financial(item), before);
  });
  await check('canceled terminal and refunded original order remain recoverable; contradictions and rebinds fail unchanged', async () => {
    const item = await prepared(); await admin.query("update app.payment_orders set status='refunded' where id=$1", [item.id]);
    const canceled = store(item, {status: 'canceled'}); assert.deepEqual(await canceled.journal.reconcile(item.operationId, item.providerRefundId), expected(item, 'canceled'));
    const before = await rows(item); assert.deepEqual(await canceled.journal.reconcile(item.operationId), expected(item, 'canceled'));
    assert.deepEqual(await store(item).journal.reconcile(item.operationId), expected(item, 'canceled')); assert.deepEqual(await rows(item), before);
    await assert.rejects(store(item, {status: 'succeeded'}).journal.reconcile(item.operationId));
    await assert.rejects(store({...item, providerRefundId: randomUUID()}).journal.reconcile(item.operationId, randomUUID())); assert.deepEqual(await rows(item), before);
  });
  await check('preparation and window are mandatory; window expiry never blocks readback or resets authorization', async () => {
    for (const stage of ['reserved','prepared']) {
      const item = await fixture(); if (stage === 'prepared') await new PostgresRefundRequestStore(ownerDb, merchant).prepare(item.operationId);
      const attempt = store(item); await assert.rejects(attempt.journal.reconcile(item.operationId, item.providerRefundId), RefundJournalError); assert.equal(attempt.fake.calls.length, 0); assert.deepEqual(await rows(item), {links: [], observations: []});
    }
    const item = await prepared(); await inject('payment_refund_dispatch_anchors', "update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '2 days' where operation_id=$1", [item.operationId]);
    const before = (await admin.query('select * from app.payment_refund_dispatch_anchors where operation_id=$1', [item.operationId])).rows;
    await assert.rejects(store(item).journal.reconcile(item.operationId), RefundJournalError);
    assert.deepEqual(await store(item).journal.reconcile(item.operationId, item.providerRefundId), expected(item)); assert.deepEqual((await admin.query('select * from app.payment_refund_dispatch_anchors where operation_id=$1', [item.operationId])).rows, before);
  });
  await check('wrong original payment and refund provenance amount ID status and dates cannot persist a candidate', async () => {
    for (const options of [{paymentPatch: {metadata: {}}}, {paymentPatch: {test: false}}, {paymentPatch: {recipient: {account_id: 'wrong'}}}, {refundPatch: {metadata: {}}}, {refundPatch: {metadata: {localRefundId: randomUUID(), localPaymentId: randomUUID()}}}, {refundPatch: {payment_id: randomUUID()}}, {refundPatch: {id: randomUUID()}}, {refundPatch: {amount: {value: '198.00', currency: 'RUB'}}}, {status: 'waiting_for_capture'}, {refundPatch: {created_at: '2001-01-01T00:00:00Z'}}, {refundPatch: {created_at: '2099-01-01T00:00:00Z'}}]) {
      const item = await prepared(), attempt = store(item, options); await assert.rejects(attempt.journal.reconcile(item.operationId, item.providerRefundId)); assert.deepEqual(await rows(item), {links: [], observations: []});
    }
  });
  await check('original payment GET capture must agree with stored proof; missing GET capture retains stored chronology', async () => {
    const item = await prepared(), before = await financial(item), attempt = store(item, {paymentPatch: {captured_at: new Date(Date.parse(item.capturedAt) + 1).toISOString()}});
    await assert.rejects(attempt.journal.reconcile(item.operationId, item.providerRefundId)); assert.equal(attempt.fake.calls.length, 1); assert.deepEqual(await rows(item), {links: [], observations: []}); assert.deepEqual(await financial(item), before);
    assert.deepEqual(await store(item, {paymentPatch: {captured_at: undefined}}).journal.reconcile(item.operationId, item.providerRefundId), expected(item));
    const earlier = await prepared(), invalid = store(earlier, {paymentPatch: {captured_at: undefined}, refundPatch: {created_at: new Date(Date.parse(earlier.capturedAt) - 1).toISOString()}});
    await assert.rejects(invalid.journal.reconcile(earlier.operationId, earlier.providerRefundId)); assert.deepEqual(await rows(earlier), {links: [], observations: []});
  });
  await check('provider GET waits hold no SQL transaction or intent/order locks', async () => {
    const item = await prepared(), entered = gate(), release = gate(), client = await connection();
    const attempt = store(item, {hold: async () => { entered.release(); await release.promise; }}), future = observe(attempt.journal.reconcile(item.operationId, item.providerRefundId));
    try { unwrap(await Promise.race([entered.promise.then(() => ({value: true})), future])); await begin(client); await client.query("set local lock_timeout='300ms'"); await client.query('select id from app.payment_checkout_intents where id=$1 for update', [item.id]); await client.query('select id from app.payment_orders where id=$1 for update', [item.id]); await commit(client); }
    finally { release.release(); } assert.deepEqual(unwrap(await future), expected(item));
  });
  await check('two actual SQL contenders produce one provider binding and reject the competing ID', async () => {
    const item = await prepared(), other = {...item, providerRefundId: randomUUID()}, blocker = await connection(), c1 = await connection('journal_worker'), c2 = await connection('journal_worker');
    const pid1 = (await c1.query('select pg_backend_pid() as pid')).rows[0].pid, pid2 = (await c2.query('select pg_backend_pid() as pid')).rows[0].pid;
    const ready1 = gate(), ready2 = gate(), release = gate();
    const one = store(item, {hold: async url => { if (url.includes('/refunds/')) { ready1.release(); await release.promise; } }}, txDatabase(c1));
    const two = store(other, {hold: async url => { if (url.includes('/refunds/')) { ready2.release(); await release.promise; } }}, txDatabase(c2));
    const f1 = observe(one.journal.reconcile(item.operationId, item.providerRefundId)), f2 = observe(two.journal.reconcile(item.operationId, other.providerRefundId));
    try { unwrap(await Promise.race([Promise.all([ready1.promise, ready2.promise]).then(() => ({value: true})), f1, f2])); await begin(blocker); await blocker.query('select id from app.payment_checkout_intents where id=$1 for update', [item.id]); release.release(); await Promise.all([blocked(pid1), blocked(pid2)]); }
    finally { release.release(); await commit(blocker); }
    const outcomes = await Promise.all([f1, f2]); assert.equal(outcomes.filter(r => Object.hasOwn(r, 'value')).length, 1); assert.equal(outcomes.filter(r => Object.hasOwn(r, 'error')).length, 1);
    const saved = await rows(item); assert.equal(saved.links.length, 1); assert.equal(saved.observations.length, 1); assert.equal(saved.links[0].provider_refund_id, outcomes.find(r => r.value).value.providerRefundId);
  });
  await check('real rollback and successful COMMIT with lost acknowledgement preserve atomic replay', async () => {
    for (const lostAck of [false, true]) {
      const item = await prepared(), client = await connection('journal_worker'), sentinel = Error('Fixture transaction boundary'); let commits = 0;
      const boundary = {transaction: async work => { await client.query('begin'); let value;
        try { value = await work(client); } catch (error) { await client.query('rollback'); throw error; }
        const count = (await client.query('select count(*)::integer as n from app.payment_refund_observations where operation_id=$1', [item.operationId])).rows[0].n;
        if (!count) { await client.query('commit'); return value; }
        if (lostAck) { await client.query('commit'); commits++; } else await client.query('rollback'); throw sentinel;
      }};
      await assert.rejects(store(item, {}, boundary).journal.reconcile(item.operationId, item.providerRefundId), error => error === sentinel);
      const before = await rows(item); assert.equal(commits, lostAck ? 1 : 0); assert.equal(before.links.length, lostAck ? 1 : 0); assert.equal(before.observations.length, lostAck ? 1 : 0);
      assert.deepEqual(await store(item).journal.reconcile(item.operationId, lostAck ? undefined : item.providerRefundId), expected(item));
      if (lostAck) assert.deepEqual(await rows(item), before);
    }
  });
  await check('SQL guards enforce invoker READ COMMITTED immutable journals and database observation times', async () => {
    const funcs = (await admin.query(`select distinct p.proname,p.prosecdef,p.provolatile,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') as public_execute
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid in ('app.payment_refund_provider_links'::regclass,'app.payment_refund_observations'::regclass) and not t.tgisinternal`)).rows;
    assert.equal(funcs.length, 1); assert.equal(funcs[0].proname, 'guard_refund_journal'); assert.equal(funcs[0].prosecdef, false); assert.equal(funcs[0].provolatile, 'v'); assert.equal(funcs[0].public_execute, false); assert.deepEqual(funcs[0].proconfig, ['search_path=""']);
    const item = await prepared(); await admin.query("insert into app.payment_refund_provider_links(operation_id,provider_refund_id,created_at) values($1,$2,'2001-01-01')", [item.operationId, item.providerRefundId]);
    await admin.query("insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at,observed_at) values($1,$2,'pending',$3,'2001-01-01')", [item.operationId, item.providerRefundId, item.createdAt]);
    const saved = await rows(item); assert.ok(Math.abs(Date.now() - saved.links[0].created_at.getTime()) < 5000); assert.ok(Math.abs(Date.now() - saved.observations[0].observed_at.getTime()) < 5000);
    for (const table of ['payment_refund_provider_links','payment_refund_observations']) {
      for (const sql of ['update app.' + table + ' set operation_id=operation_id where operation_id=$1', 'delete from app.' + table + ' where operation_id=$1']) await assert.rejects(admin.query(sql, [item.operationId]), {code: '23514'});
      await assert.rejects(admin.query('truncate app.' + table + ' cascade'), {code: '23514'});
    }
    const client = await connection('journal_worker');
    for (const isolation of ['repeatable read','serializable']) for (const target of ['link','observation']) {
      const fresh = await prepared(); if (target === 'observation') await rawLink(admin, fresh);
      await client.query('begin isolation level ' + isolation); try { await assert.rejects(target === 'link' ? rawLink(client, fresh) : rawObservation(client, fresh), {code: 'PBR02'}); } finally { await client.query('rollback'); }
    }
  });
  await check('raw journals reject missing prepared/window evidence and invalid status chronology binding', async () => {
    for (const stage of ['reserved','prepared']) { const item = await fixture(); if (stage === 'prepared') await new PostgresRefundRequestStore(ownerDb, merchant).prepare(item.operationId); await assert.rejects(rawLink(admin, item), {code: '23514'}); }
    const item = await prepared(); await rawLink(admin, item);
    for (const [status, createdAt] of [['refunded',item.createdAt], ['pending','2001-01-01T00:00:00Z'], ['pending','2099-01-01T00:00:00Z'], ['pending','2026-02-30T00:00:00Z'], ['pending',item.createdAt + '\n']]) await assert.rejects(rawObservation(admin, item, status, createdAt), {code: '23514'});
    await assert.rejects(rawObservation(admin, {...item, providerRefundId: randomUUID()}), {code: '23514'});
    await rawObservation(admin, item, 'succeeded'); await assert.rejects(rawObservation(admin, item, 'canceled'), {code: '23514'});
    await assert.rejects(rawObservation(admin, item, 'pending', item.createdAt), {code: '23514'});
    await assert.rejects(rawObservation(admin, item, 'pending', new Date(Date.parse(item.createdAt) + 1).toISOString()), {code: '23514'});
    const linkOnly = await prepared(); await rawLink(admin, linkOnly); await assert.rejects(store(linkOnly).journal.read(linkOnly.operationId), RefundJournalError);
  });
  await check('nanosecond chronology and equivalent creation instants preserve first spelling', async () => {
    const item = await prepared(); item.createdAt = item.createdAt.replace(/\.\d+Z$/, '.123Z');
    await store(item).journal.reconcile(item.operationId, item.providerRefundId);
    assert.deepEqual(await store({...item, createdAt: item.createdAt.replace('.123Z','.123000000Z')}, {status: 'succeeded'}).journal.reconcile(item.operationId), expected(item, 'succeeded'));
    const before = await rows(item); await assert.rejects(store({...item, createdAt: item.createdAt.replace('.123Z','.123000001Z')}).journal.reconcile(item.operationId)); assert.deepEqual(await rows(item), before);
    const raw = await prepared(); raw.createdAt = raw.createdAt.replace(/\.\d+Z$/, '.123456789Z'); await rawLink(admin, raw); await rawObservation(admin, raw);
    await assert.rejects(rawObservation(admin, raw, 'succeeded', raw.createdAt.replace('123456789','123456788')), {code: '23514'});
    await rawObservation(admin, raw, 'succeeded', raw.createdAt);
    const capture = await prepared(); capture.createdAt = capture.capturedAt.replace(/\.\d+Z$/, '.123456788Z');
    await inject('payment_verifications', "update app.payment_verifications set captured_at=$2 where intent_id=$1", [capture.id, capture.createdAt.replace('123456788','123456789')]); await rawLink(admin, capture);
    await assert.rejects(rawObservation(admin, capture), {code: '23514'});
  });
  await check('source intent reservation prepared bytes hash key capture and order drift fail API and raw SQL', async () => {
    const variants = [
      ['payment_checkout_intents', i => ['update app.payment_checkout_intents set request_sha256=$2 where id=$1', [i.id, '0'.repeat(64)]]],
      ['payment_checkout_intents', i => ["update app.payment_checkout_intents set merchant_shop_id='other' where id=$1", [i.id]]],
      ['payment_checkout_intents', i => ['update app.payment_checkout_intents set is_test=false where id=$1', [i.id]]],
      ['payment_checkout_intents', i => ['update app.payment_checkout_intents set duration_days=null where id=$1', [i.id]]],
      ['payment_refund_reservations', i => ['update app.payment_refund_reservations set amount=amount+1 where id=$1', [i.operationId]]],
      ['payment_refund_requests', i => ['update app.payment_refund_requests set request_sha256=$2 where operation_id=$1', [i.operationId, '0'.repeat(64)]]],
      ['payment_refund_requests', i => ["update app.payment_refund_requests set request_body=request_body||' ',request_sha256=encode(sha256(convert_to(request_body||' ','UTF8')),'hex') where operation_id=$1", [i.operationId]]],
      ['payment_refund_requests', i => ["update app.payment_refund_requests set idempotence_key='refund-'||$2 where operation_id=$1", [i.operationId, randomUUID()]]],
      ['payment_verifications', i => ['update app.payment_verifications set captured_at=null where intent_id=$1', [i.id]]],
      ['payment_verifications', i => ["update app.payment_verifications set status='pending',captured_at=null where intent_id=$1", [i.id]]],
      ['payment_orders', i => ["update app.payment_orders set status='failed' where id=$1", [i.id]]]
    ];
    for (const [table, mutation] of variants) for (const existing of [false, true]) {
      const item = await prepared(); if (existing) await store(item).journal.reconcile(item.operationId, item.providerRefundId);
      const before = await rows(item), [sql, values] = mutation(item); await inject(table, sql, values);
      const attempt = store(item); await assert.rejects(attempt.journal.reconcile(item.operationId, item.providerRefundId), RefundJournalError); assert.equal(attempt.fake.calls.length, 0); await assert.rejects(rawLink(admin, item), {code: '23514'});
      if (existing) { await assert.rejects(attempt.journal.read(item.operationId), RefundJournalError); await assert.rejects(rawObservation(admin, item, 'succeeded'), {code: '23514'}); }
      assert.deepEqual(await rows(item), before);
    }
  });
  await check('fresh source checks reject changes while GET is held and after an actual order lock wait', async () => {
    const item = await prepared(), entered = gate(), release = gate(), attempt = store(item, {hold: async () => { entered.release(); await release.promise; }});
    const future = observe(attempt.journal.reconcile(item.operationId, item.providerRefundId));
    try { unwrap(await Promise.race([entered.promise.then(() => ({value: true})), future])); await inject('payment_verifications', "update app.payment_verifications set captured_at=$2 where intent_id=$1", [item.id, new Date(Date.parse(item.capturedAt) + 1).toISOString()]); } finally { release.release(); }
    assert.ok(Object.hasOwn(await future, 'error')); assert.deepEqual(await rows(item), {links: [], observations: []});
    for (const table of ['payment_checkout_intents','payment_orders']) {
      const item = await prepared(), owner = await connection(), worker = await connection('journal_worker'), pid = (await worker.query('select pg_backend_pid() as pid')).rows[0].pid;
      await begin(owner); await owner.query('select id from app.' + table + ' where id=$1 for update', [item.id]);
      const blockedInsert = observe(rawLink(worker, item));
      try {
        await blocked(pid); await owner.query('alter table app.payment_verifications disable trigger user');
        await owner.query('update app.payment_verifications set captured_at=null where intent_id=$1', [item.id]);
        await owner.query('alter table app.payment_verifications enable trigger user');
      } finally { await commit(owner); }
      assert.equal((await blockedInsert).error?.code, '23514'); assert.deepEqual(await rows(item), {links: [], observations: []});
    }
  });
  await check('minimal role has no account email/password access, financial writes or history mutation', async () => {
    const worker = await connection('journal_worker');
    for (const table of ['payment_refund_provider_links','payment_refund_observations']) {
      assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed", ['app.' + table])).rows[0].allowed, false);
      for (const sql of ['delete from app.' + table + ' where false','truncate app.' + table,'update app.' + table + ' set operation_id=operation_id where false']) await assert.rejects(worker.query(sql), {code: '42501'});
    }
    for (const sql of ['select email,password_hash from app.users limit 0',"update app.payment_orders set status='refunded' where false",'update app.payment_verifications set captured_at=null where false','delete from app.payment_refund_requests where false','insert into app.payment_refund_provider_links(operation_id,provider_refund_id,created_at) values(null,null,clock_timestamp())','insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at,observed_at) values(null,null,null,null,clock_timestamp())']) await assert.rejects(worker.query(sql), {code: '42501'});
  });
  await check('provider IDs cannot bind another operation and unknown SQL errors propagate without retry', async () => {
    const item = await prepared(); await store(item).journal.reconcile(item.operationId, item.providerRefundId);
    const other = await prepared(); other.providerRefundId = item.providerRefundId;
    await assert.rejects(store(other).journal.reconcile(other.operationId, other.providerRefundId)); assert.deepEqual(await rows(other), {links: [], observations: []});
    await assert.rejects(rawLink(admin, other), {code: '23505'});
    const client = await connection('journal_worker'); let original, attempts = 0;
    const broken = {transaction: work => { attempts++; return txDatabase(client).transaction(tx => work({query: async () => {
      try { return await tx.query('select * from app.refund_fixture_missing_relation'); } catch (error) { original = error; throw error; }
    }})); }};
    for (const method of ['read','reconcile']) { attempts = 0; await assert.rejects(store(item, {}, broken).journal[method](item.operationId, item.providerRefundId), error => error === original && error.code === '42P01'); assert.equal(attempts, 1); }
  });
  await check('concurrent opposite terminal observations of one refund serialize and retain one terminal winner', async () => {
    const item = await prepared(); await store(item).journal.reconcile(item.operationId, item.providerRefundId);
    const blocker = await connection(), one = await connection('journal_worker'), two = await connection('journal_worker');
    const pid1 = (await one.query('select pg_backend_pid() as pid')).rows[0].pid, pid2 = (await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await begin(blocker); await blocker.query('select id from app.payment_checkout_intents where id=$1 for update', [item.id]);
    const succeeded = observe(rawObservation(one, item, 'succeeded')), canceled = observe(rawObservation(two, item, 'canceled'));
    try { await Promise.all([blocked(pid1), blocked(pid2)]); } finally { await commit(blocker); }
    const outcomes = await Promise.all([succeeded, canceled]); assert.equal(outcomes.filter(r => Object.hasOwn(r, 'value')).length, 1); assert.equal(outcomes.filter(r => r.error?.code === '23514').length, 1);
    const saved = await rows(item); assert.equal(saved.links.length, 1); assert.equal(saved.observations.length, 2);
    assert.deepEqual(await store(item).journal.read(item.operationId), expected(item, Object.hasOwn(outcomes[0], 'value') ? 'succeeded' : 'canceled'));
  });
  await check('nonempty down fails without losing durable provider or observation history', async () => {
    const counts = async () => (await admin.query('select (select count(*)::integer from app.payment_refund_provider_links) as links,(select count(*)::integer from app.payment_refund_observations) as observations')).rows[0];
    const before = await counts(); assert.ok(before.links > 0 && before.observations > 0); await assert.rejects(admin.query(down), {code: '23514'}); await admin.query('rollback'); assert.deepEqual(await counts(), before);
  });
  console.log(JSON.stringify({status: 'passed', checks, server: 'PostgreSQL18.6', providerNetwork: false, refundPOST: false, realCharges: false, productionTouched: false, fixture: 'owned disposable container'}));
} catch (error) { failure = error; throw error; } finally {
  for (const release of barriers) release();
  const releases = await Promise.allSettled([...transactions].map(client => client.query('rollback')));
  const drained = await Promise.all([...pending]);
  const cleanup = await Promise.allSettled([...pools].map(pool => pool.close()).concat([...clients].map(async client => { try { await client.query('rollback'); } finally { await client.end(); } })));
  if (container) { const info = JSON.parse(await docker(['inspect', container]))[0]; assert.equal(info.Id, container); assert.equal(info.Name, '/' + name); assert.equal(info.Config.Image, image); assert.equal(info.Config.Labels[label], name); await docker(['rm', '--force', container]); }
  const failures = [...releases,...cleanup].filter(r => r.status === 'rejected').map(r => r.reason).concat(drained.filter(r => Object.hasOwn(r, 'error')).map(r => r.error));
  if (failures.length) throw new AggregateError([...(failure ? [failure] : []),...failures], 'Owned journal SQL fixture cleanup failed');
}
