import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore,PaymentIntentError} from '../src/lib/postgres-payment-intents.ts';

export async function testPaymentIntents(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`;
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const worker='payment_intent_fixture',workerPassword=randomUUID();
 const db=new PostgresDatabase(new pg.Pool({...config,user:worker,password:workerPassword,max:4})),store=new PostgresPaymentIntentStore(db);
 const restricted=new pg.Client({...config,...credentials});await restricted.connect();
 const binding={id:randomUUID(),ownerId:randomUUID(),targetType:'listing',targetId:randomUUID(),targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:'fixture-shop',isTest:true};
 const body=(b=binding,title='Синтетическая услуга')=>JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},description:title,metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId}});
 const intent={...binding,requestBody:body()},down=readFileSync(new URL('../database/migrations/0019-payment-intents.down.sql',import.meta.url),'utf8');
 const persist=value=>db.transaction(tx=>store.persistInTransaction(tx,value));
 try{
  await suite.test('payment intent migration is additive and opt-in, preserves all 18 hashes and grants no web-runtime access',async()=>{
   assert.equal(before.length,18);assert.deepEqual(getBootstrapPlan({includePaymentIntents:true}).slice(0,18).map(({name,sha256})=>({name,sha256})),before);
   assert.equal((await bootstrapPostgres(admin,target,{includePaymentIntents:true})).applied,1);
   assert.equal((await bootstrapPostgres(admin,target,{includePaymentIntents:true})).applied,0);
   for(const table of ['payment_checkout_intents','payment_dispatch_anchors','payment_provider_links']){
    await assert.rejects(restricted.query(`select * from app.${table} limit 0`),{code:'42501'});
    assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE') as allowed",[`app.${table}`])).rows[0].allowed,false);
   }
   await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0019-payment-intents.sql'");
   assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
   assert.equal((await bootstrapPostgres(admin,target,{includePaymentIntents:true})).applied,1);
   await admin.query(`create role ${worker} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${workerPassword}';
    grant connect on database blizhniy_test to ${worker};
    grant usage on schema app to ${worker};
    grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links to ${worker};
    grant insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body),update(id) on app.payment_checkout_intents to ${worker};
    grant insert(intent_id) on app.payment_dispatch_anchors to ${worker};
    grant insert(intent_id,provider_payment_id) on app.payment_provider_links to ${worker}`);
  });
  await suite.test('payment preparation rolls back atomically and independent connection cannot observe uncommitted intent',async()=>{
   await assert.rejects(db.transaction(async tx=>{
    await store.persistInTransaction(tx,intent);
    assert.equal((await admin.query('select id from app.payment_checkout_intents where id=$1',[binding.id])).rowCount,0);
    throw new Error('Synthetic rollback');
   }),/Synthetic rollback/);
   assert.equal((await admin.query('select id from app.payment_checkout_intents where id=$1',[binding.id])).rowCount,0);
  });
  await suite.test('concurrent preparers adopt one committed byte-exact request, never their own changed receipt or a second key',async()=>{
   const alternative={...intent,requestBody:body(binding,'Другое название')};
   const results=await Promise.all([persist(intent),persist(alternative)]);
   assert.deepEqual(results[0],results[1]);
   const saved=(await admin.query('select request_body,request_sha256,target_revision::text from app.payment_checkout_intents where id=$1',[binding.id])).rows[0];
   assert.equal(saved.request_body,results[0].requestBody);assert.equal(saved.request_sha256,createHash('sha256').update(saved.request_body).digest('hex'));assert.equal(saved.target_revision,binding.targetRevision);
   for(const patch of [{ownerId:randomUUID()},{shopId:'another-shop'},{isTest:false},{amount:'200.00'},{targetId:randomUUID()},{targetRevision:'2'},{durationDays:31}]){
    const changed={...binding,...patch};await assert.rejects(persist({...changed,requestBody:body(changed)}),PaymentIntentError);
   }
   assert.equal((await admin.query('select count(*)::int as n from app.payment_checkout_intents')).rows[0].n,1);
  });
  await suite.test('each dispatch commits one immutable database anchor; failed and lost commit replies never extend its window',async()=>{
   const decisions=await Promise.all([store.authorize(binding),store.authorize(binding)]);
   for(const value of decisions){assert.equal(value.decision,'post');assert.equal(value.requestBody,(await persist(intent)).requestBody);assert.ok(value.remainingMs>86099000&&value.remainingMs<=86100000);}
   const anchor=(await admin.query('select authorized_at::text as stamp from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rows[0].stamp;
   const lostReply=new PostgresPaymentIntentStore({transaction:async work=>{await db.transaction(work);throw new Error('Synthetic lost commit response');}});
   await assert.rejects(lostReply.authorize(binding),/Synthetic lost commit/);
   assert.equal((await admin.query('select authorized_at::text as stamp from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rows[0].stamp,anchor);
   const result=await store.authorize(binding);assert.equal(result.decision,'post');assert.ok(result.remainingMs<=decisions[0].remainingMs);
   for(const patch of [{ownerId:randomUUID()},{shopId:'other'},{isTest:false},{targetRevision:'1'}])await assert.rejects(store.authorize({...binding,...patch}),PaymentIntentError);
  });
  await suite.test('known provider ID permits GET recovery only, with immutable one-to-one merchant binding',async()=>{
   const providerId=randomUUID();await store.bindProvider(binding,providerId);await store.bindProvider(binding,providerId);
   assert.deepEqual(await store.authorize(binding),{decision:'recover',providerId});
   await assert.rejects(store.bindProvider(binding,randomUUID()),PaymentIntentError);
   await assert.rejects(store.authorize({...binding,shopId:'other'}),PaymentIntentError);
  });
  await suite.test('expired unknown intents stay blocked, but known provider recovery survives the POST cutoff',async()=>{
   const expired={...binding,id:randomUUID()};await persist({...expired,requestBody:body(expired)});await store.authorize(expired);
   // Historical time injection belongs only to this exact synthetic disposable fixture.
   await admin.query('begin');try{
    await admin.query('alter table app.payment_dispatch_anchors disable trigger payment_dispatch_immutable');
    await admin.query("update app.payment_dispatch_anchors set authorized_at=clock_timestamp()-interval '25 hours' where intent_id=any($1::uuid[])",[[binding.id,expired.id]]);
    await admin.query('alter table app.payment_dispatch_anchors enable trigger payment_dispatch_immutable');await admin.query('commit');
   }catch(error){await admin.query('rollback');throw error;}
   const anchor=(await admin.query('select authorized_at::text as stamp from app.payment_dispatch_anchors where intent_id=$1',[expired.id])).rows[0].stamp;
   await assert.rejects(store.authorize(expired),PaymentIntentError);await assert.rejects(store.authorize(expired),PaymentIntentError);
   assert.equal((await admin.query('select authorized_at::text as stamp from app.payment_dispatch_anchors where intent_id=$1',[expired.id])).rows[0].stamp,anchor);
   assert.equal((await admin.query('select id from app.payment_checkout_intents where id=$1',[expired.id])).rowCount,1);
   assert.equal((await store.authorize(binding)).decision,'recover');
  });
  await suite.test('expiry is rechecked after a real row-lock wait, and the isolated worker cannot change money or anchor time',async()=>{
   const waiting={...binding,id:randomUUID()};await persist({...waiting,requestBody:body(waiting)});await store.authorize(waiting);
   await admin.query('begin');try{
    await admin.query('alter table app.payment_dispatch_anchors disable trigger payment_dispatch_immutable');
    await admin.query("update app.payment_dispatch_anchors set authorized_at=clock_timestamp()-interval '23 hours 55 minutes'+interval '200 milliseconds' where intent_id=$1",[waiting.id]);
    await admin.query('alter table app.payment_dispatch_anchors enable trigger payment_dispatch_immutable');await admin.query('commit');
   }catch(error){await admin.query('rollback');throw error;}
   await admin.query('begin');let checked;
   try{
    await admin.query('select id from app.payment_checkout_intents where id=$1 for update',[waiting.id]);
    checked=assert.rejects(store.authorize(waiting),PaymentIntentError);
    const deadline=Date.now()+2000;
    while(!(await admin.query("select 1 from pg_stat_activity where usename=$1 and wait_event_type='Lock'",[worker])).rowCount){
     if(Date.now()>deadline)throw new Error('Synthetic worker never waited for row lock');await new Promise(resolve=>setTimeout(resolve,10));
    }
    await new Promise(resolve=>setTimeout(resolve,250));await admin.query('commit');await checked;
   }finally{await admin.query('rollback');if(checked)await checked;}
   const workerClient=new pg.Client({...config,user:worker,password:workerPassword});await workerClient.connect();try{
    assert.equal((await workerClient.query('select current_user as name')).rows[0].name,worker);
    await assert.rejects(workerClient.query('select email,password_hash from app.users'),{code:'42501'});
    await assert.rejects(workerClient.query('update app.payment_checkout_intents set amount=1 where id=$1',[binding.id]),{code:'42501'});
    await assert.rejects(workerClient.query('update app.payment_dispatch_anchors set authorized_at=clock_timestamp() where intent_id=$1',[binding.id]),{code:'42501'});
    await assert.rejects(workerClient.query('update app.payment_checkout_intents set id=id where id=$1',[binding.id]),{code:'23514'});
   }finally{await workerClient.end();}
  });
  await suite.test('SQL forbids input/receipt/hash/anchor/link mutation even for owner and refuses NULL metadata bindings',async()=>{
   for(const table of ['payment_checkout_intents','payment_dispatch_anchors','payment_provider_links']){
    const key=table==='payment_checkout_intents'?'id':'intent_id';
    await assert.rejects(admin.query(`update app.${table} set ${key}=${key} where ${key}=$1`,[binding.id]),{code:'23514'});
    await assert.rejects(admin.query(`delete from app.${table} where ${key}=$1`,[binding.id]),{code:'23514'});
   }
   const columns='id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body';
   for(const bad of ['{}',JSON.stringify({...JSON.parse(body()),metadata:{}}),JSON.stringify({...JSON.parse(body()),capture:null})])
    await assert.rejects(admin.query(`insert into app.payment_checkout_intents(${columns}) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),binding.ownerId,binding.targetType,binding.targetId,binding.targetRevision,binding.tariffId,binding.amount,binding.durationDays,binding.shopId,true,bad]),{code:'23514'});
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty payment intents/);}finally{await admin.query('rollback');}
   assert.equal((await admin.query('select id from app.payment_checkout_intents where id=$1',[binding.id])).rowCount,1);
  });
 }finally{await restricted.end();await db.close();}
}
