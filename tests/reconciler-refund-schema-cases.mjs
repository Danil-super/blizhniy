import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
import {verifyRefundWorkerDatabase} from '../scripts/refund-worker-role.mjs';

// The parent owns this disposable PG54 fixture. No credentials or migration executor from ENV.
export async function testReconcilerRefundSchema(suite,{admin,ownerDb,refundDb,purchase,load,operator,merchant,provider}){
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-reconciler54-')),artifact=join(owned,'artifact');
 const plan=getPaymentReconciliationRolePlan('blizhniy_test',{cabinet:true}),password=randomBytes(24).toString('hex');
 let db;
 try{
  await admin.query(plan.createRole);await admin.query(`alter role ${plan.role} login password ${pg.escapeLiteral(password)}`);
  for(const sql of plan.grants)await admin.query(sql);
  const {PostgresDatabase}=load('postgres');db=new PostgresDatabase(new pg.Pool({...admin.options,user:plan.role,password,max:2}));
  buildPaymentWorker(artifact);symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const artifactCheck=(await import(pathToFileURL(join(artifact,'scripts/payment-reconciliation-role.mjs')).href)).verifyPaymentReconciliationDatabase;
  const check=async()=>{await verifyPaymentReconciliationDatabase(db,{database:'blizhniy_test'});await artifactCheck(db,{database:'blizhniy_test'});};
  await suite.test('payment source and compiled artifact admit exact schema54 with unchanged cabinet grants alongside the refund role',async()=>{
   await check();await verifyRefundWorkerDatabase(refundDb,{database:'blizhniy_test',merchant});
   for(const sql of ['select token_hash from app.sessions','select * from app.payment_refund_approvals','insert into app.payment_refund_effects default values',"select app.claim_placement_refund_job('synthetic')"])
    await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('schema54 admission rejects incomplete or unknown journal, hash drift and altered refund business schema in source and artifact',async()=>{
   const original=readFileSync(new URL('../database/migrations/0054-refund-worker-locks.sql',import.meta.url),'utf8');
   const body=original.match(/create function app\.guard_refund_worker_locks\(\)[\s\S]*?\$\$;/)[0].replace('create function','create or replace function');
   const suffix=(await admin.query("select name,sha256 from blizhniy_meta.migrations where name>'0033-account-deletion.sql' order by name")).rows;
   const row=(await admin.query("select name,sha256 from blizhniy_meta.migrations where name='0054-refund-worker-locks.sql'")).rows[0];
   for(const [change,restore,args]of [
    ["delete from blizhniy_meta.migrations where name>'0033-account-deletion.sql'",'insert into blizhniy_meta.migrations(name,sha256) select name,sha256 from jsonb_to_recordset($1::jsonb) as x(name text,sha256 text)',[JSON.stringify(suffix)]],
    ["delete from blizhniy_meta.migrations where name='0054-refund-worker-locks.sql'",'insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[row.name,row.sha256]],
    ["insert into blizhniy_meta.migrations values('0055-unknown.sql',repeat('0',64))","delete from blizhniy_meta.migrations where name='0055-unknown.sql'"],
    ["update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0054-refund-worker-locks.sql'",'update blizhniy_meta.migrations set sha256=$2 where name=$1',[row.name,row.sha256]],
    ['alter table app.payment_refund_requests disable trigger refund_request_guard','alter table app.payment_refund_requests enable trigger refund_request_guard'],
    ["create or replace function app.guard_refund_worker_locks() returns trigger language plpgsql set search_path='' as $$begin return new;end$$",body],
    [`grant select(id) on app.payment_refund_approvals to ${plan.role}`,`revoke select(id) on app.payment_refund_approvals from ${plan.role}`],
   ]){
    await admin.query(change);
    try{for(const verify of [verifyPaymentReconciliationDatabase,artifactCheck])await assert.rejects(verify(db,{database:'blizhniy_test'}),{message:'Payment reconciliation database preflight failed'});}
    finally{await admin.query(restore,args);}
    await check();
   }
  });
  await suite.test('payment reconciliation and refund consumers share schema54 without republishing a refunded listing',async()=>{
   const shop={...merchant,shopId:'coexist-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop,succeeded:false});
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[item.targetId]);
   const workerModule=createRequire(import.meta.url)(join(artifact,'compiled/lib/payment-reconciliation-worker.js'));
   const paymentCalls=[],paymentFetch=async(url,init)=>{
    paymentCalls.push(init.method);assert.equal(init.method,'GET');assert.equal(url,'https://api.yookassa.ru/v3/payments/'+item.providerPaymentId);
    return Response.json({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,captured_at:item.capturedAt,recipient:{account_id:shop.shopId},metadata:item.metadata});
   };
   const queue=new (load('postgres-payment-reconciliation').PostgresPaymentReconciliationQueue)(ownerDb,shop);
   const paymentWorker=workerModule.createPaymentReconciliationWorker(db,shop,paymentFetch);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'created');
   assert.equal((await admin.query('select count(*)::int as n from app.payment_verifications where intent_id=$1',[item.id])).rows[0].n,0);
   assert.equal(await queue.enqueue(item.providerPaymentId),true);await check();
   assert.deepEqual(await paymentWorker.tick(),{state:'completed'});
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'succeeded');
   assert.equal((await admin.query('select status,captured_at is not null as captured from app.payment_verifications where intent_id=$1',[item.id])).rows[0].captured,true);
   const receipt=(await admin.query('select published_at,expires_at from app.payment_fulfillments where intent_id=$1',[item.id])).rows[0];assert.ok(receipt);
   const approval=await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Совместная проверка оплаты и полного возврата.'});
   const remote=provider(item,approval.id,shop),refundWorker=load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,remote.fetcher);
   assert.deepEqual(await refundWorker.tick(),{state:'completed'});assert.equal(remote.posts(),1);
   assert.deepEqual(await paymentWorker.tick(),{state:'idle'});
   const verifyModule=createRequire(import.meta.url)(join(artifact,'compiled/lib/postgres-payment-verification.js'));
   assert.equal((await new verifyModule.PostgresPaymentVerificationStore(db,shop,paymentFetch).reconcile(item.id)).orderStatus,'refunded');
   const fulfillModule=createRequire(import.meta.url)(join(artifact,'compiled/lib/postgres-listing-payment-fulfillment.js'));
   assert.equal((await new fulfillModule.PostgresListingPaymentFulfillmentStore(db,shop).fulfill(item.id)).state,'fulfilled');
   assert.deepEqual((await admin.query('select status,is_paid from app.listings where id=$1',[item.targetId])).rows[0],{status:'archived',is_paid:false});
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
   assert.deepEqual((await admin.query('select published_at,expires_at from app.payment_fulfillments where intent_id=$1',[item.id])).rows,[receipt]);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
   assert.deepEqual(paymentCalls,['GET','GET']);await check();
  });
  await suite.test('refund reservation blocks actual restricted reconciliation without publishing or extending a period',async()=>{
   const shop={...merchant,shopId:'coexist-fence-'+randomBytes(6).toString('hex')},item=await purchase({scope:shop});
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[item.targetId]);
   const approval=await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Возврат до исполнения оплаченного размещения.'});
   await new (load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(refundDb,shop).reserve(item.id,approval.id);
   const queue=new (load('postgres-payment-reconciliation').PostgresPaymentReconciliationQueue)(ownerDb,shop);
   assert.equal(await queue.enqueue(item.providerPaymentId),true);
   const remote=provider(item,approval.id,shop),workerModule=createRequire(import.meta.url)(join(artifact,'compiled/lib/payment-reconciliation-worker.js'));
   await check();
   assert.deepEqual(await workerModule.createPaymentReconciliationWorker(db,shop,remote.fetcher).tick(),{state:'blocked',code:'publication_blocked'});
   assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[item.targetId])).rows[0],{status:'draft',is_paid:false,published_at:null,expires_at:null});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[item.id])).rows[0].n,0);
   assert.deepEqual((await admin.query('select state,last_code from app.payment_reconciliation_jobs where intent_id=$1',[item.id])).rows[0],{state:'blocked',last_code:'publication_blocked'});
   assert.equal(remote.posts(),0);
   assert.deepEqual(await load('placement-refund-worker').createPlacementRefundWorker(refundDb,shop,remote.fetcher).tick(),{state:'completed'});
   assert.equal(remote.posts(),1);await check();
  });
 }finally{await db?.close();rmSync(owned,{recursive:true,force:true});}
}
