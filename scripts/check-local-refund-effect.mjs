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
const {PostgresRefundJournalStore} = load('postgres-refund-journal');
const {PostgresPlacementRefundEffectStore} = load('postgres-placement-refund-effect');
const {createPrimaryPlacementRefundProcessor} = load('primary-placement-refund-processor');
const {parseWorkPublicationForm} = load('work-publication-contract');
assert.equal(process.argv.length, 2);
const run = promisify(execFile), image = 'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name = 'blizhniy-refund-effect-' + randomBytes(8).toString('hex'), label = 'blizhniy.refund-effect-fixture';
const password = randomBytes(24).toString('hex'), merchant = {shopId: 'effect-fixture', isTest: true, secretKey: 'test_synthetic_only'};
const docker = async args => (await run('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
  env: {PATH: process.env.PATH, LANG: 'C.UTF-8', POSTGRES_PASSWORD: password}, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
let container, admin, config, db, ownerDb, checks = 0, phoneSequence = 0, failure;
const clients = new Set(), pools = new Set(), pending = new Set(), transactions = new Set();
const fixtureEnvironment = {BLIZHNIY_LISTING_WORKFLOW: 'postmoderation', BLIZHNIY_LOCAL_PRIMARY: 'enabled', BLIZHNIY_LOCAL_PRIMARY_ORIGIN: 'https://127.0.0.1:14431'};
const previousEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));
Object.assign(process.env, fixtureEnvironment);
const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network is forbidden in the refund-effect fixture');};
async function connection(role = 'postgres') { const c = new pg.Client({...config, user: role}); await c.connect(); clients.add(c); return c; }
function database(role = 'effect_worker') { const d = new PostgresDatabase(new pg.Pool({...config, user: role, max: 5})); pools.add(d); return d; }
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
async function fixture({kind = 'listing', confirmed = true, orderStatus = 'succeeded', old = false, receipt = false} = {}) {
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
  const requestBody = JSON.stringify({amount: {value: binding.amount, currency: 'RUB'}, capture: true, confirmation: {type: 'redirect', return_url: 'https://fixture.example.invalid/return'}, metadata,...(receipt?{receipt:{customer:{email:'receipt-fixture@example.invalid'},internet:true,items:[{amount:{value:binding.amount,currency:'RUB'},description:'Синтетическое размещение',payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:1}]}}:{})});
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
function table(item) {return item.targetType === 'listing' ? 'listings' : 'work_publications';}
async function target(item) {return (await admin.query('select * from app.' + table(item) + ' where id=$1', [item.targetId])).rows[0] ?? null;}
async function history(item) {
  return (await admin.query(`select row_to_json(i) as intent,row_to_json(v) as verification,
    (select row_to_json(f) from app.payment_fulfillments f where f.intent_id=i.id) as fulfillment,
    (select row_to_json(r) from app.payment_refund_reservations r where r.payment_intent_id=i.id) as reservation,
    (select row_to_json(q) from app.payment_refund_requests q where q.operation_id=$2) as request,
    (select row_to_json(a) from app.payment_refund_dispatch_anchors a where a.operation_id=$2) as anchor,
    (select row_to_json(l) from app.payment_refund_provider_links l where l.operation_id=$2) as link,
    (select json_agg(o order by o.status) from app.payment_refund_observations o where o.operation_id=$2) as observations
    from app.payment_checkout_intents i join app.payment_verifications v on v.intent_id=i.id where i.id=$1`, [item.id, item.operationId])).rows[0];
}
async function order(item) {return (await admin.query('select * from app.payment_orders where id=$1', [item.id])).rows[0];}
async function effectRows(item) {return (await admin.query('select * from app.payment_refund_effects where operation_id=$1', [item.operationId])).rows;}
function fulfillment(item, storage = ownerDb) {return new PostgresListingPaymentFulfillmentStore(storage, merchant, {postmoderation: true, ...(item.targetType === 'listing' ? {} : {targetType: item.targetType})});}
async function prepare(item) {
  item.operationId = randomUUID(); item.providerRefundId = randomUUID(); item.createdAt = new Date(Date.parse(item.capturedAt) + 60000).toISOString();
  await new PostgresPlacementRefundReservationStore(ownerDb, merchant).reserve(item.id, item.operationId);
  const requests = new PostgresRefundRequestStore(ownerDb, merchant);
  await requests.prepare(item.operationId); await requests.openWindow(item.operationId); return item;
}
async function journal(item, status = 'succeeded', patch = {}) {
  const calls = [];
  const reader = new PostgresRefundJournalStore(ownerDb, merchant, async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); calls.push(String(url));
    if (String(url) === 'https://api.yookassa.ru/v3/payments/' + item.providerPaymentId) {
      return Response.json({id:item.providerPaymentId, amount:{value:item.amount,currency:'RUB'},paid:true,status:'succeeded',test:true,recipient:{account_id:merchant.shopId},captured_at:item.capturedAt,metadata:item.metadata});
    }
    assert.equal(String(url), 'https://api.yookassa.ru/v3/refunds/' + item.providerRefundId);
    return Response.json({id:item.providerRefundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status,created_at:item.createdAt,metadata:{localRefundId:item.operationId,localPaymentId:item.id},...patch});
  });
  const result = await reader.reconcile(item.operationId, item.providerRefundId); assert.equal(calls.length, 2); return result;
}
async function ready({kind='listing', fulfilled=true, status='succeeded', receipt=false} = {}) {
  const item = await fixture({kind,receipt});
  if (fulfilled) assert.equal((await fulfillment(item).fulfill(item.id)).state, 'fulfilled');
  await prepare(item); if (status !== null) await journal(item, status); return item;
}
const effects = storage => new PostgresPlacementRefundEffectStore(storage ?? db, merchant);
async function apply(item, effect, storage) {
  const beforeHistory = await history(item), beforeOrder = await order(item), start = Date.now();
  const result = await effects(storage).apply(item.operationId);
  assert.deepEqual(Object.keys(result).sort(), ['appliedAt','effect','operationId','paymentIntentId','providerRefundId','targetId','targetType'].sort());
  assert.deepEqual({...result, appliedAt: undefined}, {operationId:item.operationId,paymentIntentId:item.id,providerRefundId:item.providerRefundId,targetType:item.targetType,targetId:item.targetId,effect,appliedAt:undefined});
  assert.match(result.appliedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  assert.ok(Date.parse(result.appliedAt) >= start - 1000 && Date.parse(result.appliedAt) <= Date.now() + 1000);
  assert.deepEqual(await order(item), {...beforeOrder, status:'refunded'}); assert.deepEqual(await history(item), beforeHistory); assert.equal((await effectRows(item)).length, 1); return result;
}
async function refused(item, storage) {
  const before = {target:await target(item), order:await order(item), history:await history(item),effects:await effectRows(item)};
  await assert.rejects(effects(storage).apply(item.operationId));
  assert.deepEqual({target:await target(item),order:await order(item),history:await history(item),effects:await effectRows(item)}, before);
}
async function inject(tableName, sql, values) {
  assert.ok(['payment_checkout_intents','payment_orders','payment_verifications','payment_provider_links','payment_refund_reservations','payment_refund_requests','payment_refund_dispatch_anchors','payment_refund_provider_links','payment_refund_observations','listings','work_publications'].includes(tableName));
  await admin.query('alter table app.' + tableName + ' disable trigger user');
  try {await admin.query(sql, values);} finally {await admin.query('alter table app.' + tableName + ' enable trigger user');}
}
function processorProvider(item, status='succeeded') {
  const calls=[];
  const refund={id:item.providerRefundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status,created_at:item.createdAt,metadata:{localRefundId:item.operationId,localPaymentId:item.id}};
  return {calls,fetch:async(input,init)=>{
    const url=String(input);calls.push({url,method:init.method});assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    if(init.method==='POST'){
      assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+item.operationId);
      assert.equal(init.body,JSON.stringify({payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},metadata:{localRefundId:item.operationId,localPaymentId:item.id}}));return Response.json(refund);
    }
    assert.equal(init.method,'GET');
    if(url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},paid:true,refundable:true,status:'succeeded',test:true,recipient:{account_id:merchant.shopId},captured_at:item.capturedAt,metadata:item.metadata});
    if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
    assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+item.providerRefundId);return Response.json(refund);
  }};
}
async function nextPurchase(item, {samePeriod=false, fulfill=true, orderStatus='succeeded'} = {}) {
  const next = {...item, id:randomUUID(), providerPaymentId:randomUUID()};
  next.metadata={localPaymentId:next.id,targetId:next.targetId,targetType:next.targetType,tariffId:next.tariffId};
  next.requestBody=JSON.stringify({amount:{value:next.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:next.metadata});
  await admin.query("update app.payment_orders set status='refunded' where id=$1",[item.id]);
  if (!samePeriod && fulfill) await admin.query('update app.'+table(item)+" set status='draft',is_paid=false,published_at=null,expires_at=null where id=$1",[item.targetId]);
  await txDatabase(admin).transaction(async tx => {
    await new PostgresPaymentIntentStore(txDatabase(admin)).persistInTransaction(tx, Object.fromEntries(['id','ownerId','targetType','targetId','targetRevision','tariffId','amount','durationDays','shopId','isTest','requestBody'].map(key=>[key,next[key]])));
    await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[next.id,next.ownerId,randomUUID(),next.targetType,next.targetId]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[next.id]);
    await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[next.id,next.providerPaymentId]);
    await tx.query('update app.payment_orders set status=$2 where id=$1',[next.id,orderStatus]);
    await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[next.id,next.providerPaymentId,next.capturedAt]);
    if(samePeriod) await tx.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) select $1,published_at,expires_at from app.payment_fulfillments where intent_id=$2',[next.id,item.id]);
  });
  if (!samePeriod && fulfill) {
    assert.equal((await fulfillment(next).fulfill(next.id)).state,'fulfilled');
  }
  return next;
}
try {
  container = await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  assert.match(container,/^[a-f0-9]{64}$/);
  const info=JSON.parse(await docker(['inspect',container]))[0],port=info.NetworkSettings.Ports['5432/tcp'][0];
  assert.equal(info.Config.Labels[label],name); assert.equal(info.Config.Image,image); assert.equal(port.HostIp,'127.0.0.1');
  config={host:'127.0.0.1',port:Number(port.HostPort),database:'blizhniy_test',user:'postgres',password,statement_timeout:10000};
  const deadline=Date.now()+20000;
  for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d',config.database]);break;}catch{assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}}
  admin=await connection();assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const extras=[...await getLocalPrimaryExtraMigrations(),...await getLocalTelegramMigrations(),...await getLocalDeletionMigrations(),...await getLocalCheckoutEditMigrations(),...await getLocalApplicationContactMigrations()];
  for(const migrationName of ['0036-placement-refund-reservations.sql','0037-refund-requests.sql','0038-refund-journal.sql','0039-refund-dispatch.sql','0040-placement-refund-effects.sql']){
    const source=await readFile(new URL('../database/migrations/'+migrationName,import.meta.url),'utf8');extras.push({name:migrationName,source,sha256:createHash('sha256').update(source).digest('hex')});
  }
  await bootstrapPostgres(admin,'127.0.0.1:blizhniy_test',{includeListingContactMethod:true});
  await txDatabase(admin).transaction(async tx=>{for(const migration of extras){await tx.query(withoutTransaction(migration.source));await tx.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);}});
  const migration=extras.at(-1).source,down=await readFile(new URL('../database/migrations/0040-placement-refund-effects.down.sql',import.meta.url),'utf8');
  await check('all forty exact hashes compose; empty down preserves historical journals and reapplies',async()=>{
    const expected=[...getBootstrapPlan({includeListingContactMethod:true}),...extras].map(({name,sha256})=>({name,sha256}));assert.equal(expected.length,40);
    assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,expected);
    await admin.query(down);assert.deepEqual((await admin.query("select to_regclass('app.payment_refund_effects') as effects,to_regclass('app.payment_refund_observations') is not null as journal,to_regclass('app.payment_fulfillments') is not null as fulfillment")).rows[0],{effects:null,journal:true,fulfillment:true});await admin.query(migration);
  });
  await admin.query(`create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    create role effect_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to effect_worker;
    grant insert(operation_id,merchant_shop_id),select on app.payment_refund_effects to effect_worker;
    update app.phone_verification_policy set available=true,required=true`);
  await admin.query(`create role processor_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant usage on schema app to processor_worker;
    grant select(id),update(id) on app.users to processor_worker;
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_refund_provider_links,app.payment_refund_observations,app.payment_refund_send_attempts,app.payment_refund_candidates,app.payment_refund_effects to processor_worker;
    grant update(id) on app.payment_checkout_intents,app.payment_orders to processor_worker;
    grant insert(operation_id) on app.payment_refund_dispatch_anchors to processor_worker;
    grant insert(id,operation_id) on app.payment_refund_send_attempts to processor_worker;
    grant insert(operation_id,attempt_id,provider_refund_id) on app.payment_refund_candidates to processor_worker;
    grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to processor_worker;
    grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to processor_worker;
    grant insert(operation_id,merchant_shop_id) on app.payment_refund_effects to processor_worker`);
  db=database();ownerDb=database('postgres');
  const processorDb=database('processor_worker');
  const worker=await connection('effect_worker');
  for (const kind of ['listing','vacancy','workRequest']) {
    await check(kind+': real fulfillment is revoked once; exact history, content, revision and period survive',async()=>{
      const item=await ready({kind}),before=await target(item),result=await apply(item,'revoked'),after=await target(item);
      assert.deepEqual(after,{...before,status:'archived',is_paid:false,updated_at:after.updated_at});assert.ok(after.updated_at>=before.updated_at);
      assert.deepEqual(await effects().apply(item.operationId),result);assert.deepEqual(await target(item),after);
      const historyBefore=await history(item);await nextPurchase(item);const later=await target(item);
      assert.deepEqual(await effects().apply(item.operationId),result);assert.deepEqual(await target(item),later);assert.deepEqual(await history(item),historyBefore);
    });
    await check(kind+': captured but never fulfilled produces financial-only unfulfilled receipt',async()=>{
      const item=await ready({kind,fulfilled:false}),before=await target(item);await apply(item,'unfulfilled');assert.deepEqual(await target(item),before);
    });
    await check(kind+': changed paid period and second succeeded receipt for same period protect newer service',async()=>{
      for(const samePeriod of [false,true]){const item=await ready({kind});await nextPurchase(item,{samePeriod});const before=await target(item);await apply(item,'superseded');assert.deepEqual(await target(item),before);}
    });
    await check(kind+': physically missing target or changed owner/kind is missing without arbitrary mutation',async()=>{
      for(const missing of ['deleted','owner',...(kind==='listing'?[]:['kind'])]){const item=await ready({kind});
        if(missing==='deleted')await admin.query('delete from app.'+table(item)+' where id=$1',[item.targetId]);
        else if(missing==='kind')await admin.query("update app.work_publications set kind=$2,form=jsonb_set(form,'{kind}',to_jsonb($2::text)) where id=$1",[item.targetId,kind==='vacancy'?'workRequest':'vacancy']);
        else{const other=await fixture({kind});await admin.query('update app.'+table(item)+' set author_id=$2 where id=$1',[item.targetId,other.ownerId]);}
        const before=await target(item);await apply(item,'missing');assert.deepEqual(await target(item),before);
      }
    });
    await check(kind+': archival, edited revision, blocked account and deletion markers do not resurrect content',async()=>{
      const item=await ready({kind});await admin.query('update app.users set is_blocked=true where id=$1',[item.ownerId]);
      await admin.query('update app.'+table(item)+" set status='archived',revision=revision+1"+(kind==='listing'?",title='Изменённое название'":",deleted_at=clock_timestamp(),form=jsonb_set(form,'{description}',to_jsonb('Изменённое содержимое'::text))")+' where id=$1',[item.targetId]);
      if(kind==='listing'){
        await admin.query("insert into app.listing_blocks(listing_id,blocked_revision,reason) values($1,2,'Синтетическая блокировка')",[item.targetId]);
        await admin.query('insert into app.listing_owner_removals(listing_id,owner_id,removed_revision) values($1,$2,2)',[item.targetId,item.ownerId]);
      }
      const before=await target(item),markers=kind==='listing'?(await admin.query('select row_to_json(b) as block,row_to_json(r) as removal from app.listing_blocks b join app.listing_owner_removals r using(listing_id) where listing_id=$1',[item.targetId])).rows:null;
      await apply(item,'revoked');const after=await target(item);assert.deepEqual(after,{...before,is_paid:false,updated_at:after.updated_at});
      if(markers)assert.deepEqual((await admin.query('select row_to_json(b) as block,row_to_json(r) as removal from app.listing_blocks b join app.listing_owner_removals r using(listing_id) where listing_id=$1',[item.targetId])).rows,markers);
    });
  }
  await check('deleted historical owner cascades target while financial history remains refundable as missing',async()=>{
    for(const kind of ['listing','vacancy','workRequest']){const item=await ready({kind});await admin.query('delete from app.users where id=$1',[item.ownerId]);assert.equal(await target(item),null);await apply(item,'missing');assert.equal(await target(item),null);}
  });
  await check('pending, canceled, unknown and metadata-free provider GET never grant financial or service effects',async()=>{
    for(const status of ['pending','canceled',null])await refused(await ready({status}));
    const item=await ready({status:null});await assert.rejects(journal(item,'succeeded',{metadata:{}}));await refused(item);
    await assert.rejects(effects().apply(randomUUID()));
  });
  await check('only published and paid statuses archive; already sold, expired and rejected statuses survive',async()=>{
    for(const status of ['paid','sold','expired','rejected']){
      const item=await ready();await admin.query('update app.listings set status=$2 where id=$1',[item.targetId,status]);const before=await target(item);
      await apply(item,'revoked');const after=await target(item);assert.deepEqual(after,{...before,is_paid:false,status:status==='paid'?'archived':status,updated_at:after.updated_at});
    }
  });
  await check('different target period without any replacement receipt is superseded',async()=>{
    const item=await ready();await admin.query("update app.listings set published_at=published_at+interval '1 day',expires_at=expires_at+interval '1 day' where id=$1",[item.targetId]);const before=await target(item);await apply(item,'superseded');assert.deepEqual(await target(item),before);
  });
  await check('concurrent application returns exactly one immutable receipt; rollback and lost COMMIT acknowledgement recover',async()=>{
    const item=await ready(),before=await history(item),results=await Promise.all([effects().apply(item.operationId),effects().apply(item.operationId)]);
    assert.deepEqual(results[0],results[1]);assert.equal((await effectRows(item)).length,1);assert.deepEqual(await history(item),before);
    const rollback=await ready(),client=await connection('effect_worker');await begin(client);await effects({transaction:work=>work(client)}).apply(rollback.operationId);await client.query('rollback');transactions.delete(client);
    assert.equal((await order(rollback)).status,'succeeded');assert.equal((await target(rollback)).is_paid,true);assert.deepEqual(await effectRows(rollback),[]);await apply(rollback,'revoked');
    const lost=await ready(),ack=await connection('effect_worker'),store=effects({transaction:async work=>{const value=await txDatabase(ack).transaction(work);assert.ok(value);throw Error('Synthetic lost COMMIT ACK');}});
    await assert.rejects(store.apply(lost.operationId),/Synthetic lost COMMIT ACK/);const saved=await effectRows(lost),targetBefore=await target(lost),recovered=await effects().apply(lost.operationId);assert.equal(saved.length,1);assert.equal(recovered.appliedAt,(await admin.query(`select to_char(applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value from app.payment_refund_effects where operation_id=$1`,[lost.operationId])).rows[0].value);assert.deepEqual(await target(lost),targetBefore);
  });
  await check('read committed is mandatory, read-only SQL refuses mutation, worker has no financial, customer or source-table authority',async()=>{
    const item=await ready(),client=await connection('effect_worker');await client.query('begin isolation level repeatable read');try{await assert.rejects(effects({transaction:work=>work(client)}).apply(item.operationId));}finally{await client.query('rollback');}
    await client.query('begin read only');try{await assert.rejects(effects({transaction:work=>work(client)}).apply(item.operationId));}finally{await client.query('rollback');}
    for(const tableName of ['payment_checkout_intents','payment_orders','payment_verifications','payment_fulfillments','payment_refund_reservations','payment_refund_requests','payment_refund_provider_links','payment_refund_observations','users','listings','work_publications']){
      await assert.rejects(worker.query('select * from app.'+tableName+' limit 0'),{code:'42501'});await assert.rejects(worker.query('delete from app.'+tableName+' where false'),{code:'42501'});
    }
    await assert.rejects(worker.query('insert into app.payment_refund_effects(operation_id,effect) values($1,$2)',[item.operationId,'unfulfilled']),{code:'42501'});
    await assert.rejects(worker.query('insert into app.payment_refund_effects(operation_id,applied_at) values($1,clock_timestamp())',[item.operationId]),{code:'42501'});
    assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_refund_effects','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as allowed")).rows[0].allowed,false);
  });
  await check('merchant capability prevents a valid foreign TEST merchant applying or replaying another shop operation',async()=>{
    const item=await ready(),wrong=new PostgresPlacementRefundEffectStore(db,{shopId:'another-shop',isTest:true});await assert.rejects(wrong.apply(item.operationId));assert.equal((await order(item)).status,'succeeded');assert.deepEqual(await effectRows(item),[]);
    const receipt=await apply(item,'revoked');await assert.rejects(wrong.apply(item.operationId));assert.deepEqual(await effects().apply(item.operationId),receipt);
    await assert.rejects(worker.query('insert into app.payment_refund_effects(operation_id,merchant_shop_id) values($1,$2)',[item.operationId,'another-shop']));
  });
  await check('pending replacement receipt fails closed; replay rejects rebound source or nonrefunded order',async()=>{
    const protectedItem=await ready();await nextPurchase(protectedItem,{samePeriod:true,orderStatus:'pending'});const paidBefore=await target(protectedItem);await refused(protectedItem);assert.deepEqual(await target(protectedItem),paidBefore);
    for(const corruptOrder of [true,false]){const item=await ready();await apply(item,'revoked');if(corruptOrder)await inject('payment_orders',"update app.payment_orders set status='succeeded' where id=$1",[item.id]);else await inject('payment_refund_reservations','update app.payment_refund_reservations set amount=amount-1 where payment_intent_id=$1',[item.id]);await refused(item);}
  });
  await check('pending replacement order with original paid period fails closed without a partial financial effect',async()=>{
    const item=await ready();await nextPurchase(item,{fulfill:false,orderStatus:'pending'});await refused(item);
  });
  await check('true SQL owner restoration races in both lock orders preserve once-only receipt and user-first locking',async()=>{
    for(const ownerFirst of [true,false]){
      const item=await ready(),first=await connection(ownerFirst?'postgres':'effect_worker'),second=await connection(ownerFirst?'effect_worker':'postgres');
      const restore=async client=>{await client.query('select id from app.users where id=$1 for update',[item.ownerId]);await client.query('update app.listings set status=\'draft\',is_paid=false,published_at=null,expires_at=null where id=$1',[item.targetId]);};
      await begin(first);
      if(ownerFirst)await restore(first);else await effects({transaction:work=>work(first)}).apply(item.operationId);
      const pid=(await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      const contender=observe(ownerFirst?effects(txDatabase(second)).apply(item.operationId):txDatabase(second).transaction(()=>restore(second)));
      try{await blocked(pid);}finally{await commit(first);}unwrap(await contender);
      const saved=await effectRows(item);assert.equal(saved.length,1);assert.equal(saved[0].effect,ownerFirst?'superseded':'revoked');
      const before=await target(item),receipt=await effects().apply(item.operationId);assert.equal(receipt.effect,saved[0].effect);assert.deepEqual(await target(item),before);assert.equal(before.is_paid,false);assert.equal(before.status,'draft');
    }
  });
  await check('true SQL replacement fulfillment races in both lock orders retain the newly paid service',async()=>{
    for(const fulfillmentFirst of [true,false]){
      const item=await ready();await admin.query('update app.listings set status=\'draft\',is_paid=false,published_at=null,expires_at=null where id=$1',[item.targetId]);
      const next=await nextPurchase(item,{fulfill:false}),first=await connection(fulfillmentFirst?'postgres':'effect_worker'),second=await connection(fulfillmentFirst?'effect_worker':'postgres');
      await begin(first);if(fulfillmentFirst)assert.equal((await fulfillment(next,{transaction:work=>work(first)}).fulfill(next.id)).state,'fulfilled');else await effects({transaction:work=>work(first)}).apply(item.operationId);
      const pid=(await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      const contender=observe(fulfillmentFirst?effects(txDatabase(second)).apply(item.operationId):fulfillment(next,txDatabase(second)).fulfill(next.id));
      try{await blocked(pid);}finally{await commit(first);}unwrap(await contender);
      const before=await target(item);assert.equal(before.status,'published');assert.equal(before.is_paid,true);assert.equal((await effectRows(item))[0].effect,'superseded');
      assert.equal((await effects().apply(item.operationId)).effect,'superseded');assert.deepEqual(await target(item),before);
    }
  });
  await check('receipt cannot be updated, deleted, truncated, rebound or backdated even by table owner',async()=>{
    const item=await ready();await apply(item,'revoked');const before=await effectRows(item);
    for(const sql of ['update app.payment_refund_effects set effect=effect where operation_id=$1','delete from app.payment_refund_effects where operation_id=$1']){
      await assert.rejects(admin.query(sql,[item.operationId]),{code:'23514'});await assert.rejects(worker.query(sql,[item.operationId]),{code:'42501'});
    }
    await assert.rejects(admin.query('truncate app.payment_refund_effects'),{code:'23514'});await assert.rejects(worker.query('truncate app.payment_refund_effects'),{code:'42501'});
    const other=await ready();await assert.rejects(admin.query('insert into app.payment_refund_effects(operation_id,merchant_shop_id,payment_intent_id,provider_refund_id,target_type,target_id,effect,applied_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[other.operationId,merchant.shopId,item.id,item.providerRefundId,'listing',item.targetId,'unfulfilled','2000-01-01T00:00:00Z']));
    assert.deepEqual(await effectRows(item),before);assert.equal((await order(other)).status,'succeeded');
    const functions=(await admin.query(`select p.prosecdef,p.proconfig,coalesce(bool_or(a.grantee=0 and a.privilege_type='EXECUTE'),false) as public_execute from pg_trigger t join pg_proc p on p.oid=t.tgfoid cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where t.tgrelid='app.payment_refund_effects'::regclass and not t.tgisinternal group by p.oid,p.prosecdef,p.proconfig`)).rows;
    assert.ok(functions.some(row=>row.prosecdef));for(const row of functions){assert.equal(row.public_execute,false);assert.ok(row.proconfig.includes('search_path=""'));}
  });
  await check('processor reads known pending/canceled proof without effects and applies known successful proof',async()=>{
    for(const status of ['pending','canceled','succeeded']){
      const item=await ready({status}),beforeTarget=await target(item),beforeOrder=await order(item),fake=processorProvider(item,status);
      const result=await createPrimaryPlacementRefundProcessor(processorDb,merchant,fake.fetch).process(item.operationId,async()=>{throw Error('Known journal identity must never authorize POST');});
      assert.equal(result.state,status==='succeeded'?'applied':status);assert.equal(result.verification.status,status);assert.equal(result.verification.operationId,item.operationId);assert.deepEqual(fake.calls.map(call=>call.method),['GET','GET']);
      if(status==='succeeded'){assert.equal(result.effect.effect,'revoked');assert.equal((await order(item)).status,'refunded');assert.equal((await target(item)).is_paid,false);assert.equal((await effectRows(item)).length,1);}
      else{assert.equal(result.effect,null);assert.deepEqual(await effectRows(item),[]);assert.deepEqual(await target(item),beforeTarget);assert.deepEqual(await order(item),beforeOrder);}
    }
  });
  await check('processor completes fresh39 inspection and send through38 successful GET proof into once-only40 effect',async()=>{
    const item=await ready({status:null,receipt:true}),fake=processorProvider(item),processor=createPrimaryPlacementRefundProcessor(processorDb,merchant,fake.fetch);let authorization=0;
    const result=await processor.process(item.operationId,async()=>{authorization++;});assert.equal(result.state,'applied');assert.equal(result.effect.effect,'revoked');assert.equal(authorization,1);assert.deepEqual(fake.calls.map(call=>call.method),['GET','GET','GET','POST','GET','GET']);
    const before=await target(item);fake.calls.length=0;assert.deepEqual(await processor.process(item.operationId,async()=>{throw Error('Recovery must never authorize POST');}),result);assert.deepEqual(fake.calls.map(call=>call.method),['GET','GET']);assert.deepEqual(await target(item),before);
  });
  await check('processor preserves successful38 after40 SQL rollback; retry performs GET only and applies effect',async()=>{
    const item=await ready({status:null}),beforeTarget=await target(item),beforeOrder=await order(item),fake=processorProvider(item),processor=createPrimaryPlacementRefundProcessor(processorDb,merchant,fake.fetch);let authorization=0;
    await admin.query("alter table app.payment_refund_effects add constraint fixture_reject_effect check(operation_id<>'"+item.operationId+"'::uuid)");
    try{await assert.rejects(processor.process(item.operationId,async()=>{authorization++;}));}finally{await admin.query('alter table app.payment_refund_effects drop constraint fixture_reject_effect');}
    assert.equal(authorization,1);assert.equal(fake.calls.filter(call=>call.method==='POST').length,1);assert.equal((await admin.query("select status from app.payment_refund_observations where operation_id=$1",[item.operationId])).rows[0].status,'succeeded');assert.deepEqual(await effectRows(item),[]);assert.deepEqual(await target(item),beforeTarget);assert.deepEqual(await order(item),beforeOrder);
    fake.calls.length=0;const result=await processor.process(item.operationId,async()=>{throw Error('Failed effect recovery must never authorize another POST');});assert.equal(result.state,'applied');assert.equal(result.effect.effect,'revoked');assert.deepEqual(fake.calls.map(call=>call.method),['GET','GET']);assert.equal((await effectRows(item)).length,1);
  });
  await check('valid original fiscal receipt survives application; coherent hashes cannot authorize unknown fields or malformed receipts',async()=>{
    for(const kind of ['listing','vacancy','workRequest']){const item=await ready({kind,receipt:true});await apply(item,'revoked');}
    for(const corrupt of [body=>{body.unexpected=true;},body=>{body.receipt.items[0].vat_code=0;},body=>{body.receipt.items[0].amount.value='198.00';}]){
      const item=await ready({receipt:true}),body=JSON.parse(item.requestBody);corrupt(body);const text=JSON.stringify(body);
      await inject('payment_checkout_intents','update app.payment_checkout_intents set request_body=$2,request_sha256=$3 where id=$1',[item.id,text,createHash('sha256').update(text).digest('hex')]);await refused(item);
    }
  });
  await check('effect SQL is authoritative for malformed source, full amount, request hash/key, capture and contradictory journal',async()=>{
    const corruptions=[
      ['payment_checkout_intents',"update app.payment_checkout_intents set request_sha256=repeat('0',64) where id=$1"],
      ['payment_checkout_intents',"update app.payment_checkout_intents set request_body=replace(request_body,'redirect','embedded'),request_sha256=encode(sha256(convert_to(replace(request_body,'redirect','embedded'),'UTF8')),'hex') where id=$1"],
      ['payment_checkout_intents',"update app.payment_checkout_intents set is_test=false where id=$1"],
      ['payment_checkout_intents',"update app.payment_checkout_intents set merchant_shop_id='foreign-shop' where id=$1"],
      ['payment_refund_reservations',"update app.payment_refund_reservations set amount=amount-1 where payment_intent_id=$1"],
      ['payment_refund_requests',"update app.payment_refund_requests set request_sha256=repeat('1',64) where operation_id=$2"],
      ['payment_refund_requests',"update app.payment_refund_requests set idempotence_key='wrong-key' where operation_id=$2"],
      ['payment_refund_requests',"update app.payment_refund_requests set request_body=request_body||' ',request_sha256=encode(sha256(convert_to(request_body||' ','UTF8')),'hex') where operation_id=$2"],
      ['payment_verifications',"update app.payment_verifications set captured_at=null where intent_id=$1"],
      ['payment_refund_observations',"update app.payment_refund_observations set provider_created_at='2000-01-01T00:00:00Z' where operation_id=$2"],
      ['payment_refund_observations',"insert into app.payment_refund_observations(operation_id,provider_refund_id,status,provider_created_at) select operation_id,provider_refund_id,'canceled',provider_created_at from app.payment_refund_observations where operation_id=$2"],
    ];
    for(const [source,sql]of corruptions){const item=await ready();await inject(source,sql.replace('$2','$1'),[sql.includes('$2')?item.operationId:item.id]);await refused(item);await assert.rejects(worker.query('insert into app.payment_refund_effects(operation_id,merchant_shop_id) values($1,$2)',[item.operationId,merchant.shopId]));assert.deepEqual(await effectRows(item),[]);}
  });
  await check('nonempty down refuses without deleting financial or service history',async()=>{
    const before=(await admin.query('select count(*)::integer as count from app.payment_refund_effects')).rows[0].count;await assert.rejects(admin.query(down),{code:'23514'});await admin.query('rollback');assert.equal((await admin.query('select count(*)::integer as count from app.payment_refund_effects')).rows[0].count,before);
  });
  console.log(JSON.stringify({status:'passed',checks,server:'PostgreSQL18.6',providerNetwork:false,refundPOST:'in-process fake only',realCharges:false,productionTouched:false,fixture:'owned disposable container'}));
}catch(error){failure=error;throw error;}finally{
  globalThis.fetch=previousFetch;
  for(const[key,value]of Object.entries(previousEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await Promise.allSettled([...transactions].map(c=>c.query('rollback')));await Promise.all([...pending]);
  const closed=await Promise.allSettled([...pools].map(p=>p.close()).concat([...clients].map(async c=>{try{await c.query('rollback');}finally{await c.end();}})));
  if(container){const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Name,'/'+name);assert.equal(info.Config.Image,image);assert.equal(info.Config.Labels[label],name);await docker(['rm','--force',container]);}
  const failures=closed.filter(r=>r.status==='rejected');if(failures.length&&!failure)throw new AggregateError(failures.map(r=>r.reason),'Owned effect fixture cleanup failed');
}
