// Owned disposable PG18.6 only. Every provider GET and POST is an in-process fixture.
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
const {PostgresRefundDispatchStore} = load('postgres-refund-dispatch');
const {createPrimaryRefundDispatcher} = load('primary-refund-dispatch');
const {parseWorkPublicationForm} = load('work-publication-contract');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-dispatch-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-dispatch-fixture';
const password = randomBytes(24).toString('hex'), merchant = {shopId: 'dispatch-fixture', isTest: true, secretKey: 'test_fixture'};
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024})).stdout.trim();
let container, admin, config, db, ownerDb, checks = 0, phoneSequence = 0;
const clients = new Set(), pools = new Set(), pending = new Set(), transactions = new Set();
async function connection(role = 'postgres') { const c = new pg.Client({...config, user: role}); await c.connect(); clients.add(c); return c; }
function database(role = 'dispatch_worker') { const d = new PostgresDatabase(new pg.Pool({...config, user: role, max: 6})); pools.add(d); return d; }
async function check(title, work) { await work(); checks++; console.log(JSON.stringify({check: title, status: 'passed'})); }
function observe(work) { const p = Promise.resolve(work).then(value => ({value}), error => ({error})); pending.add(p); p.then(() => pending.delete(p)); return p; }
function txDatabase(client) { return {transaction: async work => { await client.query('begin'); try { const value = await work(client); await client.query('commit'); return value; } catch (error) { await client.query('rollback'); throw error; } }}; }
async function begin(client) { await client.query('begin'); transactions.add(client); }
async function commit(client) { await client.query('commit'); transactions.delete(client); }
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
function provider(item, options = {}) {
  const calls = []; let posts = 0;
  const payment = () => ({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},paid:true,refundable:true,status:'succeeded',test:true,recipient:{account_id:merchant.shopId},captured_at:item.capturedAt,metadata:item.metadata,...options.paymentPatch});
  const refund = () => ({id:item.providerRefundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:options.status ?? 'pending',created_at:item.createdAt,metadata:{localRefundId:item.operationId,localPaymentId:item.id},...options.refundPatch});
  return {calls,fetch:async(url,init)=>{
    url=String(url);calls.push({url,init});assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`);
    assert.ok(init.signal instanceof AbortSignal);
    if(options.hold)await options.hold(url,init);
    if(init.method==='POST'){
      posts++;assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+item.operationId);
      assert.equal(init.body,JSON.stringify({payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},metadata:{localRefundId:item.operationId,localPaymentId:item.id}}));
      if(options.post) return options.post(posts,refund());return Response.json(refund());
    }
    assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers['Idempotence-Key'],undefined);
    if(url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json(payment());
    if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
    assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+item.providerRefundId);
    if(options.readbackFailure)return Response.json({description:'fixture failure'},{status:400});
    return Response.json(refund());
  }};
}
function store(item,options={},storage=db){const fake=provider(item,options);return {fake,dispatcher:createPrimaryRefundDispatcher(storage,merchant,fake.fetch)};}
async function preparedOnly(options={}){const item=await fixture(options);await new PostgresRefundRequestStore(ownerDb,merchant).prepare(item.operationId);return item;}
async function dispatchRows(item){return (await admin.query(`select (select count(*)::integer from app.payment_refund_send_attempts where operation_id=$1) as attempts,(select count(*)::integer from app.payment_refund_candidates where operation_id=$1) as candidates,(select count(*)::integer from app.payment_refund_dispatch_anchors where operation_id=$1) as anchors`,[item.operationId])).rows[0];}
async function rows(item) { return {links: (await admin.query('select * from app.payment_refund_provider_links where operation_id=$1', [item.operationId])).rows, observations: (await admin.query('select * from app.payment_refund_observations where operation_id=$1 order by status', [item.operationId])).rows}; }
async function financial(item) { return (await admin.query(`select i.request_body,i.request_sha256,i.amount::text,o.status,v.status as verified,v.captured_at,
  (select count(*)::integer from app.payment_fulfillments f where f.intent_id=i.id) as receipts,
  (select row_to_json(t) from (select status,is_paid,published_at,expires_at from app.${item.targetType === 'listing' ? 'listings' : 'work_publications'} where id=$1::uuid) t) as target
  from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id join app.payment_verifications v on v.intent_id=i.id where i.id=$2`, [item.targetId, item.id])).rows[0]; }
function expected(item, status = 'pending') { return {operationId: item.operationId, paymentIntentId: item.id, providerRefundId: item.providerRefundId, providerPaymentId: item.providerPaymentId, amount: item.amount, currency: 'RUB', status, createdAt: item.createdAt}; }
async function inject(table, sql, values) {
  assert.ok(['payment_checkout_intents','payment_orders','payment_verifications','payment_refund_reservations','payment_refund_requests','payment_refund_dispatch_anchors','payment_refund_observations','payment_refund_send_attempts','payment_refund_candidates'].includes(table));
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
  for (const name of ['0036-placement-refund-reservations.sql','0037-refund-requests.sql','0038-refund-journal.sql','0039-refund-dispatch.sql']) { const source = await readFile(new URL('../database/migrations/' + name, import.meta.url), 'utf8'); extras.push({name, source, sha256: createHash('sha256').update(source).digest('hex')}); }
  await bootstrapPostgres(admin, '127.0.0.1:blizhniy_test', {includeListingContactMethod: true});
  await txDatabase(admin).transaction(async tx => { for (const migration of extras) { await tx.query(withoutTransaction(migration.source)); await tx.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)', [migration.name, migration.sha256]); } });
  const migration=extras.at(-1).source,down=await readFile(new URL('../database/migrations/0039-refund-dispatch.down.sql',import.meta.url),'utf8');
  await check('all 39 exact migration hashes compose; empty down preserves journal and reapplies',async()=>{
    const expected=[...getBootstrapPlan({includeListingContactMethod:true}),...extras].map(({name,sha256})=>({name,sha256}));assert.equal(expected.length,39);
    assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,expected);
    await admin.query(down);assert.deepEqual((await admin.query("select to_regclass('app.payment_refund_send_attempts') as attempts,to_regclass('app.payment_refund_candidates') as candidates,to_regclass('app.payment_refund_observations') is not null as journal")).rows[0],{attempts:null,candidates:null,journal:true});await admin.query(migration);
  });
  await admin.query(`create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    create role dispatch_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to dispatch_worker;
    grant select(id),update(id) on app.users to dispatch_worker;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_refund_provider_links,app.payment_refund_observations,app.payment_refund_send_attempts,app.payment_refund_candidates to dispatch_worker;
    grant update(id) on app.payment_checkout_intents,app.payment_orders to dispatch_worker;
    grant insert(operation_id) on app.payment_refund_dispatch_anchors to dispatch_worker;
    grant insert(id,operation_id) on app.payment_refund_send_attempts to dispatch_worker;
    grant insert(operation_id,attempt_id,provider_refund_id) on app.payment_refund_candidates to dispatch_worker;
    grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to dispatch_worker;
    grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to dispatch_worker`);
  db=database();ownerDb=database('postgres');
  const trusted=new PostgresRefundDispatchStore(db,merchant);
  for(const kind of ['listing','vacancy','workRequest'])await check(kind+': complete inspection POST and journal GET leave financial and service state unchanged',async()=>{
    const item=await preparedOnly({kind}),before=await financial(item),attempt=store(item);let authorized=0;
    assert.deepEqual(await dispatchRows(item),{attempts:0,candidates:0,anchors:0});
    assert.deepEqual(await attempt.dispatcher.dispatch(item.operationId,async()=>{authorized++;}),expected(item));
    assert.deepEqual(attempt.fake.calls.map(c=>c.init.method),['GET','GET','GET','POST','GET','GET']);assert.equal(authorized,1);
    assert.deepEqual(await dispatchRows(item),{attempts:1,candidates:1,anchors:1});assert.deepEqual(await financial(item),before);
    assert.deepEqual(await store(item,{status:'succeeded'}).dispatcher.dispatch(item.operationId,async()=>{throw Error('recovery must not request POST authorization');}),expected(item,'succeeded'));
    assert.equal((await rows(item)).observations.length,2);assert.deepEqual(await financial(item),before);
  });
  await check('unknown network outcome consumes three durable attempts; next dispatch skips balance inspection and keeps exact original key and bytes',async()=>{
    const item=await preparedOnly(),before=await financial(item),first=store(item,{post:()=>{throw Error('synthetic private transport error');}});let authorization=0;
    await assert.rejects(first.dispatcher.dispatch(item.operationId,async()=>{authorization++;}));assert.equal(authorization,3);
    assert.deepEqual(first.fake.calls.map(c=>c.init.method),['GET','GET','GET','POST','POST','POST']);assert.deepEqual(await dispatchRows(item),{attempts:3,candidates:0,anchors:1});
    const retry=store(item);assert.deepEqual(await retry.dispatcher.dispatch(item.operationId,async()=>{authorization++;}),expected(item));
    assert.deepEqual(retry.fake.calls.map(c=>c.init.method),['POST','GET','GET']);assert.equal(authorization,4);assert.deepEqual(await financial(item),before);
  });
  await check('candidate persists before failed readback; expired refunded order recovers with GET only',async()=>{
    const item=await preparedOnly(),first=store(item,{readbackFailure:true});await assert.rejects(first.dispatcher.dispatch(item.operationId,async()=>{}));
    assert.deepEqual(await dispatchRows(item),{attempts:1,candidates:1,anchors:1});assert.deepEqual(await rows(item),{links:[],observations:[]});
    await inject('payment_refund_dispatch_anchors',"update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '2 days' where operation_id=$1",[item.operationId]);
    await admin.query("update app.payment_orders set status='refunded' where id=$1",[item.id]);
    const recovered=store(item);assert.deepEqual(await recovered.dispatcher.dispatch(item.operationId,async()=>{throw Error('no POST permission during recovery');}),expected(item));
    assert.deepEqual(recovered.fake.calls.map(c=>c.init.method),['GET','GET']);assert.deepEqual(await dispatchRows(item),{attempts:1,candidates:1,anchors:1});
  });
  await check('every POST retry is authorized after commit and callback failure leaves durable attempt without network',async()=>{
    const item=await preparedOnly(),attempt=store(item);let seen=0;
    await assert.rejects(attempt.dispatcher.dispatch(item.operationId,async()=>{seen++;assert.equal((await dispatchRows(item)).attempts,1);const lock=await connection();try{await lock.query("set lock_timeout='500ms'");await lock.query('begin');await lock.query('select id from app.users where id=$1 for update',[item.ownerId]);await lock.query('select id from app.payment_checkout_intents where id=$1 for update',[item.id]);await lock.query('select id from app.payment_orders where id=$1 for update',[item.id]);await lock.query('rollback');}finally{await lock.end();clients.delete(lock);}throw Error('revoked');}));
    assert.equal(seen,1);assert.equal(attempt.fake.calls.filter(c=>c.init.method==='POST').length,0);assert.deepEqual(await dispatchRows(item),{attempts:1,candidates:0,anchors:1});
    const retry=store(item,{post:(n,value)=>n===1?Response.json({},{status:503}):Response.json(value)});let count=0;
    await retry.dispatcher.dispatch(item.operationId,async()=>{count++;assert.equal((await dispatchRows(item)).attempts,1+count);});assert.equal(count,2);assert.equal(retry.fake.calls.filter(c=>c.init.method==='POST').length,2);
  });
  await check('competing authorizations serialize one anchor and each POST gets its own immutable durable attempt',async()=>{
    const item=await preparedOnly(),before=await financial(item),shared=provider(item),first=createPrimaryRefundDispatcher(db,merchant,shared.fetch),second=createPrimaryRefundDispatcher(db,merchant,shared.fetch);
    const result=await Promise.all([first.dispatch(item.operationId,async()=>{}),second.dispatch(item.operationId,async()=>{})]);for(const value of result)assert.deepEqual(value,expected(item));
    const saved=await dispatchRows(item),posts=shared.calls.filter(c=>c.init.method==='POST');assert.equal(saved.anchors,1);assert.equal(saved.candidates,1);assert.ok(saved.attempts>=1&&saved.attempts<=2);assert.equal(saved.attempts,posts.length);assert.deepEqual(await financial(item),before);
  });
  await check('late candidate response survives expired window; different attempt or changed full source cannot bind',async()=>{
    const item=await preparedOnly(),authorized=await trusted.authorize(item.operationId,randomUUID());assert.equal(authorized.decision,'post');
    const other=await preparedOnly(),otherAuthorized=await trusted.authorize(other.operationId,randomUUID());
    await assert.rejects(trusted.bindCandidate(item.operationId,otherAuthorized.attemptId,item.providerRefundId,authorized.known));
    await assert.rejects(trusted.bindCandidate(item.operationId,authorized.attemptId,item.providerRefundId,{...authorized.known,paymentCapturedAt:new Date().toISOString()}));
    await inject('payment_refund_dispatch_anchors',"update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '2 days' where operation_id=$1",[item.operationId]);
    await trusted.bindCandidate(item.operationId,authorized.attemptId,item.providerRefundId,authorized.known);
    const recover=await trusted.authorize(item.operationId,randomUUID());assert.equal(recover.decision,'recover');assert.equal(recover.known.candidateId,item.providerRefundId);assert.equal((await dispatchRows(item)).attempts,1);
    await assert.rejects(trusted.bindCandidate(item.operationId,authorized.attemptId,randomUUID(),authorized.known));
  });
  await check('expired window refuses send and lifetime maximum is twelve attempts, even across fresh dispatcher calls',async()=>{
    const expired=await prepared();await inject('payment_refund_dispatch_anchors',"update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '2 days' where operation_id=$1",[expired.operationId]);await assert.rejects(trusted.authorize(expired.operationId,randomUUID()));assert.equal((await dispatchRows(expired)).attempts,0);
    const item=await preparedOnly(),sameAttempt=randomUUID();assert.equal((await trusted.authorize(item.operationId,sameAttempt)).decision,'post');await assert.rejects(trusted.authorize(item.operationId,sameAttempt));assert.equal((await dispatchRows(item)).attempts,1);for(let i=1;i<12;i++)assert.equal((await trusted.authorize(item.operationId,randomUUID())).decision,'post');await assert.rejects(trusted.authorize(item.operationId,randomUUID()));await assert.rejects(trusted.authorize(item.operationId,sameAttempt));assert.deepEqual(await dispatchRows(item),{attempts:12,candidates:0,anchors:1});
    const attempt=store(item);await assert.rejects(attempt.dispatcher.dispatch(item.operationId,async()=>{}));assert.equal(attempt.fake.calls.length,0);
    await assert.rejects(admin.query('insert into app.payment_refund_send_attempts(id,operation_id) values($1,$2)',[randomUUID(),item.operationId]),{code:'23514'});
  });
  await check('preexisting journal identity without send candidate is GET-only recovery',async()=>{
    const item=await prepared();await admin.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)',[item.operationId,item.providerRefundId]);
    await admin.query("insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at) values($1,$2,'pending',$3)",[item.operationId,item.providerRefundId,item.createdAt]);
    const attempt=store(item);assert.deepEqual(await attempt.dispatcher.dispatch(item.operationId,async()=>{throw Error('known 38 identity needs no POST permission');}),expected(item));assert.deepEqual(attempt.fake.calls.map(c=>c.init.method),['GET','GET']);assert.deepEqual(await dispatchRows(item),{attempts:0,candidates:0,anchors:1});
  });
  await check('journal and candidate identities cannot conflict across either insertion direction',async()=>{
    const journal=await prepared();await admin.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)',[journal.operationId,journal.providerRefundId]);
    const other=await preparedOnly(),a=await trusted.authorize(other.operationId,randomUUID());
    await assert.rejects(admin.query('insert into app.payment_refund_candidates(operation_id,attempt_id,provider_refund_id) values($1,$2,$3)',[other.operationId,a.attemptId,journal.providerRefundId]),{code:'23514'});
    const item=await preparedOnly(),b=await trusted.authorize(item.operationId,randomUUID());await trusted.bindCandidate(item.operationId,b.attemptId,item.providerRefundId,b.known);
    const third=await prepared();await assert.rejects(admin.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)',[third.operationId,item.providerRefundId]),{code:'23514'});
    await assert.rejects(admin.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)',[item.operationId,randomUUID()]),{code:'23514'});
  });
  await check('cross-journal UUID race blocks then rejects the loser in both insertion directions',async()=>{
    for(const firstTable of ['candidate','journal']){
      const item=await preparedOnly(),attempt=await trusted.authorize(item.operationId,randomUUID()),other=await prepared(),sharedId=randomUUID();
      const first=await connection(),second=await connection(),pid=(await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      const candidate=client=>client.query('insert into app.payment_refund_candidates(operation_id,attempt_id,provider_refund_id) values($1,$2,$3)',[item.operationId,attempt.attemptId,sharedId]);
      const journal=client=>client.query('insert into app.payment_refund_provider_links(operation_id,provider_refund_id) values($1,$2)',[other.operationId,sharedId]);
      await begin(first);await(firstTable==='candidate'?candidate(first):journal(first));
      const losing=observe(firstTable==='candidate'?journal(second):candidate(second));try{await blocked(pid);}finally{await commit(first);}
      const outcome=await losing;assert.equal(outcome.error?.code,'23514');
      assert.equal((await admin.query('select (select count(*)::integer from app.payment_refund_candidates where provider_refund_id=$1)+(select count(*)::integer from app.payment_refund_provider_links where provider_refund_id=$1) as count',[sharedId])).rows[0].count,1);
    }
  });
  await check('inspection capture must agree with stored proof before any send attempt or POST',async()=>{
    const item=await preparedOnly(),attempt=store(item,{paymentPatch:{captured_at:new Date(Date.parse(item.capturedAt)+1).toISOString()}});
    await assert.rejects(attempt.dispatcher.dispatch(item.operationId,async()=>{throw Error('mismatched capture must never reach authorization');}));
    assert.equal(attempt.fake.calls.filter(call=>call.init.method==='POST').length,0);assert.deepEqual(await dispatchRows(item),{attempts:0,candidates:0,anchors:0});
  });
  await check('source TEST capture and preparation guards fail closed before POST; repeatable read is rejected',async()=>{
    const missing=await fixture();await assert.rejects(trusted.load(missing.operationId));assert.deepEqual(await dispatchRows(missing),{attempts:0,candidates:0,anchors:0});
    const client=await connection('dispatch_worker'),item=await preparedOnly();await client.query('begin isolation level repeatable read');const storeInTx=new PostgresRefundDispatchStore({transaction:work=>work(client)},merchant);try{await assert.rejects(storeInTx.authorize(item.operationId,randomUUID()));}finally{await client.query('rollback');}
    for(const [table,sql] of [['payment_orders',"update app.payment_orders set status='pending' where id=$1"],['payment_verifications',"update app.payment_verifications set captured_at=null where intent_id=$1"],['payment_checkout_intents',"update app.payment_checkout_intents set is_test=false where id=$1"]]){const item=await preparedOnly();await inject(table,sql,[item.id]);const attempt=store(item);await assert.rejects(attempt.dispatcher.dispatch(item.operationId,async()=>{}));assert.equal(attempt.fake.calls.length,0);assert.deepEqual(await dispatchRows(item),{attempts:0,candidates:0,anchors:0});}
  });
  await check('lost COMMIT acknowledgement never authorizes HTTP or retries SQL; committed attempt survives',async()=>{
    const item=await prepared(),client=await connection('dispatch_worker');let transactions=0;
    const broken={transaction:async work=>{transactions++;await client.query('begin');try{await work(client);await client.query('commit');throw Error('synthetic lost COMMIT acknowledgment');}catch(error){await client.query('rollback');throw error;}}};
    await assert.rejects(new PostgresRefundDispatchStore(broken,merchant).authorize(item.operationId,randomUUID()));assert.equal(transactions,1);assert.equal((await dispatchRows(item)).attempts,1);
    const recovery=store(item);assert.deepEqual(await recovery.dispatcher.dispatch(item.operationId,async()=>{}),expected(item));assert.deepEqual(recovery.fake.calls.map(c=>c.init.method),['POST','GET','GET']);
  });
  await check('monotonic COMMIT latency cannot extend the fixed DB send window',async()=>{
    const item=await prepared();await inject('payment_refund_dispatch_anchors',"update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '23 hours 55 minutes'+interval '1500 milliseconds' where operation_id=$1",[item.operationId]);
    const client=await connection('dispatch_worker');const slow={transaction:async work=>{await client.query('begin');try{const value=await work(client);await client.query('commit');await new Promise(resolve=>setTimeout(resolve,1700));return value;}catch(error){await client.query('rollback');throw error;}}};
    await assert.rejects(new PostgresRefundDispatchStore(slow,merchant).authorize(item.operationId,randomUUID()));assert.equal((await dispatchRows(item)).attempts,1);
  });
  await check('DB fills request hash and clocks; attempts and candidates reject UPDATE DELETE TRUNCATE and runtime role has no access',async()=>{
    const item=await preparedOnly(),authorized=await trusted.authorize(item.operationId,randomUUID());await trusted.bindCandidate(item.operationId,authorized.attemptId,item.providerRefundId,authorized.known);
    const row=(await admin.query('select a.request_sha256,a.started_at,c.received_at,q.request_sha256 as expected from app.payment_refund_send_attempts a join app.payment_refund_candidates c on c.attempt_id=a.id join app.payment_refund_requests q on q.operation_id=a.operation_id where a.operation_id=$1',[item.operationId])).rows[0];assert.equal(row.request_sha256,row.expected);assert.ok(row.started_at instanceof Date);assert.ok(row.received_at instanceof Date);
    const worker=await connection('dispatch_worker');for(const table of ['payment_refund_send_attempts','payment_refund_candidates']){assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed",['app.'+table])).rows[0].allowed,false);for(const sql of ['update app.'+table+' set operation_id=operation_id where operation_id=$1','delete from app.'+table+' where operation_id=$1']){await assert.rejects(admin.query(sql,[item.operationId]),{code:'23514'});await assert.rejects(worker.query(sql,[item.operationId]),{code:'42501'});}await assert.rejects(admin.query('truncate app.'+table+' cascade'),{code:'23514'});await assert.rejects(worker.query('truncate app.'+table),{code:'42501'});}
    for(const sql of ['select email,password_hash from app.users limit 0',"update app.payment_orders set status='refunded' where false",'update app.payment_verifications set captured_at=null where false','insert into app.payment_refund_send_attempts(id,operation_id,started_at) values(null,null,clock_timestamp())','insert into app.payment_refund_candidates(operation_id,attempt_id,provider_refund_id,received_at) values(null,null,null,clock_timestamp())'])await assert.rejects(worker.query(sql),{code:'42501'});
  });
  await check('nonempty down refuses durable attempts and candidates without deleting rows',async()=>{const item=await preparedOnly();await trusted.authorize(item.operationId,randomUUID());const before=(await admin.query('select count(*)::integer as count from app.payment_refund_send_attempts')).rows[0].count;await assert.rejects(admin.query(down),{code:'23514'});await admin.query('rollback');assert.equal((await admin.query('select count(*)::integer as count from app.payment_refund_send_attempts')).rows[0].count,before);});
  console.log(JSON.stringify({status:'passed',checks,server:'PostgreSQL18.6',providerNetwork:false,refundPOST:'in-process fake only',realCharges:false,productionTouched:false,fixture:'owned disposable container'}));
}finally{
  await Promise.allSettled([...transactions].map(c=>c.query('rollback')));await Promise.all([...pending]);
  const results=await Promise.allSettled([...pools].map(p=>p.close()).concat([...clients].map(async c=>{try{await c.query('rollback');}finally{await c.end();}})));
  if(container){const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Name,'/'+name);assert.equal(info.Config.Image,image);assert.equal(info.Config.Labels[label],name);await docker(['rm','--force',container]);}
  const failures=results.filter(r=>r.status==='rejected');if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'Owned dispatch fixture cleanup failed');
}
