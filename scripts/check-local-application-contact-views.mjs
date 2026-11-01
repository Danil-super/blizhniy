// Synthetic disposable PostgreSQL18. No manual stand, providers or remote DB.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import pg from 'pg';
import {bootstrapPostgres} from './bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';

assert.equal(process.argv.length, 2);
const envKeys = ['NODE_ENV', 'BLIZHNIY_LISTING_WORKFLOW', 'BLIZHNIY_LOCAL_PRIMARY', 'BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {NODE_ENV: 'test', BLIZHNIY_LISTING_WORKFLOW: 'postmoderation', BLIZHNIY_LOCAL_PRIMARY: 'enabled', BLIZHNIY_LOCAL_PRIMARY_ORIGIN: 'https://127.0.0.1:3045'});
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-contact-views-' + randomBytes(8).toString('hex'), label = 'blizhniy.contact-views-fixture', password = randomBytes(24).toString('hex');
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
const load = createRequire(import.meta.url)('./local-primary-modules.cjs').loadLocalPrimaryModule;
const policy = {localActions: true, contactViews: true, vacancyPostmoderation: false, specialistApplicationReady: true};
const snapshot = {name: 'Синтетический мастер', profession: 'Сантехник', price: '3500.00', skills: 'Ремонт и монтаж сантехники', about: 'Соблюдаю сроки и договорённости.', phone: '+79990000000', email: 'master@example.invalid', messengerUrl: 'https://t.me/synthetic_fixture'};
let container, admin, database, config, checks = 0;
const clients = new Set();
async function connection(role = 'postgres') { const client = new pg.Client({...config, user: role}); await client.connect(); clients.add(client); return client; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
async function account() {
  const id = (await admin.query('insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id',
    [`contacts-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`])).rows[0].id;
  const token = randomBytes(32).toString('hex');
  await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,0,'app')", [hashSessionToken(token), id]);
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)', [id, JSON.stringify({name: snapshot.name})]);
  return {id, token};
}
async function target(recipient, kind = 'workRequest') {
  const form = load('work-publication-contract').parseWorkPublicationForm(kind, {kind, title: 'Синтетический заказ для доказательства просмотра',
    description: 'Нужен ремонт сантехники и замена деталей.', cityName: 'Краснодар', professionName: 'Сантехник', contactPhone: '+79990000000',
    placementRightConfirmed: true, ...(kind === 'workRequest' ? {budget: '3500.00'} : {salary: '45000.00', employerType: 'person', organization: 'Иван'})});
  const id = (await admin.query(`insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,created_at,published_at,expires_at)
    select $1,$2,$3,$4::jsonb,c.id,p.id,'published',true,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days'
    from app.cities c cross join app.specialist_categories p where c.name='Краснодар' and p.name='Сантехник' limit 1 returning id`,
  [recipient.id, kind, randomUUID(), JSON.stringify(form)])).rows[0].id;
  await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())", [id]);
  return id;
}
async function application(recipient, applicant, status = 'sent', targetId, client = admin) {
  const work = targetId ?? await target(recipient), delivered = ['sent', 'viewed', 'selected', 'rejected'].includes(status), key = randomUUID();
  const id = (await client.query(`insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,message,status,is_paid,sent_at,created_at)
    values($1,$2,$3,1,1,$4::jsonb,'Синтетический отклик',$5,$6,case when $7 then clock_timestamp() else null end,clock_timestamp()-interval '1 minute') returning id`,
  [applicant.id, work, key, JSON.stringify(snapshot), status, status !== 'pending_payment', delivered])).rows[0].id;
  return {id, work, key};
}
async function evidence(id) { return (await admin.query('select recipient_id,evidence,recorded_at::text from app.application_contact_views where application_id=$1 order by evidence', [id])).rows; }
async function waitUntilBlocked(observer, pid) {
  const deadline = Date.now() + 3000;
  for (;;) { if ((await observer.query('select cardinality(pg_blocking_pids($1))>0 as waiting', [pid])).rows[0].waiting) return;
    assert.ok(Date.now() < deadline, 'Expected a real PostgreSQL lock wait'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function http(store, actor, id) {
  const origin = 'https://contacts.example.invalid';
  const handler = load('production-application-http').createProductionApplicationHandler({origin}, () => ({store, limiter: {allowProduction: async () => true}}), () => {});
  return handler(new Request(origin + '/api/account/applications', {method: 'POST', headers: {host: 'contacts.example.invalid', origin,
    'content-type': 'application/json', 'x-blizhniy-request': '1', 'x-real-ip': '192.0.2.121', cookie: '__Host-blizhniy_session=' + actor.token},
  body: JSON.stringify({action: 'read', expectedOwnerId: actor.id, applicationId: id})}));
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
  await admin.query(await readFile(new URL('../database/migrations/0030-application-withdrawals.sql', import.meta.url), 'utf8'));
  const recipient = await account(), applicant = await account(), foreign = await account();
  const legacy = await application(recipient, applicant);
  const writer = await connection(), observer = await connection(), targetId = await target(recipient);
  await writer.query('begin'); const inFlight = await application(recipient, applicant, 'sent', targetId, writer);
  const adminPid = (await admin.query('select pg_backend_pid() as pid')).rows[0].pid;
  const migration = admin.query(await readFile(new URL('../database/migrations/0035-application-contact-views.sql', import.meta.url), 'utf8'))
    .then(() => ({ok: true}), error => ({ok: false, error}));
  await waitUntilBlocked(observer, adminPid); await writer.query('commit'); const migrated = await migration;
  if (!migrated.ok) throw migrated.error;
  await check('migration locks delivery writers and backfills their just-committed outcome as legacy unknown', async () => {
    assert.equal((await evidence(inFlight.id))[0].evidence, 'legacy_unknown');
  });
  await admin.query(`create role contact_views_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to contact_views_runtime;
    grant select on app.users,app.sessions,app.cabinet_profiles,app.applications,app.work_publications,app.application_withdrawals,app.service_publications,
      app.cities,app.specialist_categories,app.work_moderation,app.service_moderation,app.media_objects,app.work_publication_photos,app.service_publication_photos,app.notifications to contact_views_runtime;
    grant update(id) on app.users,app.work_publications,app.service_publications to contact_views_runtime;
    grant update(last_seen_at) on app.sessions to contact_views_runtime;
    grant update(status,revision,updated_at) on app.applications to contact_views_runtime;
    grant insert on app.notifications to contact_views_runtime;
    grant insert(application_id,recipient_id) on app.application_contact_views to contact_views_runtime`);
  database = new PostgresDatabase(new pg.Pool({...config, user: 'contact_views_runtime', application_name: name + '-runtime', max: 4}));
  const store = new (load('postgres-applications').PostgresApplicationStore)(database, policy);
  await check('authorized recipient detail read durably records contact disclosure before returning snapshot', async () => {
    const item = await application(recipient, applicant); assert.deepEqual(await evidence(item.id), []);
    const result = await store.read(recipient.token, recipient.id, item.id);
    assert.equal(result.view, 'recipient'); assert.equal(result.snapshot.phone, snapshot.phone); assert.equal(result.snapshot.email, snapshot.email);
    const rows = await evidence(item.id); assert.equal(rows.length, 1); assert.equal(rows[0].evidence, 'recipient_read'); assert.equal(rows[0].recipient_id, recipient.id);
  });
  await check('migration preserves existing delivery as legacy unknown, never proof of unseen contacts', async () => {
    const rows = await evidence(legacy.id); assert.equal(rows.length, 1); assert.equal(rows[0].evidence, 'legacy_unknown');
    await store.read(recipient.token, recipient.id, legacy.id);
    const after = await evidence(legacy.id); assert.equal(after.length, 2); assert.deepEqual(after.find(row => row.evidence === 'legacy_unknown'), rows[0]);
  });
  await check('repeat and concurrent recipient reads preserve one immutable first disclosure timestamp', async () => {
    const item = await application(recipient, applicant); await store.read(recipient.token, recipient.id, item.id); const first = await evidence(item.id);
    await Promise.all(Array.from({length: 4}, () => store.read(recipient.token, recipient.id, item.id)));
    assert.deepEqual(await evidence(item.id), first);
    await assert.rejects(admin.query("update app.application_contact_views set recorded_at=clock_timestamp() where application_id=$1", [item.id]), {code: '23514'});
    await assert.rejects(admin.query('delete from app.application_contact_views where application_id=$1', [item.id]), {code: '23514'});
  });
  await check('applicant details, intent recovery, both summaries and successful preview do not count as recipient contact reads', async () => {
    const form = load('service-publication-contract').parseServicePublicationForm('specialist', {title: snapshot.name, description: snapshot.about,
      professionName: snapshot.profession, cityName: 'Краснодар', price: snapshot.price, skills: snapshot.skills, contactPhone: snapshot.phone, email: snapshot.email, placementRightConfirmed: true});
    await admin.query(`insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at)
      select $1,'specialist',$2,$3::jsonb,c.id,p.id,'published',true,clock_timestamp(),clock_timestamp()+interval '30 days'
      from app.cities c cross join app.specialist_categories p where c.name='Краснодар' and p.name='Сантехник' limit 1`, [applicant.id, randomUUID(), JSON.stringify(form)]);
    const item = await application(recipient, applicant);
    assert.equal((await store.read(applicant.token, applicant.id, item.id)).view, 'applicant');
    assert.equal((await store.readIntent(applicant.token, applicant.id, item.key)).id, item.id);
    assert.ok((await store.list(applicant.token, applicant.id, 'applicant', null)).items.some(row => row.id === item.id));
    const summary = await store.list(recipient.token, recipient.id, 'recipient', null); assert.ok(summary.items.some(row => row.id === item.id));
    assert.equal(JSON.stringify(summary).includes(snapshot.phone), false); assert.equal(JSON.stringify(summary).includes(snapshot.email), false);
    const preview = await store.preview(applicant.token, applicant.id, 'workRequest', item.work); assert.equal(preview.target.id, item.work);
    assert.deepEqual(await evidence(item.id), []);
  });
  await check('foreign, mismatched owner, unpaid and not-yet-sent details cannot disclose or write evidence', async () => {
    const item = await application(recipient, applicant);
    await assert.rejects(store.read(foreign.token, foreign.id, item.id), error => error.name === 'ApplicationAccessError');
    await assert.rejects(store.read(foreign.token, recipient.id, item.id), error => error.name === 'AppSessionAccessError');
    for (const state of ['pending_payment', 'paid']) {
      const hidden = await application(recipient, applicant, state);
      await assert.rejects(store.read(recipient.token, recipient.id, hidden.id), error => error.name === 'ApplicationAccessError');
      assert.deepEqual(await evidence(hidden.id), []);
    }
    assert.deepEqual(await evidence(item.id), []);
  });
  await check('actual applicant creation, exact intent replay and content update do not invent a recipient view', async () => {
    const trusted = {transaction: async work => { await admin.query('begin'); try { const result = await work(admin); await admin.query('commit'); return result; }
      catch (error) { await admin.query('rollback'); throw error; }}};
    const writer = new (load('postgres-applications').PostgresApplicationStore)(trusted, policy), work = await target(recipient);
    const preview = await writer.preview(applicant.token, applicant.id, 'workRequest', work);
    const input = {kind: 'workRequest', targetId: work, creationKey: randomUUID(), expectedTargetRevision: preview.target.revision,
      specialistId: preview.specialist.id, expectedSpecialistRevision: preview.specialist.revision, message: 'Смогу выполнить эту работу.'};
    const created = await writer.create(applicant.token, applicant.id, input);
    assert.equal(created.view, 'applicant'); assert.equal((await writer.create(applicant.token, applicant.id, input)).id, created.id);
    const edited = await writer.update(applicant.token, applicant.id, {applicationId: created.id, expectedRevision: created.revision,
      expectedTargetRevision: preview.target.revision, specialistId: preview.specialist.id, expectedSpecialistRevision: preview.specialist.revision, message: 'Смогу начать завтра.'});
    assert.equal(edited.view, 'applicant'); assert.equal(edited.message, 'Смогу начать завтра.'); assert.deepEqual(await evidence(created.id), []);
  });
  await check('revoked session and an expired session after resource wait cannot return contacts or commit a view', async () => {
    const revoked = await account(), item = await application(revoked, applicant);
    await admin.query('delete from app.sessions where token_hash=$1', [hashSessionToken(revoked.token)]);
    await assert.rejects(store.read(revoked.token, revoked.id, item.id), error => error.name === 'AppSessionAccessError'); assert.deepEqual(await evidence(item.id), []);
    const short = await account(), slow = await application(short, applicant), locking = await connection();
    await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '600 milliseconds' where token_hash=$1", [hashSessionToken(short.token)]);
    await locking.query('begin'); await locking.query('select id from app.work_publications where id=$1 for update', [slow.work]);
    const reading = store.read(short.token, short.id, slow.id).then(() => ({returned: true}), error => ({returned: false, name: error.name}));
    try {
      const deadline = Date.now() + 2000;
      for (;;) {
        const blocked = (await admin.query('select pid from pg_stat_activity where application_name=$1 and cardinality(pg_blocking_pids(pid))>0', [name + '-runtime'])).rows;
        if (blocked.length) break;
        assert.ok(Date.now() < deadline, 'Recipient read must actually wait on the held work lock before expiry');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => setTimeout(resolve, 800));
    } finally { await locking.query('commit'); }
    assert.deepEqual(await reading, {returned: false, name: 'AppSessionAccessError'}); assert.deepEqual(await evidence(slow.id), []);
  });
  await check('known contact-log database failure returns a generic HTTP error with no snapshot', async () => {
    const item = await application(recipient, applicant);
    await admin.query('revoke insert(application_id,recipient_id) on app.application_contact_views from contact_views_runtime');
    try {
      const response = await http(store, recipient, item.id); assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {error: {code: 'APPLICATIONS_UNAVAILABLE'}}); assert.equal(response.headers.get('cache-control'), 'no-store');
    } finally { await admin.query('grant insert(application_id,recipient_id) on app.application_contact_views to contact_views_runtime'); }
    assert.deepEqual(await evidence(item.id), []);
  });
  await check('failure after the contact-log insert rolls back the evidence before any HTTP contacts are returned', async () => {
    const item = await application(recipient, applicant);
    const failing = {transaction: work => database.transaction(tx => work({query: async (sql, values) => {
      const result = await tx.query(sql, values); if (/insert\s+into\s+app\.application_contact_views/i.test(sql)) throw Error('Synthetic failure after view insert'); return result;
    }}))};
    const response = await http(new (load('postgres-applications').PostgresApplicationStore)(failing, policy), recipient, item.id);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), {error: {code: 'APPLICATIONS_UNAVAILABLE'}}); assert.deepEqual(await evidence(item.id), []);
  });
  await check('lost COMMIT acknowledgement returns no contacts but preserves durable possible disclosure evidence', async () => {
    const item = await application(recipient, applicant); let attempts = 0;
    const uncertain = {transaction: async work => { attempts++; await database.transaction(work); throw Error('Synthetic lost COMMIT acknowledgement'); }};
    const response = await http(new (load('postgres-applications').PostgresApplicationStore)(uncertain, policy), recipient, item.id);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), {error: {code: 'APPLICATIONS_UNAVAILABLE'}}); assert.equal(attempts, 1);
    const first = await evidence(item.id); assert.equal(first.length, 1); assert.equal(first[0].evidence, 'recipient_read');
    assert.equal((await store.read(recipient.token, recipient.id, item.id)).snapshot.phone, snapshot.phone); assert.deepEqual(await evidence(item.id), first);
  });
  for (const decision of ['viewed', 'selected', 'rejected']) await check(`${decision} decision records disclosed contacts, including the idempotent return`, async () => {
    const item = await application(recipient, applicant);
    const result = await store.decide(recipient.token, recipient.id, item.id, '1', decision);
    assert.equal(result.status, decision); assert.equal(result.snapshot.phone, snapshot.phone);
    const first = await evidence(item.id); assert.equal(first.length, 1); assert.equal(first[0].evidence, 'recipient_read');
    assert.equal((await store.decide(recipient.token, recipient.id, item.id, '1', decision)).revision, result.revision); assert.deepEqual(await evidence(item.id), first);
  });
  await check('previously stored decision without a marker logs before an idempotent contact-bearing response', async () => {
    for (const state of ['viewed', 'selected', 'rejected']) {
      const item = await application(recipient, applicant, state);
      await admin.query('update app.applications set revision=2 where id=$1', [item.id]); assert.deepEqual(await evidence(item.id), []);
      const response = await store.decide(recipient.token, recipient.id, item.id, '1', state);
      assert.equal(response.revision, '2'); assert.equal(response.snapshot.phone, snapshot.phone); assert.equal((await evidence(item.id))[0].evidence, 'recipient_read');
    }
  });
  await check('same-state viewed decision without status change still logs its returned contacts', async () => {
    const item = await application(recipient, applicant, 'viewed'); assert.deepEqual(await evidence(item.id), []);
    const response = await store.decide(recipient.token, recipient.id, item.id, '1', 'viewed');
    assert.equal(response.revision, '1'); assert.equal(response.snapshot.email, snapshot.email); assert.equal((await evidence(item.id))[0].evidence, 'recipient_read');
  });
  await check('same-state decision return and old client viewed or selected updates preserve evidence too', async () => {
    for (const state of ['viewed', 'selected']) {
      const item = await application(recipient, applicant);
      await admin.query('update app.applications set status=$2,revision=revision+1 where id=$1', [item.id, state]);
      const first = await evidence(item.id); assert.equal(first.length, 1); assert.equal(first[0].evidence, 'recipient_read');
      if (state === 'viewed') assert.equal((await store.decide(recipient.token, recipient.id, item.id, '2', state)).status, state);
      assert.deepEqual(await evidence(item.id), first);
    }
  });
  await check('selecting another applicant never erases earlier contact viewing and does not invent a view for unseen rejected peers', async () => {
    const second = await account(), third = await account(), work = await target(recipient);
    const seen = await application(recipient, applicant, 'sent', work), chosen = await application(recipient, second, 'sent', work), unseen = await application(recipient, third, 'sent', work);
    await store.read(recipient.token, recipient.id, seen.id); const first = await evidence(seen.id);
    await store.decide(recipient.token, recipient.id, chosen.id, '1', 'selected');
    assert.deepEqual(await evidence(seen.id), first); assert.deepEqual(await evidence(unseen.id), []);
    assert.equal((await admin.query('select status from app.applications where id=$1', [seen.id])).rows[0].status, 'rejected');
  });
  await check('runtime has INSERT two columns only and cannot spoof binding, evidence, timestamp or mutate history', async () => {
    const client = await connection('contact_views_runtime'), item = await application(recipient, applicant), hidden = await application(recipient, applicant, 'pending_payment');
    assert.equal((await admin.query("select has_table_privilege('contact_views_runtime','app.application_contact_views','SELECT') as allowed")).rows[0].allowed, false);
    for (const sql of ['select * from app.application_contact_views limit 0', 'update app.application_contact_views set recipient_id=recipient_id where false', 'delete from app.application_contact_views where false',
      'select * from app.payment_orders limit 0', 'select * from app.payment_fulfillments limit 0']) await assert.rejects(client.query(sql), {code: '42501'});
    await assert.rejects(client.query("insert into app.application_contact_views(application_id,recipient_id,evidence) values($1,$2,'legacy_unknown')", [item.id, recipient.id]), {code: '42501'});
    await assert.rejects(client.query("insert into app.application_contact_views(application_id,recipient_id,recorded_at) values($1,$2,clock_timestamp()-interval '1 day')", [item.id, recipient.id]), {code: '42501'});
    await assert.rejects(client.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2)', [item.id, foreign.id]), {code: '23514'});
    await assert.rejects(client.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2)', [hidden.id, recipient.id]), {code: '23514'});
    assert.deepEqual(await evidence(item.id), []); assert.deepEqual(await evidence(hidden.id), []);
  });
  await check('unsafe contact-view composition is refused before exposing a read API', async () => {
    assert.throws(() => new (load('postgres-applications').PostgresApplicationStore)(database, {contactViews: true}), error => error.name === 'ApplicationAccessError');
  });
  console.log(JSON.stringify({status: 'passed', checks, providerNetwork: false, productionTouched: false, fixture: 'owned disposable PostgreSQL18.6'}));
} finally {
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const cleanup = await Promise.allSettled([...(database ? [database.close()] : []), ...[...clients].map(async client => { try { await client.query('rollback'); } finally { await client.end(); } })]);
  if (container) {
    const info = JSON.parse(await docker(['inspect', container]))[0];
    assert.equal(info.Id, container); assert.equal(info.Name, '/' + name); assert.equal(info.Config.Image, image); assert.equal(info.Config.Labels[label], name);
    await docker(['rm', '--force', container]);
  }
  const failures = cleanup.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned SQL fixture cleanup failed');
}
