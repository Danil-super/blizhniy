import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';

export async function testPaymentVerification(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const target=`${config.host}:${config.database}`;
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 await suite.test('verification is an opt-in additive migration preserving twenty hashes, with no runtime finance access and an empty down',async()=>{
  assert.equal(before.length,20);
  assert.equal((await bootstrapPostgres(admin,target,{includePaymentVerification:true})).applied,1);
  assert.deepEqual(getBootstrapPlan({includePaymentVerification:true}).slice(0,20).map(({name,sha256})=>({name,sha256})),before);
  assert.equal((await bootstrapPostgres(admin,target,{includePaymentVerification:true})).applied,0);
  const runtime=new pg.Client({...config,...credentials});await runtime.connect();
  try{await assert.rejects(runtime.query('select * from app.payment_verifications limit 0'),{code:'42501'});}
  finally{await runtime.end();}
  const down=readFileSync(new URL('../database/migrations/0021-payment-verification.down.sql',import.meta.url),'utf8');
  await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0021-payment-verification.sql'");
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
  assert.equal((await bootstrapPostgres(admin,target,{includePaymentVerification:true})).applied,1);
 });
 const worker='payment_verification_fixture',password=randomUUID();
 await admin.query(`create role ${worker} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
  grant connect on database blizhniy_test to ${worker};grant usage on schema app to ${worker};
  grant select on app.payment_checkout_intents,app.payment_provider_links,app.payment_orders,app.payment_verifications to ${worker};
  grant update(id) on app.payment_checkout_intents to ${worker};
  grant update(status) on app.payment_orders to ${worker};
  grant insert(intent_id,provider_payment_id,status,captured_at),update(status,captured_at) on app.payment_verifications to ${worker}`);
 const db=new PostgresDatabase(new pg.Pool({...config,user:worker,password,max:4}));
 const intents=new PostgresPaymentIntentStore({transaction:async work=>{
  await admin.query('begin');try{const result=await work(admin);await admin.query('commit');return result;}
  catch(error){await admin.query('rollback');throw error;}
 }});
 const make=async(linked=true)=>{
  const b={id:randomUUID(),ownerId:randomUUID(),targetType:'listing',targetId:randomUUID(),targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:'fixture-shop',isTest:true};
  const requestBody=JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId}});
  await admin.query('begin');try{
   await intents.persistInTransaction(admin,{...b,requestBody});
   await admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6)",[b.id,b.ownerId,randomUUID(),b.targetType,b.targetId,b.targetRevision]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}
  const providerPaymentId=randomUUID();
  if(linked){await intents.authorize(b);await intents.bindProvider(b,providerPaymentId);}
  return {...b,providerPaymentId};
 };
 const response=(b,status='pending',capture)=>({id:b.providerPaymentId,status,paid:['waiting_for_capture','succeeded'].includes(status),test:true,recipient:{account_id:b.shopId},
  amount:{value:b.amount,currency:'RUB'},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId},...(capture?{captured_at:capture}:{})});
 try{
  const {PostgresPaymentVerificationStore}=await import('../src/lib/postgres-payment-verification.ts');
  const merchant={shopId:'fixture-shop',isTest:true,secretKey:'test_synthetic_fixture_only'};
  await suite.test('known authoritative GET records authorization as pending and capture success atomically without publication',async()=>{
   const b=await make();let payload=response(b,'waiting_for_capture'),calls=0;
   const store=new PostgresPaymentVerificationStore(db,merchant,async(url,init)=>{
    calls++;assert.equal(url,`https://api.yookassa.ru/v3/payments/${b.providerPaymentId}`);assert.equal(init.method,'GET');return Response.json(payload);
   });
   const held=await store.reconcile(b.id);assert.equal(held.status,'waiting_for_capture');assert.equal(held.orderStatus,'pending');assert.equal(held.capturedAt,null);
   payload=response(b,'succeeded','2026-10-19T11:59:00.123456789Z');
   const paid=await store.reconcile(b.id);assert.equal(paid.status,'succeeded');assert.equal(paid.orderStatus,'succeeded');assert.equal(paid.capturedAt,payload.captured_at);
   assert.deepEqual(await store.read(b.id),paid);assert.equal(calls,2);
   for(const sql of ["update app.listings set is_paid=true where false",'select email,password_hash from app.users','delete from app.payment_verifications where false'])await assert.rejects(db.query(sql),{code:'42501'});
   assert.equal(JSON.stringify(paid).includes('metadata'),false);
  });
  await suite.test('missing links, changed shop, bad binding and provider refusal never create a financial confirmation',async()=>{
   const unknown=await make(false),b=await make();let calls=0;
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>{calls++;return Response.json(response(unknown));});
   await assert.rejects(store.reconcile(unknown.id));assert.equal(calls,0);
   await assert.rejects(new PostgresPaymentVerificationStore(db,{...merchant,shopId:'other'},async()=>{calls++;return Response.json(response(b));}).reconcile(b.id));assert.equal(calls,0);
   for(const payload of [{...response(b,'succeeded'),amount:{value:'200.00',currency:'RUB'}},{...response(b,'succeeded'),metadata:{}}])
    await assert.rejects(new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(payload)).reconcile(b.id));
   await assert.rejects(new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json({description:'private fixture text'},{status:404})).reconcile(b.id),error=>!error.message.includes('private fixture'));
   assert.equal(await store.read(b.id),null);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[b.id])).rows[0].status,'created');
  });
  await suite.test('missing capture stays absent, later exact capture is retained and terminal contradictions preserve saved success',async()=>{
   const b=await make();let payload=response(b,'succeeded');
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(payload));
   assert.equal((await store.reconcile(b.id)).capturedAt,null);
   const captured='2026-10-19T11:59:00.123456789Z';payload=response(b,'succeeded',captured);
   const saved=await store.reconcile(b.id);
   for(const status of ['succeeded','pending','waiting_for_capture']){
    payload=response(b,status);assert.deepEqual(await store.reconcile(b.id),saved);
   }
   for(const bad of [response(b,'canceled'),response(b,'succeeded','2026-10-19T11:59:00.123456788Z')]){
    payload=bad;await assert.rejects(store.reconcile(b.id));assert.deepEqual(await store.read(b.id),saved);
   }
   payload=response(b,'succeeded',captured);assert.deepEqual(await store.reconcile(b.id),saved);
  });
  await suite.test('provider cancellation closes only that known order and cannot be overwritten by a delayed hold',async()=>{
   const b=await make();let payload=response(b,'canceled');
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(payload));
   const canceled=await store.reconcile(b.id);assert.equal(canceled.orderStatus,'failed');assert.equal(canceled.status,'canceled');
   payload=response(b,'waiting_for_capture');assert.deepEqual(await store.reconcile(b.id),canceled);
   payload=response(b,'succeeded');await assert.rejects(store.reconcile(b.id));assert.deepEqual(await store.read(b.id),canceled);
  });
  await suite.test('parallel successful verifiers commit one exact record and replay never rewrites its timestamps',async()=>{
   const b=await make();let gets=0;
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>{gets++;return Response.json(response(b,'succeeded','2026-10-19T11:59:00.123000000Z'));});
   const results=await Promise.all([store.reconcile(b.id),store.reconcile(b.id)]);assert.deepEqual(results[0],results[1]);assert.equal(gets,2);
   const row=async()=>(await admin.query('select status,captured_at,verified_at::text,updated_at::text from app.payment_verifications where intent_id=$1',[b.id])).rows;
   const before=await row();assert.equal(before.length,1);
   const equivalent=new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(response(b,'succeeded','2026-10-19T11:59:00.123Z')));
   assert.deepEqual(await equivalent.reconcile(b.id),results[0]);assert.deepEqual(await row(),before);
  });
  await suite.test('reconciliation never undoes an already recorded refund or rewrites capture provenance',async()=>{
   const b=await make();let payload=response(b,'succeeded','2026-10-19T11:59:00.123456789Z');
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(payload));
   const success=await store.reconcile(b.id);
   // Synthetic SQL state only: no refund request/provider operation is implemented here.
   await admin.query("update app.payment_orders set status='refunded' where id=$1",[b.id]);
   const before=(await admin.query('select verified_at::text,updated_at::text from app.payment_verifications where intent_id=$1',[b.id])).rows[0];
   for(const status of ['succeeded','pending']){
    payload=response(b,status);assert.deepEqual(await store.reconcile(b.id),{...success,orderStatus:'refunded'});
   }
   assert.deepEqual((await admin.query('select verified_at::text,updated_at::text from app.payment_verifications where intent_id=$1',[b.id])).rows[0],before);
  });
  await suite.test('delayed pending GET never holds SQL locks or regresses a concurrent committed capture',async()=>{
   const b=await make();let release,entered;
   const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
   const late=new PostgresPaymentVerificationStore(db,merchant,async()=>{
    entered();await waiting;return Response.json(response(b));
   });
   const delayed=late.reconcile(b.id);const checked=assert.doesNotReject(delayed);
   try{
    await started;
    await admin.query('begin');try{
     await admin.query('select id from app.payment_checkout_intents where id=$1 for update nowait',[b.id]);
     await admin.query('select id from app.payment_orders where id=$1 for update nowait',[b.id]);
    }finally{await admin.query('rollback');}
    const captured=await new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(response(b,'succeeded','2026-10-19T11:59:00.123456789Z'))).reconcile(b.id);
    release();await checked;assert.deepEqual(await delayed,captured);
   }finally{release();await checked;}
  });
  await suite.test('order failure rolls verification back; a lost COMMIT is unknown and safely readable without a second charge',async()=>{
   const b=await make();
   await admin.query("update app.payment_orders set status='failed' where id=$1",[b.id]);
   const store=new PostgresPaymentVerificationStore(db,merchant,async()=>Response.json(response(b,'succeeded')));
   await assert.rejects(store.reconcile(b.id));assert.equal(await store.read(b.id),null);
   const good=await make();let transactions=0,gets=0;
   const lost=new PostgresPaymentVerificationStore({transaction:async work=>{
    transactions++;const result=await db.transaction(work);if(transactions===2)throw Error('Synthetic lost COMMIT');return result;
   }},merchant,async()=>{gets++;return Response.json(response(good,'succeeded'));});
   await assert.rejects(lost.reconcile(good.id),/Synthetic lost COMMIT/);assert.equal(transactions,2);assert.equal(gets,1);
   const read=await lost.read(good.id);assert.equal(read.status,'succeeded');assert.equal(read.orderStatus,'succeeded');assert.equal(read.capturedAt,null);assert.equal(gets,1);
  });
  await suite.test('SQL enforces exact provider links, immutable provenance/capture, forward-only states and non-destructive rollback',async()=>{
   const b=await make(),other=await make();
   const insert='insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,$3,$4)';
   await assert.rejects(admin.query(insert,[b.id,other.providerPaymentId,'pending',null]),{code:'23503'});
   await assert.rejects(admin.query(insert,[b.id,b.providerPaymentId,'pending','2026-10-19T11:59:00Z']),{code:'23514'});
   for(const invalid of ['2026-02-30T00:00:00Z','2026-10-19T24:00:00Z','2026-10-19T11:59:00.1234567890Z'])await assert.rejects(admin.query(insert,[b.id,b.providerPaymentId,'succeeded',invalid]));
   await admin.query(insert,[b.id,b.providerPaymentId,'pending',null]);
   await admin.query("update app.payment_verifications set status='waiting_for_capture' where intent_id=$1",[b.id]);
   await assert.rejects(admin.query("update app.payment_verifications set status='pending' where intent_id=$1",[b.id]),{code:'23514'});
   await admin.query("update app.payment_verifications set status='succeeded',captured_at=$2 where intent_id=$1",[b.id,'2026-10-19T11:59:00.123456789Z']);
   const before=(await admin.query('select * from app.payment_verifications where intent_id=$1',[b.id])).rows[0];
   for(const expression of ["status='canceled'",'intent_id=gen_random_uuid()','provider_payment_id=gen_random_uuid()',"verified_at=verified_at+interval '1 second'",'captured_at=null',"captured_at='2026-10-19T11:59:00.123456788Z'"])
    await assert.rejects(admin.query(`update app.payment_verifications set ${expression} where intent_id=$1`,[b.id]),{code:'23514'});
   await assert.rejects(admin.query('delete from app.payment_verifications where intent_id=$1',[b.id]),{code:'23514'});
   assert.deepEqual((await admin.query('select * from app.payment_verifications where intent_id=$1',[b.id])).rows[0],before);
   try{await assert.rejects(admin.query(readFileSync(new URL('../database/migrations/0021-payment-verification.down.sql',import.meta.url),'utf8')),/Refusing to remove nonempty payment verifications/);}
   finally{await admin.query('rollback');}
   assert.equal((await admin.query('select captured_at from app.payment_verifications where intent_id=$1',[b.id])).rows[0].captured_at,before.captured_at);
  });
 }finally{await db.close();}
}
