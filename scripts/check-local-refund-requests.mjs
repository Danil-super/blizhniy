// Disposable PostgreSQL18 acceptance only. No remote provider, refund POST,
// manual stand, production grants or real financial effects.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import pg from 'pg';
import {bootstrapPostgres} from './bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {PostgresPlacementRefundReservationStore} = load('postgres-placement-refund-reservations');
const {PostgresRefundRequestStore, RefundRequestError} = load('postgres-refund-requests');
assert.equal(typeof PostgresRefundRequestStore, 'function');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-request-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-request-fixture';
const password = randomBytes(24).toString('hex'), merchant = {shopId: 'fixture-shop', isTest: true};
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
let container, admin, db, config, checks = 0, failure;
const clients = new Set(), pools = new Set(), barriers = new Set(), pending = new Set(), manualTransactions = new Set();
function observe(operation) {
  const settled = Promise.resolve(operation).then(value => ({value}), error => ({error}));
  pending.add(settled); settled.then(() => pending.delete(settled)); return settled;
}
function unwrap(settled) { if (Object.hasOwn(settled, 'error')) throw settled.error; return settled.value; }
async function connection(role = 'postgres') { const client = new pg.Client({...config, user: role}); await client.connect(); clients.add(client); return client; }
function database(role = 'postgres') { const result = new PostgresDatabase(new pg.Pool({...config, user: role, max: 8})); pools.add(result); return result; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
function txDatabase(client) {
  return {transaction: async work => { await client.query('begin'); try { const result = await work(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; }}};
}
function heldTransaction(database) {
  let resolveGate, ready, rejectPrepared;
  const gate = new Promise(resolve => { resolveGate = resolve; });
  // The raw preparation promise rejects even if transaction acquisition/work
  // fails before ready(). Observe it immediately, just like each caller's work.
  const rawPrepared = new Promise((resolve, reject) => { ready = resolve; rejectPrepared = reject; });
  const prepared = observe(rawPrepared);
  const release = () => { barriers.delete(release); resolveGate(); }; barriers.add(release);
  return {database: {transaction: work => Promise.resolve().then(() => database.transaction(async tx => {
    const result = await work(tx); ready(result); await gate; return result;
  })).catch(error => { rejectPrepared(error); throw error; })}, prepared, release};
}
async function beginHeld(client) { await client.query('begin'); manualTransactions.add(client); }
async function commitHeld(client) {
  await client.query('commit'); manualTransactions.delete(client);
}
async function fixture(options = {}, client = admin) {
  const kind = options.kind ?? 'listing', owner = (await client.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    [`refund-request-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  let target = randomUUID();
  if (kind === 'listing') {
    target = (await client.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at)
      select $1,'sell',c.id,city.id,'Синтетическая оплаченная публикация','Проверка резервирования возврата.','+79990000000',clock_timestamp()-interval '2 hours'
      from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id`, [owner])).rows[0].id;
    await client.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())", [target]);
  }
  const id = randomUUID(), binding = {id, ownerId: owner, targetType: kind, targetId: target, targetRevision: '1', tariffId: 'listing-publication',
    amount: '199.00', durationDays: Object.hasOwn(options, 'durationDays') ? options.durationDays : 30,
    shopId: options.shopId ?? merchant.shopId, isTest: options.isTest ?? true};
  const body = JSON.stringify({amount: {value: binding.amount, currency: 'RUB'}, capture: true,
    confirmation: {type: 'redirect', return_url: 'https://fixture.example.invalid/return'}, metadata: {localPaymentId: id, targetId: target, targetType: kind, tariffId: binding.tariffId}});
  await new PostgresPaymentIntentStore({transaction: async work => work(client)}).persistInTransaction(client, {...binding, requestBody: body});
  if (options.order !== false) {
    await client.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)', [id, owner, randomUUID(), kind, target]);
    const status = options.orderStatus ?? 'succeeded';
    if (status === 'refunded') await client.query("update app.payment_orders set status='succeeded' where id=$1", [id]);
    if (status !== 'created') await client.query('update app.payment_orders set status=$2 where id=$1', [id, status]);
  }
  const provider = randomUUID();
  if (options.link !== false) {
    await client.query('insert into app.payment_dispatch_anchors(intent_id) values($1)', [id]);
    await client.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)', [id, provider]);
    if (options.verification !== false && options.order !== false) {
      const status = options.verifiedStatus ?? 'succeeded';
      await client.query('insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,$3,$4)',
        [id, provider, status, status === 'succeeded' && options.capture !== false ? new Date().toISOString() : null]);
    }
  }
  return {...binding, providerPaymentId: provider};
}
async function history(id) {
  return (await admin.query(`select o.status,i.amount::text,i.request_body,i.request_sha256,v.status as verified,v.captured_at,
    (select count(*)::integer from app.payment_fulfillments f where f.intent_id=i.id) as receipts
    from app.payment_checkout_intents i left join app.payment_orders o on o.id=i.id left join app.payment_verifications v on v.intent_id=i.id where i.id=$1`, [id])).rows[0];
}
async function waitUntilBlocked(observer, pid) {
  const deadline = Date.now() + 3000;
  for (;;) { if ((await observer.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return;
    assert.ok(Date.now() < deadline, 'Expected actual row-lock contention'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
const WINDOW_MS = (23 * 60 + 55) * 60 * 1000;
function canonical(item, operationId) {
  return JSON.stringify({payment_id: item.providerPaymentId, amount: {value: item.amount, currency: 'RUB'},
    metadata: {localRefundId: operationId, localPaymentId: item.id}});
}
async function reservation(options = {}) {
  const item = await fixture(options), operationId = randomUUID();
  await new PostgresPlacementRefundReservationStore(database(), merchant).reserve(item.id, operationId);
  return {...item, operationId};
}
async function requestRows(operationId) { return (await admin.query('select * from app.payment_refund_requests where operation_id=$1', [operationId])).rows; }
async function anchorRows(operationId) { return (await admin.query('select * from app.payment_refund_dispatch_anchors where operation_id=$1', [operationId])).rows; }
async function rawRequest(client, item, patch = {}) {
  const value = {operationId: item.operationId, key: 'refund-' + item.operationId, body: canonical(item, item.operationId), ...patch};
  return client.query('insert into app.payment_refund_requests(operation_id,idempotence_key,request_body) values($1,$2,$3)', [value.operationId, value.key, value.body]);
}
async function rawAnchor(client, operationId) { return client.query('insert into app.payment_refund_dispatch_anchors(operation_id) values($1)', [operationId]); }
// Explicit owner-only corruption is confined to the new disposable container.
// These helpers never alter repository migrations or weaken runtime privileges.
async function inject(table, sql, values) {
  assert.ok(['payment_checkout_intents', 'payment_refund_reservations', 'payment_refund_requests', 'payment_refund_dispatch_anchors', 'payment_verifications', 'payment_provider_links'].includes(table));
  await admin.query('alter table app.' + table + ' disable trigger user');
  try { await admin.query(sql, values); } finally { await admin.query('alter table app.' + table + ' enable trigger user'); }
}
async function setAnchorAge(operationId, milliseconds) {
  await inject('payment_refund_dispatch_anchors', 'update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-($2::double precision * interval \'1 millisecond\') where operation_id=$1', [operationId, milliseconds]);
}
function expectPrepared(actual, item) {
  assert.deepEqual(Object.keys(actual).sort(), ['operationId', 'paymentIntentId', 'providerPaymentId', 'amount', 'shopId', 'isTest', 'requestBody', 'idempotenceKey', 'createdAt'].sort());
  assert.equal(actual.operationId, item.operationId); assert.equal(actual.paymentIntentId, item.id); assert.equal(actual.providerPaymentId, item.providerPaymentId);
  assert.equal(actual.amount, item.amount); assert.equal(actual.shopId, item.shopId); assert.equal(actual.isTest, true);
  assert.equal(actual.requestBody, canonical(item, item.operationId)); assert.equal(actual.idempotenceKey, 'refund-' + item.operationId);
  assert.ok(Number.isFinite(Date.parse(actual.createdAt)));
  assert.ok(!/@|79990000000|return_url|customer|receipt|description/.test(actual.requestBody));
}
try {
  container = await docker(['run', '--detach', '--pull', 'never', '--name', name, '--label', `${label}=${name}`, '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql:rw,size=268435456', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=blizhniy_test', image]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const info = JSON.parse(await docker(['inspect', container]))[0], port = info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(info.Config.Labels[label], name); assert.equal(info.Config.Image, image); assert.equal(port.HostIp, '127.0.0.1');
  config = {host: '127.0.0.1', port: Number(port.HostPort), database: 'blizhniy_test', user: 'postgres', password, statement_timeout: 8000};
  const deadline = Date.now() + 20000;
  for (;;) { try { await docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', config.database]); break; }
    catch { assert.ok(Date.now() < deadline, 'Owned PostgreSQL fixture failed to start'); await new Promise(resolve => setTimeout(resolve, 100)); }}
  admin = await connection(); assert.match((await admin.query('show server_version')).rows[0].server_version, /^18\.6/);
  await bootstrapPostgres(admin, '127.0.0.1:blizhniy_test', {includePaymentFulfillment: true});
  await admin.query(await readFile(new URL('../database/migrations/0036-placement-refund-reservations.sql', import.meta.url), 'utf8'));
  const migration = await readFile(new URL('../database/migrations/0037-refund-requests.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../database/migrations/0037-refund-requests.down.sql', import.meta.url), 'utf8');
  await admin.query(migration);
  await check('empty additive migration down removes both journals and reapplies without altering schema36 fence', async () => {
    const fence = (await admin.query("select pg_get_functiondef('app.fence_refunded_payment_fulfillment()'::regprocedure) as definition")).rows[0].definition;
    await admin.query(down);
    assert.deepEqual((await admin.query("select to_regclass('app.payment_refund_requests') as request,to_regclass('app.payment_refund_dispatch_anchors') as anchor")).rows[0], {request: null, anchor: null});
    assert.equal((await admin.query("select pg_get_functiondef('app.fence_refunded_payment_fulfillment()'::regprocedure) as definition")).rows[0].definition, fence);
    await admin.query(migration);
  });
  await admin.query(`create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    create role refund_request_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to refund_request_worker;
    grant select(id) on app.users to refund_request_worker;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors to refund_request_worker;
    grant update(id) on app.users,app.payment_checkout_intents,app.payment_orders to refund_request_worker;
    grant insert(operation_id,idempotence_key,request_body) on app.payment_refund_requests to refund_request_worker;
    grant insert(operation_id) on app.payment_refund_dispatch_anchors to refund_request_worker`);
  db = database('refund_request_worker'); const store = new PostgresRefundRequestStore(db, merchant);
  await check('new guards are invoker, VOLATILE, fixed-path and non-public executable', async () => {
    const functions = (await admin.query(`select distinct p.proname,p.prosecdef,p.provolatile,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') as public_execute
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid in ('app.payment_refund_requests'::regclass,'app.payment_refund_dispatch_anchors'::regclass) and not t.tgisinternal`)).rows;
    assert.equal(functions.length, 1);
    assert.equal((await admin.query("select count(*)::integer as n from pg_trigger where tgrelid in ('app.payment_refund_requests'::regclass,'app.payment_refund_dispatch_anchors'::regclass) and not tgisinternal")).rows[0].n, 4);
    for (const row of functions) { assert.equal(row.prosecdef, false); assert.equal(row.provolatile, 'v'); assert.deepEqual(row.proconfig, ['search_path=""']); assert.equal(row.public_execute, false); }
  });
  for (const kind of ['listing', 'vacancy', 'workRequest']) await check(kind + ': canonical full TEST preparation freezes source and opens one technical window without financial effects', async () => {
    const item = await reservation({kind}), before = await history(item.id), prepared = await store.prepare(item.operationId);
    expectPrepared(prepared, item); assert.deepEqual(await anchorRows(item.operationId), []);
    assert.deepEqual(await store.prepare(item.operationId), prepared);
    const window = await store.openWindow(item.operationId);
    assert.deepEqual(Object.keys(window).sort(), ['request', 'remainingMs'].sort()); assert.deepEqual(window.request, prepared);
    assert.ok(window.remainingMs > WINDOW_MS - 5000 && window.remainingMs <= WINDOW_MS);
    const first = await anchorRows(item.operationId); assert.equal(first.length, 1);
    const retry = await store.openWindow(item.operationId); assert.deepEqual(retry.request, prepared); assert.ok(retry.remainingMs <= window.remainingMs);
    assert.deepEqual(await anchorRows(item.operationId), first); assert.equal((await requestRows(item.operationId)).length, 1);
    assert.deepEqual(await history(item.id), before);
    const row = (await requestRows(item.operationId))[0]; assert.equal(row.request_body, prepared.requestBody);
    assert.equal(row.request_sha256, createHash('sha256').update(prepared.requestBody).digest('hex'));
  });
  await check('concurrent prepare and window retries preserve one body key timestamp and first anchor', async () => {
    const item = await reservation();
    const prepared = (await Promise.all(Array.from({length: 8}, () => observe(store.prepare(item.operationId))))).map(unwrap);
    for (const result of prepared) assert.deepEqual(result, prepared[0]);
    const windows = (await Promise.all(Array.from({length: 8}, () => observe(store.openWindow(item.operationId))))).map(unwrap);
    for (const result of windows) { assert.deepEqual(result.request, prepared[0]); assert.ok(result.remainingMs > 0 && result.remainingMs <= WINDOW_MS); }
    assert.equal((await requestRows(item.operationId)).length, 1); assert.equal((await anchorRows(item.operationId)).length, 1);
  });
  await check('different operations have separate refund namespace keys and no payment-key reuse', async () => {
    const a = await reservation(), b = await reservation(), ra = await store.prepare(a.operationId), rb = await store.prepare(b.operationId);
    assert.notEqual(ra.idempotenceKey, rb.idempotenceKey); assert.notEqual(ra.idempotenceKey, a.id); assert.notEqual(ra.idempotenceKey, a.operationId);
    expectPrepared(ra, a); expectPrepared(rb, b);
  });
  await check('invalid IDs, absent reservations, missing preparation and LIVE configuration are refused', async () => {
    for (const id of ['invalid', '', null, {}, randomUUID().toUpperCase(), "x';select 1--"]) {
      await assert.rejects(store.prepare(id), RefundRequestError); await assert.rejects(store.openWindow(id), RefundRequestError);
    }
    await assert.rejects(store.prepare(randomUUID()), RefundRequestError);
    const item = await reservation(); await assert.rejects(store.openWindow(item.operationId), RefundRequestError);
    assert.deepEqual(await requestRows(item.operationId), []); assert.deepEqual(await anchorRows(item.operationId), []);
    assert.throws(() => new PostgresRefundRequestStore(db, {...merchant, isTest: false}), RefundRequestError);
    assert.throws(() => new PostgresRefundRequestStore(db, {...merchant, shopId: 'bad shop'}), RefundRequestError);
    await assert.rejects(new PostgresRefundRequestStore(db, {...merchant, shopId: 'other-shop'}).prepare(item.operationId), RefundRequestError);
    const original = await fixture(); await assert.rejects(store.prepare(original.id), RefundRequestError);
  });
  await check('current account publication and tariff changes cannot alter canonical purchase bytes', async () => {
    const item = await reservation(); await admin.query('update app.users set is_blocked=true,email_verified_at=null where id=$1', [item.ownerId]);
    await admin.query("update app.listings set title='Изменённая публикация',revision=revision+1 where id=$1", [item.targetId]);
    const offer = (await admin.query("select price,active from app.tariffs where id='listing-publication'")).rows[0];
    await admin.query("update app.tariffs set price=price+100,active=false where id='listing-publication'");
    try { expectPrepared(await store.prepare(item.operationId), item); }
    finally { await admin.query("update app.tariffs set price=$1,active=$2 where id='listing-publication'", [offer.price, offer.active]); }
  });
  await check('later refunded order allows historical recovery but rejects new preparation and dispatch window', async () => {
    const historic = await reservation(), prepared = await store.prepare(historic.operationId);
    await admin.query("update app.payment_orders set status='refunded' where id=$1", [historic.id]);
    assert.deepEqual(await store.prepare(historic.operationId), prepared); await assert.rejects(store.openWindow(historic.operationId), RefundRequestError);
    assert.deepEqual(await anchorRows(historic.operationId), []);
    const newItem = await reservation(); await admin.query("update app.payment_orders set status='refunded' where id=$1", [newItem.id]);
    await assert.rejects(store.prepare(newItem.operationId), RefundRequestError); await assert.rejects(rawRequest(admin, newItem), {code: '23514'});
    assert.deepEqual(await requestRows(newItem.operationId), []);
  });
  await check('raw SQL rejects altered canonical strings and semantic source mismatches', async () => {
    const client = await connection('refund_request_worker');
    for (const patch of [
      item => ({key: item.operationId}), () => ({key: 'refund-' + randomUUID()}),
      item => ({body: canonical(item, item.operationId) + ' '}),
      item => ({body: JSON.stringify(JSON.parse(canonical(item, item.operationId)), null, 2)}),
      item => ({body: JSON.stringify({amount: {value: item.amount, currency: 'RUB'}, payment_id: item.providerPaymentId, metadata: {localRefundId: item.operationId, localPaymentId: item.id}})}),
      item => ({body: canonical({...item, amount: '1.00'}, item.operationId)}), item => ({body: canonical({...item, providerPaymentId: randomUUID()}, item.operationId)}),
      item => ({body: canonical(item, randomUUID())}), () => ({body: '{}'}), () => ({body: '{invalid'}),
      item => ({body: canonical(item, item.operationId).replace('RUB', 'USD')}),
      item => ({body: canonical(item, item.operationId).replace('"metadata":{', '"metadata":{"email":"synthetic@example.invalid",')})
    ]) {
      const item = await reservation(); await assert.rejects(rawRequest(client, item, patch(item)), {code: '23514'}); assert.deepEqual(await requestRows(item.operationId), []);
    }
    const missing = {operationId: randomUUID(), id: randomUUID(), providerPaymentId: randomUUID(), amount: '199.00'};
    await assert.rejects(rawRequest(client, missing), {code: '23514'});
    await assert.rejects(rawAnchor(client, missing.operationId), {code: '23514'});
  });
  await check('DB stamps request hash and both timestamps and forbids UPDATE DELETE TRUNCATE', async () => {
    const item = await reservation();
    await admin.query(`insert into app.payment_refund_requests(operation_id,idempotence_key,request_body,request_sha256,created_at)
      values($1,$2,$3,$4,'2001-01-01T00:00:00Z')`, [item.operationId, 'refund-' + item.operationId, canonical(item, item.operationId), '0'.repeat(64)]);
    const row = (await requestRows(item.operationId))[0];
    assert.equal(row.request_sha256, createHash('sha256').update(row.request_body).digest('hex'));
    assert.equal((await admin.query('select abs(extract(epoch from(created_at-clock_timestamp())))<5 as current from app.payment_refund_requests where operation_id=$1', [item.operationId])).rows[0].current, true);
    await admin.query("insert into app.payment_refund_dispatch_anchors(operation_id,authorized_at) values($1,'2001-01-01T00:00:00Z')", [item.operationId]);
    assert.equal((await admin.query('select abs(extract(epoch from(authorized_at-clock_timestamp())))<5 as current from app.payment_refund_dispatch_anchors where operation_id=$1', [item.operationId])).rows[0].current, true);
    for (const table of ['payment_refund_requests', 'payment_refund_dispatch_anchors']) {
      await assert.rejects(admin.query('update app.' + table + ' set operation_id=operation_id where operation_id=$1', [item.operationId]), {code: '23514'});
      await assert.rejects(admin.query('delete from app.' + table + ' where operation_id=$1', [item.operationId]), {code: '23514'});
      await assert.rejects(admin.query('truncate app.' + table + ' cascade'), {code: '23514'});
    }
  });
  await check('inherited original-body CHECK preserves metadata capture and currency even during owner trigger-bypass injection', async () => {
    for (const [needle, replacement] of [['id', 'other-id'], ['"capture":true', '"capture":false'], ['"currency":"RUB"', '"currency":"USD"']]) {
      const item = await reservation(), before = await history(item.id), from = needle === 'id' ? item.id : needle, to = needle === 'id' ? randomUUID() : replacement;
      await assert.rejects(inject('payment_checkout_intents', "update app.payment_checkout_intents set request_body=replace(request_body,$2,$3),request_sha256=encode(sha256(convert_to(replace(request_body,$2,$3),'UTF8')),'hex') where id=$1", [item.id, from, to]), {code: '23514'});
      assert.deepEqual(await history(item.id), before); expectPrepared(await store.prepare(item.operationId), item);
    }
  });
  await check('inherited order FK and schema36 guard exclude unsupported placement sources', async () => {
    const item = await reservation(), before = await history(item.id);
    await assert.rejects(inject('payment_checkout_intents', "update app.payment_checkout_intents set target_type='specialist',request_body=replace(request_body,'\"targetType\":\"listing\"','\"targetType\":\"specialist\"'),request_sha256=encode(sha256(convert_to(replace(request_body,'\"targetType\":\"listing\"','\"targetType\":\"specialist\"'),'UTF8')),'hex') where id=$1", [item.id]), {code: '23503'});
    assert.deepEqual(await history(item.id), before);
    for (const kind of ['specialist', 'application', 'fair_application', 'ad_marquee']) {
      const unsupported = await fixture({kind});
      await assert.rejects(admin.query('insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) values($1,$2,$3,$4,true,$5)', [randomUUID(), unsupported.id, unsupported.providerPaymentId, unsupported.shopId, unsupported.amount]), {code: '23514'});
    }
  });
  await check('source hash merchant TEST amount duration reservation and verification drift are refused by API and SQL', async () => {
    const variants = [
      ['payment_checkout_intents', item => ['update app.payment_checkout_intents set request_sha256=$2 where id=$1', [item.id, '0'.repeat(64)]]],
      ['payment_checkout_intents', item => ["update app.payment_checkout_intents set merchant_shop_id='other-shop' where id=$1", [item.id]]],
      ['payment_checkout_intents', item => ['update app.payment_checkout_intents set is_test=false where id=$1', [item.id]]],
      ['payment_checkout_intents', item => ["update app.payment_checkout_intents set amount=amount+1,request_body=replace(request_body,'199.00','200.00'),request_sha256=encode(sha256(convert_to(replace(request_body,'199.00','200.00'),'UTF8')),'hex') where id=$1", [item.id]]],
      ['payment_checkout_intents', item => ['update app.payment_checkout_intents set duration_days=null where id=$1', [item.id]]],
      ['payment_refund_reservations', item => ['update app.payment_refund_reservations set amount=amount+1 where id=$1', [item.operationId]]],
      ['payment_refund_reservations', item => ["update app.payment_refund_reservations set merchant_shop_id='other-shop' where id=$1", [item.operationId]]],
      ['payment_verifications', item => ['update app.payment_verifications set captured_at=null where intent_id=$1', [item.id]]],
      ['payment_verifications', item => ["update app.payment_verifications set status='pending',captured_at=null where intent_id=$1", [item.id]]]
    ];
    for (const [table, mutation] of variants) for (const existing of [false, true]) {
      const item = await reservation(); if (existing) await store.prepare(item.operationId);
      const [sql, values] = mutation(item); await inject(table, sql, values);
      await assert.rejects(store.prepare(item.operationId), RefundRequestError);
      await assert.rejects(store.openWindow(item.operationId), RefundRequestError);
      if (!existing) await assert.rejects(rawRequest(admin, item), {code: '23514'});
      else await assert.rejects(rawAnchor(admin, item.operationId), {code: '23514'});
      assert.deepEqual(await anchorRows(item.operationId), []); assert.equal((await requestRows(item.operationId)).length, existing ? 1 : 0);
    }
  });
  await check('prepared-request corruption is refused on recovery and on raw or API window admission', async () => {
    for (const mutation of [
      item => ['update app.payment_refund_requests set request_sha256=$2 where operation_id=$1', [item.operationId, '0'.repeat(64)]],
      item => ["update app.payment_refund_requests set request_body=request_body||' ',request_sha256=encode(sha256(convert_to(request_body||' ','UTF8')),'hex') where operation_id=$1", [item.operationId]],
      item => ["update app.payment_refund_requests set idempotence_key='refund-'||$2 where operation_id=$1", [item.operationId, randomUUID()]]
    ]) {
      const item = await reservation(); await store.prepare(item.operationId); const [sql, values] = mutation(item);
      await inject('payment_refund_requests', sql, values);
      await assert.rejects(store.prepare(item.operationId), RefundRequestError); await assert.rejects(store.openWindow(item.operationId), RefundRequestError);
      await assert.rejects(rawAnchor(admin, item.operationId), {code: '23514'}); assert.deepEqual(await anchorRows(item.operationId), []);
    }
  });
  await check('expired UNKNOWN window never resets anchor request bytes or idempotence key', async () => {
    const item = await reservation(), prepared = await store.prepare(item.operationId); await store.openWindow(item.operationId);
    await setAnchorAge(item.operationId, WINDOW_MS + 1000); const anchors = await anchorRows(item.operationId), requests = await requestRows(item.operationId);
    await assert.rejects(store.openWindow(item.operationId), RefundRequestError); await assert.rejects(store.openWindow(item.operationId), RefundRequestError);
    assert.deepEqual(await store.prepare(item.operationId), prepared); assert.deepEqual(await anchorRows(item.operationId), anchors); assert.deepEqual(await requestRows(item.operationId), requests);
  });
  await check('real user-row lock wait crosses deadline and cannot reopen an expired anchor', async () => {
    const item = await reservation(); await store.prepare(item.operationId); await store.openWindow(item.operationId);
    const blocker = await connection(), contender = await connection('refund_request_worker');
    await beginHeld(blocker); await blocker.query('select id from app.users where id=$1 for update', [item.ownerId]);
    await setAnchorAge(item.operationId, WINDOW_MS - 250); const before = await anchorRows(item.operationId);
    const pid = (await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
    const outcome = observe(new PostgresRefundRequestStore(txDatabase(contender), merchant).openWindow(item.operationId));
    try {
      await waitUntilBlocked(admin, pid);
      assert.match((await admin.query('select query from pg_stat_activity where pid=$1', [pid])).rows[0].query, /from app\.users/);
      await admin.query('select pg_sleep(0.35)');
    } finally { await commitHeld(blocker); }
    const settled = await outcome; assert.ok(Object.hasOwn(settled, 'error')); assert.equal(settled.error.name, 'RefundRequestError');
    assert.deepEqual(await anchorRows(item.operationId), before);
  });
  await check('COMMIT latency is subtracted with a local monotonic clock after transaction completion', async () => {
    const item = await reservation(); await store.prepare(item.operationId); await store.openWindow(item.operationId);
    await setAnchorAge(item.operationId, WINDOW_MS - 1500); const before = await anchorRows(item.operationId);
    const client = await connection('refund_request_worker'), held = heldTransaction(txDatabase(client));
    const future = observe(new PostgresRefundRequestStore(held.database, merchant).openWindow(item.operationId));
    try { unwrap(await Promise.race([held.prepared, future])); await admin.query('select pg_sleep(1.7)'); } finally { held.release(); }
    const settled = await future; assert.ok(Object.hasOwn(settled, 'error')); assert.equal(settled.error.name, 'RefundRequestError');
    assert.deepEqual(await anchorRows(item.operationId), before);
  });
  await check('rollback and actual successful COMMIT with lost acknowledgement retain one durable request and anchor', async () => {
    for (const method of ['prepare', 'openWindow']) {
      const rolled = await reservation(); if (method === 'openWindow') await store.prepare(rolled.operationId);
      const rollbackError = Error('Owned fixture rollback before COMMIT'); let rollbackAttempts = 0;
      const rollbackDb = {transaction: work => db.transaction(async tx => { rollbackAttempts++; await work(tx); throw rollbackError; })};
      await assert.rejects(new PostgresRefundRequestStore(rollbackDb, merchant)[method](rolled.operationId), error => error === rollbackError);
      assert.equal(rollbackAttempts, 1); assert.equal((await requestRows(rolled.operationId)).length, method === 'prepare' ? 0 : 1); assert.deepEqual(await anchorRows(rolled.operationId), []);
      const item = await reservation(); if (method === 'openWindow') await store.prepare(item.operationId);
      const client = await connection('refund_request_worker'), ackError = Error('Owned fixture COMMIT response unavailable'); let commitAttempts = 0, committed = false;
      const lostAck = {transaction: async work => {
        commitAttempts++; await client.query('begin');
        try { await work(client); } catch (error) { await client.query('rollback'); throw error; }
        await client.query('commit'); committed = true;
        // PostgreSQL executed COMMIT; this transaction boundary withholds its ACK.
        throw ackError;
      }};
      await assert.rejects(new PostgresRefundRequestStore(lostAck, merchant)[method](item.operationId), error => error === ackError);
      assert.equal(committed, true); assert.equal(commitAttempts, 1);
      const requests = await requestRows(item.operationId), anchors = await anchorRows(item.operationId);
      assert.equal(requests.length, 1); assert.equal(anchors.length, method === 'prepare' ? 0 : 1);
      const recovered = await store[method](item.operationId); expectPrepared(method === 'prepare' ? recovered : recovered.request, item);
      assert.deepEqual(await requestRows(item.operationId), requests); assert.deepEqual(await anchorRows(item.operationId), anchors);
    }
  });
  await check('raw PostgreSQL errors remain unwrapped and no automatic transaction retry occurs', async () => {
    const client = await connection('refund_request_worker'); let original, attempts = 0;
    const failing = {transaction: work => {
      attempts++;
      return txDatabase(client).transaction(tx => work({query: async () => {
        try { return await tx.query('select * from app.refund_fixture_missing_relation'); }
        catch (error) { original = error; throw error; }
      }}));
    }};
    const item = await reservation();
    await assert.rejects(new PostgresRefundRequestStore(failing, merchant).prepare(item.operationId), error => error === original && error.code === '42P01'); assert.equal(attempts, 1);
    attempts = 0; await assert.rejects(new PostgresRefundRequestStore(failing, merchant).openWindow(item.operationId), error => error === original && error.code === '42P01'); assert.equal(attempts, 1);
  });
  await check('raw request and anchor guards require READ COMMITTED with PBR02', async () => {
    const client = await connection('refund_request_worker');
    for (const isolation of ['repeatable read', 'serializable']) {
      const item = await reservation(); await client.query('begin isolation level ' + isolation);
      try { await assert.rejects(rawRequest(client, item), {code: 'PBR02'}); } finally { await client.query('rollback'); }
      await store.prepare(item.operationId); await client.query('begin isolation level ' + isolation);
      try { await assert.rejects(rawAnchor(client, item.operationId), {code: 'PBR02'}); } finally { await client.query('rollback'); }
      assert.deepEqual(await anchorRows(item.operationId), []);
    }
  });
  await check('raw SQL guard takes no user lock and rechecks order after an actual intent/order wait', async () => {
    const item = await reservation(), blocker = await connection(), client = await connection('refund_request_worker');
    await beginHeld(blocker); await blocker.query('select id from app.users where id=$1 for update', [item.ownerId]);
    try { await rawRequest(client, item); await rawAnchor(client, item.operationId); } finally { await commitHeld(blocker); }
    for (const relation of ['payment_checkout_intents', 'payment_orders']) for (const journal of ['request', 'anchor']) {
      const contender = await connection('refund_request_worker'), unsafe = await reservation();
      if (journal === 'anchor') await store.prepare(unsafe.operationId);
      await beginHeld(blocker); await blocker.query('select id from app.' + relation + ' where id=$1 for update', [unsafe.id]);
      const pid = (await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
      const future = observe(journal === 'request' ? rawRequest(contender, unsafe) : rawAnchor(contender, unsafe.operationId));
      try { await waitUntilBlocked(admin, pid); await blocker.query("update app.payment_orders set status='refunded' where id=$1", [unsafe.id]); }
      finally { await commitHeld(blocker); }
      const outcome = await future; assert.equal(outcome.error?.code, '23514'); assert.equal((await requestRows(unsafe.operationId)).length, journal === 'request' ? 0 : 1); assert.deepEqual(await anchorRows(unsafe.operationId), []);
    }
  });
  await check('minimal worker has only explicit source locks and inserts; web role gains no refund authority or PII', async () => {
    const client = await connection('refund_request_worker');
    for (const table of ['payment_refund_requests', 'payment_refund_dispatch_anchors']) {
      assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed", ['app.' + table])).rows[0].allowed, false);
      await assert.rejects(client.query('delete from app.' + table + ' where false'), {code: '42501'});
      await assert.rejects(client.query('truncate app.' + table), {code: '42501'});
      await assert.rejects(client.query('update app.' + table + ' set operation_id=operation_id where false'), {code: '42501'});
    }
    for (const column of ['email', 'password_hash']) await assert.rejects(client.query('select ' + column + ' from app.users limit 0'), {code: '42501'});
    for (const sql of ["update app.payment_orders set status='refunded' where false", 'update app.payment_checkout_intents set amount=1 where false',
      'update app.payment_verifications set captured_at=null where false', 'delete from app.payment_orders where false',
      'insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) select id,id,id,\'x\',true,1 from app.payment_orders where false',
      'insert into app.payment_fulfillments(intent_id,published_at,expires_at) select id,clock_timestamp(),clock_timestamp() from app.payment_orders where false',
      'insert into app.payment_provider_links(intent_id,provider_payment_id) select id,id from app.payment_orders where false',
      'insert into app.payment_refund_requests(operation_id,idempotence_key,request_body,request_sha256) values(null,null,null,null)',
      'insert into app.payment_refund_requests(operation_id,idempotence_key,request_body,created_at) values(null,null,null,clock_timestamp())',
      'insert into app.payment_refund_dispatch_anchors(operation_id,authorized_at) values(null,clock_timestamp())']) {
      await assert.rejects(client.query(sql), {code: '42501'});
    }
  });
  await check('schema36 actual fulfillment fence still rolls back publication after preparation and window', async () => {
    const item = await reservation(); await store.prepare(item.operationId); await store.openWindow(item.operationId);
    const fulfillment = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(database(), merchant);
    await assert.rejects(fulfillment.fulfill(item.id), {code: 'PBR01'});
    assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1', [item.targetId])).rows[0],
      {status: 'draft', is_paid: false, published_at: null, expires_at: null}); assert.equal((await history(item.id)).receipts, 0);
  });
  await check('nonempty down refuses destruction and preserves all request and anchor history', async () => {
    const before = (await admin.query('select (select count(*)::integer from app.payment_refund_requests) as requests,(select count(*)::integer from app.payment_refund_dispatch_anchors) as anchors')).rows[0];
    assert.ok(before.requests > 0 && before.anchors > 0);
    await assert.rejects(admin.query(down), {code: '23514'}); await admin.query('rollback');
    assert.deepEqual((await admin.query('select (select count(*)::integer from app.payment_refund_requests) as requests,(select count(*)::integer from app.payment_refund_dispatch_anchors) as anchors')).rows[0], before);
  });
  console.log(JSON.stringify({status: 'passed', checks, server: 'PostgreSQL18.6', providerNetwork: false, refundPOST: false, realCharges: false, productionTouched: false, fixture: 'owned disposable container'}));
} catch (error) { failure = error; throw error; } finally {
  for (const release of barriers) release();
  const releases = await Promise.allSettled([...manualTransactions].map(client => client.query('rollback')));
  const drained = await Promise.all([...pending]);
  const cleanup = await Promise.allSettled([...pools].map(pool => pool.close()).concat([...clients].map(async client => { try { await client.query('rollback'); } finally { await client.end(); } })));
  if (container) {
    const info = JSON.parse(await docker(['inspect', container]))[0];
    assert.equal(info.Id, container); assert.equal(info.Name, '/' + name); assert.equal(info.Config.Image, image); assert.equal(info.Config.Labels[label], name);
    await docker(['rm', '--force', container]);
  }
  const failures = [...releases, ...cleanup].filter(result => result.status === 'rejected').map(result => result.reason)
    .concat(drained.filter(result => Object.hasOwn(result, 'error')).map(result => result.error));
  if (failures.length) throw new AggregateError([...(failure ? [failure] : []), ...failures], 'Owned SQL fixture cleanup failed');
}
