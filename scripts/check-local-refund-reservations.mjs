// Disposable PostgreSQL18 acceptance only. No remote provider, refund POST,
// manual stand, production grants or real financial effects.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import pg from 'pg';
import {bootstrapPostgres} from './bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const {PostgresPlacementRefundReservationStore, PlacementRefundReservationError} = load('postgres-placement-refund-reservations');
assert.equal(typeof PostgresPlacementRefundReservationStore, 'function');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-reservation-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-reservation-fixture';
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
    [`refund-reservation-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
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
async function records(id) { return (await admin.query('select * from app.payment_refund_reservations where payment_intent_id=$1', [id])).rows; }
async function history(id) {
  return (await admin.query(`select o.status,i.amount::text,i.request_body,i.request_sha256,v.status as verified,v.captured_at,
    (select count(*)::integer from app.payment_fulfillments f where f.intent_id=i.id) as receipts
    from app.payment_checkout_intents i left join app.payment_orders o on o.id=i.id left join app.payment_verifications v on v.intent_id=i.id where i.id=$1`, [id])).rows[0];
}
async function raw(client, item, patch = {}) {
  const row = {id: randomUUID(), paymentIntentId: item.id, providerPaymentId: item.providerPaymentId, shopId: item.shopId, isTest: item.isTest, amount: item.amount, ...patch};
  return client.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount)
    values($1,$2,$3,$4,$5,$6)`, [row.id, row.paymentIntentId, row.providerPaymentId, row.shopId, row.isTest, row.amount]);
}
async function receipt(client, id) {
  return client.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,clock_timestamp(),clock_timestamp()+interval '30 days')", [id]);
}
async function waitUntilBlocked(observer, pid) {
  const deadline = Date.now() + 3000;
  for (;;) { if ((await observer.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return;
    assert.ok(Date.now() < deadline, 'Expected actual row-lock contention'); await new Promise(resolve => setTimeout(resolve, 20)); }
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
  const migration = await readFile(new URL('../database/migrations/0036-placement-refund-reservations.sql', import.meta.url), 'utf8');
  const down = await readFile(new URL('../database/migrations/0036-placement-refund-reservations.down.sql', import.meta.url), 'utf8');
  await admin.query(migration);
  await check('additive reservation schema has a safe empty down and can be reapplied', async () => {
    await admin.query(down); assert.equal((await admin.query("select to_regclass('app.payment_refund_reservations') as relation")).rows[0].relation, null); await admin.query(migration);
  });
  await admin.query(`create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    create role refund_reservation_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    create role receipt_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to refund_reservation_worker;
    grant select(id) on app.users to refund_reservation_worker;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_refund_reservations to refund_reservation_worker;
    grant update(id) on app.users,app.payment_checkout_intents,app.payment_orders to refund_reservation_worker;
    grant insert(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) on app.payment_refund_reservations to refund_reservation_worker;
    grant usage on schema app to receipt_worker;
    grant insert(intent_id,published_at,expires_at) on app.payment_fulfillments to receipt_worker`);
  db = database('refund_reservation_worker'); const store = new PostgresPlacementRefundReservationStore(db, merchant);
  await check('only the receipt fence is SECURITY DEFINER; both guards are volatile, fixed-path and not public executable', async () => {
    const functions = (await admin.query(`select p.proname,p.prosecdef,p.provolatile,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'
      and p.proname in ('guard_placement_refund_reservation','fence_refunded_payment_fulfillment') order by p.proname`)).rows;
    assert.equal(functions.length, 2);
    for (const row of functions) {
      assert.equal(row.prosecdef, row.proname === 'fence_refunded_payment_fulfillment'); assert.equal(row.provolatile, 'v');
      assert.deepEqual(row.proconfig, ['search_path=""']); assert.equal(row.public_execute, false);
    }
  });
  for (const kind of ['listing', 'vacancy', 'workRequest']) await check(`${kind}: one full TEST reservation freezes authoritative captured source without moving money`, async () => {
    const item = await fixture({kind}), before = await history(item.id), proposed = randomUUID(), result = await store.reserve(item.id, proposed);
    assert.deepEqual(Object.keys(result).sort(), ['id', 'paymentIntentId', 'providerPaymentId', 'amount', 'shopId', 'isTest', 'createdAt'].sort());
    assert.equal(result.id, proposed); assert.equal(result.paymentIntentId, item.id); assert.equal(result.providerPaymentId, item.providerPaymentId);
    assert.equal(result.amount, item.amount); assert.equal(result.shopId, item.shopId); assert.equal(result.isTest, true); assert.ok(Number.isFinite(Date.parse(result.createdAt)));
    assert.deepEqual(await history(item.id), before); assert.equal((await records(item.id)).length, 1);
    assert.deepEqual(await store.reserve(item.id, randomUUID()), result);
  });
  await check('concurrent retries adopt one proposed winner and retain its first timestamp', async () => {
    const item = await fixture(), ids = Array.from({length: 8}, () => randomUUID());
    const outcomes = (await Promise.all(ids.map(id => observe(store.reserve(item.id, id))))).map(unwrap);
    assert.ok(ids.includes(outcomes[0].id)); for (const result of outcomes) assert.deepEqual(result, outcomes[0]); assert.equal((await records(item.id)).length, 1);
  });
  await check('a proposed key bound to another payment is refused even if this payment already has its own reservation', async () => {
    const a = await fixture(), b = await fixture(), aKey = randomUUID(), bKey = randomUUID();
    await store.reserve(a.id, aKey); await assert.rejects(store.reserve(b.id, aKey), error => error.name === 'PlacementRefundReservationError' || error.code === '23505');
    assert.deepEqual(await records(b.id), []); await store.reserve(b.id, bKey);
    await assert.rejects(store.reserve(b.id, aKey), error => error.name === 'PlacementRefundReservationError');
    assert.equal((await records(b.id))[0].id, bKey);
  });
  await check('rollback and lost COMMIT acknowledgement do not create a second operation', async () => {
    const rolled = await fixture(), key = randomUUID();
    const failing = {transaction: work => db.transaction(async tx => { await work(tx); throw Error('Synthetic rollback'); })};
    await assert.rejects(new PostgresPlacementRefundReservationStore(failing, merchant).reserve(rolled.id, key), /Synthetic rollback/); assert.deepEqual(await records(rolled.id), []);
    const unknown = await fixture(), original = randomUUID(); let attempts = 0;
    const uncertain = {transaction: async work => { attempts++; await db.transaction(work); throw Error('Synthetic lost COMMIT acknowledgement'); }};
    await assert.rejects(new PostgresPlacementRefundReservationStore(uncertain, merchant).reserve(unknown.id, original), /Synthetic lost COMMIT acknowledgement/); assert.equal(attempts, 1);
    const recovered = await store.reserve(unknown.id, randomUUID()); assert.equal(recovered.id, original); assert.equal((await records(unknown.id)).length, 1);
  });
  await check('current target, tariff and account admission changes cannot rewrite the original full amount', async () => {
    const item = await fixture(); await admin.query('update app.users set is_blocked=true,email_verified_at=null where id=$1', [item.ownerId]);
    await admin.query("update app.listings set title='Изменённое содержимое',revision=revision+1 where id=$1", [item.targetId]);
    const offer = (await admin.query("select price,active from app.tariffs where id='listing-publication'")).rows[0];
    await admin.query("update app.tariffs set price=price+100,active=false where id='listing-publication'");
    try {
      assert.equal((await store.reserve(item.id, randomUUID())).amount, item.amount);
      await admin.query("update app.payment_orders set status='refunded' where id=$1", [item.id]);
      assert.equal((await store.reserve(item.id, randomUUID())).amount, item.amount);
    } finally { await admin.query("update app.tariffs set price=$1,active=$2 where id='listing-publication'", [offer.price, offer.active]); }
  });
  for (const options of [{orderStatus: 'created'}, {orderStatus: 'pending'}, {orderStatus: 'failed'}, {orderStatus: 'refunded'}, {verifiedStatus: 'pending'},
    {verifiedStatus: 'canceled'}, {capture: false}, {link: false}, {verification: false}, {order: false}, {shopId: 'foreign-shop'}, {isTest: false},
    {durationDays: null}, {kind: 'application', durationDays: null}, {kind: 'specialist'}, {kind: 'fair_application'}, {kind: 'ad_marquee'}]) {
    await check('unsafe original source is rejected: ' + JSON.stringify(options), async () => {
      const item = await fixture(options); await assert.rejects(store.reserve(item.id, randomUUID()), error => error.name === 'PlacementRefundReservationError'); assert.deepEqual(await records(item.id), []);
    });
  }
  await check('invalid identifiers and LIVE configuration never acquire financial authority', async () => {
    assert.throws(() => new PostgresPlacementRefundReservationStore(db, {...merchant, isTest: false}), PlacementRefundReservationError);
    await assert.rejects(store.reserve('invalid', randomUUID()), PlacementRefundReservationError); await assert.rejects(store.reserve(randomUUID(), 'invalid'), PlacementRefundReservationError);
  });
  await check('direct SQL enforces full amount, provider, merchant and TEST binding', async () => {
    const client = await connection('refund_reservation_worker');
    for (const patch of [{amount: '1.00'}, {amount: '199.01'}, {providerPaymentId: randomUUID()}, {shopId: 'other-shop'}, {isTest: false}]) {
      const item = await fixture(); await assert.rejects(raw(client, item, patch), {code: '23514'}); assert.deepEqual(await records(item.id), []);
    }
    for (const options of [{orderStatus: 'pending'}, {verifiedStatus: 'pending'}, {kind: 'application', durationDays: null}, {durationDays: null}, {isTest: false}]) {
      const item = await fixture(options); await assert.rejects(raw(client, item), {code: '23514'}); assert.deepEqual(await records(item.id), []);
    }
  });
  await check('timestamps are stamped by PostgreSQL and the journal cannot be changed or deleted', async () => {
    const item = await fixture(), key = randomUUID();
    await admin.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount,created_at)
      values($1,$2,$3,$4,true,$5,'2001-01-01T00:00:00Z')`, [key, item.id, item.providerPaymentId, item.shopId, item.amount]);
    assert.equal((await admin.query('select abs(extract(epoch from(created_at-clock_timestamp())))<5 as current from app.payment_refund_reservations where id=$1', [key])).rows[0].current, true);
    await assert.rejects(admin.query('update app.payment_refund_reservations set amount=amount where id=$1', [key]), {code: '23514'});
    await assert.rejects(admin.query('delete from app.payment_refund_reservations where id=$1', [key]), {code: '23514'});
    await assert.rejects(admin.query('truncate app.payment_refund_reservations'), {code: '23514'});
    assert.equal((await records(item.id))[0].id, key);
  });
  await check('original request hash corruption is rejected for first reserve, direct SQL and idempotent recovery', async () => {
    for (const existing of [false, true]) {
      const item = await fixture(); if (existing) await store.reserve(item.id, randomUUID());
      const original = (await admin.query('select request_sha256 from app.payment_checkout_intents where id=$1', [item.id])).rows[0].request_sha256;
      // Fault injection is confined to this disposable owner connection. The
      // production immutable trigger remains unchanged; runtime has no bypass.
      await admin.query('alter table app.payment_checkout_intents disable trigger payment_intent_immutable');
      try { await admin.query('update app.payment_checkout_intents set request_sha256=$2 where id=$1', [item.id, '0'.repeat(64)]); }
      finally { await admin.query('alter table app.payment_checkout_intents enable trigger payment_intent_immutable'); }
      try {
        await assert.rejects(store.reserve(item.id, randomUUID()), PlacementRefundReservationError);
        if (!existing) await assert.rejects(raw(admin, item), {code: '23514'});
      } finally {
        await admin.query('alter table app.payment_checkout_intents disable trigger payment_intent_immutable');
        try { await admin.query('update app.payment_checkout_intents set request_sha256=$2 where id=$1', [item.id, original]); }
        finally { await admin.query('alter table app.payment_checkout_intents enable trigger payment_intent_immutable'); }
      }
      assert.equal((await records(item.id)).length, existing ? 1 : 0);
    }
  });
  await check('reservation fences the actual fulfillment transaction and rolls back its target publication writes', async () => {
    const item = await fixture(); await store.reserve(item.id, randomUUID());
    const trusted = database(), fulfillment = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(trusted, merchant);
    await assert.rejects(fulfillment.fulfill(item.id), {code: 'PBR01'});
    const row = (await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1', [item.targetId])).rows[0];
    assert.deepEqual(row, {status: 'draft', is_paid: false, published_at: null, expires_at: null}); assert.equal((await history(item.id)).receipts, 0);
  });
  await check('an existing immutable fulfillment receipt is preserved when a refund reservation is later created', async () => {
    const client = await connection('receipt_worker');
    await assert.rejects(client.query('select * from app.payment_refund_reservations limit 0'), {code: '42501'});
    await assert.rejects(client.query('select * from app.payment_checkout_intents limit 0'), {code: '42501'});
    const item = await fixture(); await receipt(client, item.id); const before = await history(item.id); await store.reserve(item.id, randomUUID());
    assert.deepEqual(await history(item.id), before); assert.equal(before.receipts, 1);
  });
  await check('reservation wins while receipt insertion waits: the post-wait guard rejects publication', async () => {
    const item = await fixture(), reserving = await connection('refund_reservation_worker'), fulfilling = await connection('receipt_worker');
    await beginHeld(reserving); await raw(reserving, item);
    const pid = (await fulfilling.query('select pg_backend_pid() as pid')).rows[0].pid;
    const outcome = observe(receipt(fulfilling, item.id));
    await waitUntilBlocked(admin, pid); await commitHeld(reserving);
    const settled = await outcome;
    assert.deepEqual(Object.hasOwn(settled, 'error') ? {ok: false, code: settled.error.code} : {ok: true}, {ok: false, code: 'PBR01'}); assert.equal((await history(item.id)).receipts, 0);
  });
  await check('receipt wins before reservation: the historical receipt remains and one reservation is adopted', async () => {
    const item = await fixture(), fulfilling = await connection('receipt_worker'), reserving = await connection('refund_reservation_worker');
    await beginHeld(fulfilling); await receipt(fulfilling, item.id);
    const pid = (await reserving.query('select pg_backend_pid() as pid')).rows[0].pid;
    const future = observe(new PostgresPlacementRefundReservationStore(txDatabase(reserving), merchant).reserve(item.id, randomUUID()));
    await waitUntilBlocked(admin, pid); await commitHeld(fulfilling); unwrap(await future);
    assert.equal((await history(item.id)).receipts, 1); assert.equal((await records(item.id)).length, 1);
  });
  await check('actual reservation transaction wins user lock; real fulfillment waits then rolls back publication on PBR01', async () => {
    const item = await fixture(), reserving = await connection('refund_reservation_worker'), fulfilling = await connection();
    const held = heldTransaction(txDatabase(reserving));
    const first = observe(new PostgresPlacementRefundReservationStore(held.database, merchant).reserve(item.id, randomUUID()));
    unwrap(await Promise.race([held.prepared, first]));
    const pid = (await fulfilling.query('select pg_backend_pid() as pid')).rows[0].pid;
    const store = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(txDatabase(fulfilling), merchant);
    const second = observe(store.fulfill(item.id));
    try {
      await waitUntilBlocked(admin, pid);
      assert.match((await admin.query('select query from pg_stat_activity where pid=$1', [pid])).rows[0].query, /from app\.users/);
    } finally { held.release(); }
    unwrap(await first); const settled = await second;
    assert.deepEqual(Object.hasOwn(settled, 'error') ? {code: settled.error.code} : {value: settled.value}, {code: 'PBR01'}); assert.equal((await history(item.id)).receipts, 0);
    assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1', [item.targetId])).rows[0],
      {status: 'draft', is_paid: false, published_at: null, expires_at: null});
  });
  await check('actual fulfillment transaction wins user lock; reservation waits and preserves its one historical period', async () => {
    const item = await fixture(), fulfilling = await connection(), reserving = await connection('refund_reservation_worker');
    const held = heldTransaction(txDatabase(fulfilling));
    const fulfillment = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(held.database, merchant);
    const first = observe(fulfillment.fulfill(item.id)); const expected = unwrap(await Promise.race([held.prepared, first])); assert.equal(expected.state, 'fulfilled');
    const pid = (await reserving.query('select pg_backend_pid() as pid')).rows[0].pid;
    const second = observe(new PostgresPlacementRefundReservationStore(txDatabase(reserving), merchant).reserve(item.id, randomUUID()));
    try {
      await waitUntilBlocked(admin, pid);
      assert.match((await admin.query('select query from pg_stat_activity where pid=$1', [pid])).rows[0].query, /from app\.users/);
    } finally { held.release(); }
    assert.deepEqual(unwrap(await first), expected); unwrap(await second);
    const historyBefore = await history(item.id), periodBefore = (await admin.query('select published_at,expires_at from app.payment_fulfillments where intent_id=$1', [item.id])).rows;
    assert.equal(historyBefore.receipts, 1); assert.equal((await records(item.id)).length, 1);
    assert.deepEqual(await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(database(), merchant).fulfill(item.id), expected);
    assert.deepEqual(await history(item.id), historyBefore); assert.deepEqual((await admin.query('select published_at,expires_at from app.payment_fulfillments where intent_id=$1', [item.id])).rows, periodBefore);
  });
  await check('repeatable-read and serializable cannot hide a reservation from receipt admission', async () => {
    for (const isolation of ['repeatable read', 'serializable']) {
      const item = await fixture(), client = await connection(); await client.query('begin isolation level ' + isolation);
      try { await assert.rejects(raw(client, item), {code: 'PBR02'}); } finally { await client.query('rollback'); }
      await client.query('begin isolation level ' + isolation);
      try { await assert.rejects(receipt(client, item.id), {code: 'PBR02'}); } finally { await client.query('rollback'); }
      assert.deepEqual(await records(item.id), []); assert.equal((await history(item.id)).receipts, 0);
    }
  });
  await check('web role gains nothing and the isolated reservation worker cannot change financial truth', async () => {
    assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_refund_reservations','SELECT,INSERT,UPDATE,DELETE') as allowed")).rows[0].allowed, false);
    const client = await connection('refund_reservation_worker');
    await assert.rejects(client.query('select email from app.users limit 0'), {code: '42501'});
    await assert.rejects(client.query('select password_hash from app.users limit 0'), {code: '42501'});
    await assert.rejects(client.query('truncate app.payment_refund_reservations'), {code: '42501'});
    const item = await fixture();
    await assert.rejects(client.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount,created_at)
      values($1,$2,$3,$4,true,$5,clock_timestamp())`, [randomUUID(), item.id, item.providerPaymentId, item.shopId, item.amount]), {code: '42501'});
    for (const sql of ["update app.payment_orders set status='refunded' where false", 'update app.payment_checkout_intents set amount=1 where false',
      'delete from app.payment_orders where false', 'update app.payment_refund_reservations set amount=1 where false', 'delete from app.payment_refund_reservations where false',
      'insert into app.payment_fulfillments(intent_id,published_at,expires_at) select id,clock_timestamp(),clock_timestamp() from app.payment_orders where false']) {
      await assert.rejects(client.query(sql), {code: '42501'});
    }
  });
  await check('down migration refuses a nonempty reservation journal and retains every operation', async () => {
    const before = (await admin.query('select count(*)::integer as n from app.payment_refund_reservations')).rows[0].n; assert.ok(before > 0);
    await assert.rejects(admin.query(down), {code: '23514'}); await admin.query('rollback');
    assert.equal((await admin.query('select count(*)::integer as n from app.payment_refund_reservations')).rows[0].n, before);
  });
  console.log(JSON.stringify({status: 'passed', checks, server: 'PostgreSQL18.6', providerNetwork: false, refundPOST: false, realCharges: false, productionTouched: false, fixture: 'owned disposable container'}));
} catch (error) { failure = error; throw error; } finally {
  for (const release of barriers) release();
  // Release explicit SQL lock holders before draining their observed peers.
  // Do not race ROLLBACK/end() against a still-running repository transaction.
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
