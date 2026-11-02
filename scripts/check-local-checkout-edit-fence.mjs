// Synthetic, disposable PostgreSQL18 only. No manual stand, providers or remote DB.
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
import {hashSessionToken} from '../src/lib/identity.ts';

assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--before'), 'Optional --before reproduces the unfenced schema');
const before = process.argv[2] === '--before';
Object.assign(process.env, {NODE_ENV: 'test', BLIZHNIY_LOCAL_PRIMARY: 'enabled', BLIZHNIY_LOCAL_PRIMARY_ORIGIN: 'https://127.0.0.1:3045', BLIZHNIY_LISTING_WORKFLOW: 'postmoderation'});
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-checkout-edit-' + randomBytes(8).toString('hex'), label = 'blizhniy.checkout-edit-fixture';
const password = randomBytes(24).toString('hex');
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
let container, admin, database, config, owner, token, checks = 0;
const clients = new Set();
async function connection() { const client = new pg.Client(config); await client.connect(); clients.add(client); return client; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
function txDatabase(client) {
  return {transaction: async work => { await client.query('begin'); try { const result = await work(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; }}};
}
async function target(kind = 'listing', client = admin) {
  if (kind !== 'listing') return {kind, id: (await client.query(`insert into app.work_publications(author_id,kind,creation_key,form)
    values($1,$2,$3,$4::jsonb) returning id`, [owner, kind, randomUUID(), JSON.stringify({kind, title: 'Синтетическая работа'})])).rows[0].id};
  const id = (await client.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone)
    select $1,'sell',c.id,city.id,'Синтетическое объявление','Описание для проверки оплаты','+79990000000'
    from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id`, [owner])).rows[0].id;
  await client.query("insert into app.listing_moderation(listing_id,revision,state,decided_by,decided_at) values($1,1,'approved',$2,clock_timestamp())", [id, owner]);
  return {kind, id};
}
const table = item => item.kind === 'listing' ? 'app.listings' : 'app.work_publications';
async function prepare(item, status = 'created', fulfilled = false, client = admin, revision = '1', ownerId = owner) {
  const id = randomUUID(), tariff = item.kind === 'listing' ? 'listing-publication' : item.kind === 'vacancy' ? 'vacancy-publication' : 'work-request-publication';
  const binding = {id, ownerId, targetType: item.kind, targetId: item.id, targetRevision: revision, tariffId: tariff, amount: '199.00', durationDays: 30, shopId: 'fixture-shop', isTest: true};
  const requestBody = JSON.stringify({amount: {value: binding.amount, currency: 'RUB'}, capture: true,
    confirmation: {type: 'redirect', return_url: 'https://fixture.example.invalid/return'}, metadata: {localPaymentId: id, targetId: item.id, targetType: item.kind, tariffId: tariff}});
  const journal = new PostgresPaymentIntentStore({transaction: async work => work(client)});
  await journal.persistInTransaction(client, {...binding, requestBody});
  await client.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6)', [id, ownerId, randomUUID(), item.kind, item.id, revision]);
  if (status !== 'created') {
    if (status === 'refunded') await client.query("update app.payment_orders set status='succeeded' where id=$1", [id]);
    await client.query('update app.payment_orders set status=$2 where id=$1', [id, status]);
  }
  if (fulfilled) {
    const provider = randomUUID();
    await client.query('insert into app.payment_dispatch_anchors(intent_id) values($1)', [id]);
    await client.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)', [id, provider]);
    await client.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)", [id, provider, new Date().toISOString()]);
    await client.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,clock_timestamp(),clock_timestamp()+interval '30 days')", [id]);
  }
  return binding;
}
async function capture(binding) {
  const provider = randomUUID();
  await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)', [binding.id]);
  await admin.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)', [binding.id, provider]);
  await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)", [binding.id, provider, new Date().toISOString()]);
}
async function revision(item) { return (await admin.query(`select revision::text from ${table(item)} where id=$1`, [item.id])).rows[0].revision; }
async function financial(item) { return (await admin.query(`select o.id,o.status,o.target_revision::text,i.request_body,
  exists(select 1 from app.payment_fulfillments f where f.intent_id=o.id) as fulfilled
  from app.payment_orders o join app.payment_checkout_intents i on i.id=o.id where o.target_id=$1 order by o.id`, [item.id])).rows; }
async function waitUntilBlocked(pid) {
  const deadline = Date.now() + 3000;
  for (;;) {
    if ((await admin.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return;
    assert.ok(Date.now() < deadline, 'Concurrent writer must actually wait on the held row lock');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
try {
  container = await docker(['run', '--detach', '--pull', 'never', '--name', name, '--label', `${label}=${name}`, '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql:rw,size=268435456', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=blizhniy_test', image]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const inspect = JSON.parse(await docker(['inspect', container]))[0];
  assert.equal(inspect.Config.Labels[label], name); assert.equal(inspect.Config.Image, image);
  const port = inspect.NetworkSettings.Ports['5432/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1');
  config = {host: '127.0.0.1', port: Number(port.HostPort), database: 'blizhniy_test', user: 'postgres', password, statement_timeout: 8000};
  const deadline = Date.now() + 20000;
  for (;;) { try { await docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', config.database]); break; }
    catch { assert.ok(Date.now() < deadline, 'Owned PostgreSQL fixture failed to start'); await new Promise(resolve => setTimeout(resolve, 100)); }}
  admin = await connection(); assert.match((await admin.query('show server_version')).rows[0].server_version, /^18\.6/);
  await bootstrapPostgres(admin, '127.0.0.1:blizhniy_test', {includePaymentFulfillment: true});
  if (!before) await admin.query(await readFile(new URL('../database/migrations/0034-checkout-edit-fence.sql', import.meta.url), 'utf8'));
  owner = (await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    [`checkout-edit-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  token = randomBytes(32).toString('hex');
  await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')", [hashSessionToken(token), owner]);
  database = new PostgresDatabase(new pg.Pool({...config, max: 4}));

  for (const kind of ['listing', 'vacancy', 'workRequest']) {
    for (const status of ['created', 'pending', 'succeeded']) await check(`${kind}: ${status} blocks revision replacement without changing money or content`, async () => {
      const item = await target(kind); await prepare(item, status); const history = await financial(item);
      await assert.rejects(admin.query(`update ${table(item)} set revision=revision+1 where id=$1`, [item.id]), {code: 'PBL01'});
      assert.equal(await revision(item), '1'); assert.deepEqual(await financial(item), history);
    });
    for (const status of ['failed', 'refunded', 'fulfilled']) await check(`${kind}: ${status} permits a later content revision and preserves the payment history`, async () => {
      const item = await target(kind); await prepare(item, status === 'fulfilled' ? 'succeeded' : status, status === 'fulfilled');
      const history = await financial(item);
      assert.equal((await admin.query(`update ${table(item)} set revision=revision+1 where id=$1`, [item.id])).rowCount, 1);
      assert.equal(await revision(item), '2'); assert.deepEqual(await financial(item), history);
    });
  }
  await check('unrelated target and foreign owner orders cannot lock this draft', async () => {
    const item = await target(), other = await target(); await prepare(other);
    const foreign = (await admin.query('insert into app.users(email,password_hash) values($1,$2) returning id',
      [`foreign-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`])).rows[0].id;
    await prepare(item, 'created', false, admin, '1', foreign);
    await admin.query('update app.listings set revision=revision+1 where id=$1', [item.id]); assert.equal(await revision(item), '2');
  });
  for (const kind of ['listing', 'vacancy', 'workRequest']) await check(`${kind}: direct content mutation without revision is fenced`, async () => {
    const item = await target(kind); await prepare(item);
    const sql = kind === 'listing' ? "update app.listings set title='Новая версия без CAS' where id=$1" :
      "update app.work_publications set form=jsonb_set(form,'{title}','\"Новая версия без CAS\"'::jsonb) where id=$1";
    await assert.rejects(admin.query(sql, [item.id]), {code: 'PBL01'}); assert.equal(await revision(item), '1');
  });
  await check('pending checkout permits view counter and timestamp bookkeeping', async () => {
    for (const kind of ['listing', 'vacancy', 'workRequest']) {
      const item = await target(kind); await prepare(item); const history = await financial(item);
      const update = kind === 'listing' ? 'view_count=view_count+1,updated_at=clock_timestamp()' : 'updated_at=clock_timestamp()';
      assert.equal((await admin.query(`update ${table(item)} set ${update} where id=$1`, [item.id])).rowCount, 1);
      assert.equal(await revision(item), '1'); assert.deepEqual(await financial(item), history);
    }
  });
  await check('unresolved checkout also fences status changes and work deletion', async () => {
    for (const kind of ['listing', 'vacancy', 'workRequest']) {
      const item = await target(kind); await prepare(item);
      await assert.rejects(admin.query(`update ${table(item)} set status='archived' where id=$1`, [item.id]), {code: 'PBL01'});
      if (kind !== 'listing') await assert.rejects(admin.query('update app.work_publications set deleted_at=clock_timestamp() where id=$1', [item.id]), {code: 'PBL01'});
    }
  });
  await check('unknown dispatch and historical revision mismatch never release the active purchase', async () => {
    const item = await target();
    await admin.query('update app.listings set revision=2 where id=$1', [item.id]);
    const binding = await prepare(item, 'created', false, admin, '1');
    await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)', [binding.id]);
    assert.equal((await admin.query('select count(*)::integer as n from app.payment_provider_links where intent_id=$1', [binding.id])).rows[0].n, 0);
    await assert.rejects(admin.query('update app.listings set revision=revision+1 where id=$1', [item.id]), {code: 'PBL01'});
    assert.equal(await revision(item), '2'); assert.equal((await financial(item))[0].status, 'created');
  });
  await check('real full form and legacy core/photo writers all preserve a prepared listing', async () => {
    const item = await target(); await prepare(item);
    const forms = new (load('postgres-listing-form').PostgresListingFormStore)(database);
    const draft = await forms.read(token, owner, item.id);
    await assert.rejects(forms.update(token, owner, item.id, '1', {...draft.form, title: 'Запрещённая замена'}), {code: 'PBL01'});
    await assert.rejects(new (load('postgres-listing-drafts').PostgresListingDraftStore)(database).update(token, owner, item.id, '1', {kind: 'prodam', title: 'Другая замена'}), {code: 'PBL01'});
    const photo = new (load('postgres-listing-photos').PostgresListingPhotoStore)(database);
    await assert.rejects(photo.replace(token, owner, item.id, '1', []), {code: 'PBL01'});
    assert.deepEqual(await forms.read(token, owner, item.id), draft);
  });
  await check('runtime without financial SELECT can edit ordinary content, is fenced by checkout and gains no authority', async () => {
    await admin.query(`create role checkout_edit_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
      grant usage on schema app to checkout_edit_runtime;
      grant select on app.users,app.sessions,app.listings,app.work_publications,app.listing_photos,app.media_objects,app.categories,app.cities,app.tariffs,app.listing_moderation to checkout_edit_runtime;
      grant update(id) on app.users to checkout_edit_runtime;
      grant update(last_seen_at) on app.sessions to checkout_edit_runtime;
      grant update(listing_type,title,description,price,category_id,city_id,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking,revision,updated_at) on app.listings to checkout_edit_runtime;
      grant insert,delete on app.listing_photos to checkout_edit_runtime;
      grant update(form,revision,updated_at) on app.work_publications to checkout_edit_runtime`);
    const client = new pg.Client({...config, user: 'checkout_edit_runtime'}); await client.connect(); clients.add(client);
    const item = await target(), forms = new (load('postgres-listing-form').PostgresListingFormStore)(txDatabase(client));
    const snapshot = await forms.read(token, owner, item.id);
    assert.equal((await forms.update(token, owner, item.id, '1', {...snapshot.form, title: 'Обычная разрешённая правка'})).revision, '2');
    for (const kind of ['listing', 'vacancy', 'workRequest']) {
      const pending = await target(kind); await prepare(pending);
      await assert.rejects(client.query(`update ${table(pending)} set revision=revision+1 where id=$1`, [pending.id]), {code: 'PBL01'});
      assert.equal(await revision(pending), '1');
    }
    for (const name of ['app.payment_orders', 'app.payment_fulfillments']) {
      assert.equal((await admin.query('select has_table_privilege($1,$2,\'SELECT\') as allowed', ['checkout_edit_runtime', name])).rows[0].allowed, false);
      await assert.rejects(client.query(`select * from ${name} limit 0`), {code: '42501'});
    }
    assert.equal((await admin.query("select has_function_privilege('checkout_edit_runtime','app.guard_checkout_edit()','EXECUTE') as allowed")).rows[0].allowed, false);
    await assert.rejects(client.query("update app.payment_orders set status='succeeded' where false"), {code: '42501'});
    await assert.rejects(client.query('delete from app.payment_checkout_intents where false'), {code: '42501'});
    await assert.rejects(client.query('update app.listings set is_paid=true where false'), {code: '42501'});
    await assert.rejects(client.query("create or replace function app.guard_checkout_edit() returns trigger language plpgsql as $$begin return new;end$$"), {code: '42501'});
    await assert.rejects(client.query('alter function app.guard_checkout_edit() owner to checkout_edit_runtime'), {code: '42501'});
    await assert.rejects(client.query('alter table app.listings disable trigger listing_checkout_edit_fence'), {code: '42501'});
  });
  await check('authoritative successful payment still fulfills once and later edits preserve its historical receipt', async () => {
    const item = await target(), binding = await prepare(item, 'succeeded'); await capture(binding);
    const store = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(database, {shopId: 'fixture-shop', isTest: true});
    const result = await store.fulfill(binding.id); assert.equal(result.state, 'fulfilled');
    assert.deepEqual(await store.fulfill(binding.id), result);
    const history = await financial(item);
    await admin.query("update app.listings set title='Оплаченная новая редакция',revision=revision+1 where id=$1", [item.id]);
    assert.deepEqual(await financial(item), history);
    assert.equal((await admin.query('select count(*)::integer as n from app.payment_fulfillments where intent_id=$1', [binding.id])).rows[0].n, 1);
  });
  for (const kind of ['vacancy', 'workRequest']) await check(`${kind}: real paid fulfillment handles generated title, publishes once and keeps later edits available`, async () => {
    const forms = new (load('postgres-work-publications').PostgresWorkPublicationStore)(database);
    const common = {kind, title: 'Синтетическая оплаченная работа', description: 'Проверка исполнения оплаченной рабочей публикации.',
      cityName: 'Краснодар', professionName: 'Сантехник', contactPhone: '+79990000000', placementRightConfirmed: true};
    const fields = kind === 'vacancy' ? {salary: '45000.00', employerType: 'organization', organization: 'Мастерская', inn: '7707083893',
      ogrn: '1027700132195', contactPerson: 'Иван Иванов', email: 'hr@example.invalid'} : {budget: '3500.00'};
    const original = await forms.create(token, owner, kind, randomUUID(), {...common, ...fields});
    const item = {kind, id: original.id}, binding = await prepare(item, 'succeeded'); await capture(binding);
    const store = new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(database, {shopId: 'fixture-shop', isTest: true}, {postmoderation: true, targetType: kind});
    const result = await store.fulfill(binding.id); assert.equal(result.state, 'fulfilled');
    assert.deepEqual(await store.fulfill(binding.id), result);
    const placed = await forms.read(token, owner, kind, item.id); assert.equal(placed.status, 'published'); assert.equal(placed.paid, true);
    const history = await financial(item);
    const changed = await forms.update(token, owner, kind, item.id, placed.revision, {...placed.form, title: 'Обновлённая оплаченная работа'});
    assert.equal(changed.form.title, 'Обновлённая оплаченная работа'); assert.equal(changed.publishedAt, placed.publishedAt); assert.equal(changed.expiresAt, placed.expiresAt);
    assert.deepEqual(await financial(item), history);
    assert.equal((await admin.query('select count(*)::integer as n from app.payment_fulfillments where intent_id=$1', [binding.id])).rows[0].n, 1);
  });
  await check('photo deletion itself is fenced and rollback preserves the original photo', async () => {
    const item = await target();
    const media = (await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
      values($1,$2,'image/webp',2,2,12,$3) returning id`, [owner, randomUUID(), 'd'.repeat(64)])).rows[0].id;
    await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)', [item.id, media]); await prepare(item);
    const client = await connection(); await client.query('begin');
    try {
      await assert.rejects(client.query('delete from app.listing_photos where listing_id=$1', [item.id]), {code: 'PBL01'});
    } finally { await client.query('rollback'); }
    assert.equal((await admin.query('select media_id from app.listing_photos where listing_id=$1', [item.id])).rows[0].media_id, media);
  });
  for (const kind of ['listing', 'vacancy', 'workRequest']) await check(`${kind}: photo insert, replace, delete and cross-parent movement cannot bypass the fence`, async () => {
    const item = await target(kind), other = await target(kind);
    const photos = kind === 'listing' ? 'app.listing_photos' : 'app.work_publication_photos';
    const key = kind === 'listing' ? 'listing_id' : 'publication_id';
    const media = [];
    for (let index = 0; index < 2; index++) media.push((await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
      values($1,$2,'image/webp',2,2,12,$3) returning id`, [owner, randomUUID(), String(index + 1).repeat(64)])).rows[0].id);
    await admin.query(`insert into ${photos}(${key},media_id,position) values($1,$2,0),($3,$4,0)`, [item.id, media[0], other.id, media[1]]);
    await prepare(item);
    await assert.rejects(admin.query(`insert into ${photos}(${key},media_id,position) values($1,$2,1)`, [item.id, media[1]]), {code: 'PBL01'});
    await assert.rejects(admin.query(`update ${photos} set media_id=$2 where ${key}=$1`, [item.id, media[1]]), {code: 'PBL01'});
    await assert.rejects(admin.query(`delete from ${photos} where ${key}=$1`, [item.id]), {code: 'PBL01'});
    await assert.rejects(admin.query(`update ${photos} set ${key}=$2,position=1 where ${key}=$1`, [item.id, other.id]), {code: 'PBL01'});
    await assert.rejects(admin.query(`update ${photos} set ${key}=$2,position=1 where ${key}=$1`, [other.id, item.id]), {code: 'PBL01'});
    assert.deepEqual((await admin.query(`select media_id,position from ${photos} where ${key}=$1`, [item.id])).rows, [{media_id: media[0], position: 0}]);
  });
  await check('repeatable-read snapshot cannot hide a later prepared checkout from content or photo fence', async () => {
    const item = await target(), client = await connection();
    await client.query('begin isolation level repeatable read');
    await client.query('select revision from app.listings where id=$1', [item.id]);
    await prepare(item);
    try { await assert.rejects(client.query("update app.listings set title='Правка в старом снимке',revision=revision+1 where id=$1", [item.id]), {code: 'PBL02'}); }
    finally { await client.query('rollback'); }
    const media = (await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
      values($1,$2,'image/webp',2,2,12,$3) returning id`, [owner, randomUUID(), 'e'.repeat(64)])).rows[0].id;
    await client.query('begin isolation level repeatable read');
    try { await assert.rejects(client.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)', [item.id, media]), {code: 'PBL02'}); }
    finally { await client.query('rollback'); }
    assert.equal(await revision(item), '1');
  });
  await check('prepare commits while edit waits: post-wait trigger sees the newly committed order', async () => {
    const item = await target(), preparing = await connection(), editing = await connection();
    await preparing.query('begin'); await preparing.query('select id from app.listings where id=$1 for update', [item.id]);
    await prepare(item, 'created', false, preparing);
    await editing.query('begin'); const pid = (await editing.query('select pg_backend_pid() as pid')).rows[0].pid;
    const outcome = editing.query('update app.listings set revision=revision+1 where id=$1', [item.id]).then(() => ({ok: true}), error => ({ok: false, code: error.code}));
    await waitUntilBlocked(pid); await preparing.query('commit'); assert.deepEqual(await outcome, {ok: false, code: 'PBL01'}); await editing.query('rollback');
    assert.equal(await revision(item), '1'); assert.equal((await financial(item)).length, 1);
  });
  await check('edit commits while actual checkout waits: stale expected revision cannot create any order', async () => {
    const item = await target(), editing = await connection(), buying = await connection();
    await editing.query('begin'); await editing.query('update app.listings set revision=revision+1 where id=$1', [item.id]);
    const offer = (await admin.query("select id,price::text as amount,duration_days as days from app.tariffs where action='listing_publication'")).rows[0];
    const store = new (load('postgres-listing-checkout').PostgresListingCheckoutStore)(txDatabase(buying), {shopId: 'fixture-shop', isTest: true, siteOrigin: 'https://fixture.example.invalid', receiptVatCode: 1});
    const pid = (await buying.query('select pg_backend_pid() as pid')).rows[0].pid;
    const outcome = store.prepare(token, owner, {listingId: item.id, expectedRevision: '1', creationKey: randomUUID(), expectedTariffId: offer.id, expectedAmount: offer.amount, expectedDurationDays: offer.days})
      .then(() => ({ok: true}), error => ({ok: false, name: error.name}));
    await waitUntilBlocked(pid); await editing.query('commit'); assert.deepEqual(await outcome, {ok: false, name: 'ListingDraftConflictError'});
    assert.equal(await revision(item), '2'); assert.equal((await financial(item)).length, 0);
  });
  console.log(JSON.stringify({status: 'passed', checks, server: 'PostgreSQL18.6', providerNetwork: false, productionTouched: false, fixture: 'owned disposable container'}));
} finally {
  const cleanup = await Promise.allSettled([
    ...(database ? [database.close()] : []),
    ...[...clients].map(async client => { try { await client.query('rollback'); } finally { await client.end(); } }),
  ]);
  if (container) {
    const inspect = JSON.parse(await docker(['inspect', container]))[0];
    assert.equal(inspect.Id, container); assert.equal(inspect.Name, '/' + name); assert.equal(inspect.Config.Image, image); assert.equal(inspect.Config.Labels[label], name);
    await docker(['rm', '--force', container]);
  }
  const failures = cleanup.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned SQL fixture cleanup failed');
}
