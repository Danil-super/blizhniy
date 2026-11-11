import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';

// Only the existing owned disposable PG54 fixture passes these synthetic credentials.
export async function testRefundWorkerArtifact(suite,{admin,config,ownerDb,purchase,load,operator,merchant,provider}){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');assert.equal(config.user,'blizhniy_refund_worker');
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-refund-artifact-pg-'));
 let db,unexpectedHttp=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{unexpectedHttp++;throw Error('Unexpected provider network');};
 try{
  const artifact=join(owned,'artifact');buildRefundWorker(artifact);
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const require=createRequire(import.meta.url),compiled=name=>require(join(artifact,'compiled/lib',name+'.js'));
  db=new (compiled('postgres').PostgresDatabase)(new pg.Pool({...config,max:3}));
  const {verifyRefundWorkerDatabase}=await import(pathToFileURL(join(artifact,'scripts/refund-worker-role.mjs')).href);
  const check=()=>verifyRefundWorkerDatabase(db,{database:config.database,merchant});
  await suite.test('compiled refund package passes its copied role/schema preflight and refuses drift or extra privileges',async()=>{
   await check();
   const original=(await admin.query("select pg_get_functiondef('app.claim_placement_refund_job(text)'::regprocedure) as sql")).rows[0].sql;
   await admin.query('alter function app.claim_placement_refund_job(text) security invoker');
   try{await assert.rejects(check(),{message:'Refund worker database preflight failed'});}finally{await admin.query(original);}
   await check();
   await admin.query('grant select(email) on app.users to blizhniy_refund_worker');
   try{await assert.rejects(check(),{message:'Refund worker database preflight failed'});}finally{await admin.query('revoke select(email) on app.users from blizhniy_refund_worker');}
   await check();
  });
  await suite.test('compiled placement consumer refunds each target once using the dedicated role and fake HTTP',async()=>{
   for(const kind of ['listing','vacancy','workRequest']){
    const shop={...merchant,shopId:'artifact-'+randomBytes(6).toString('hex')},item=await purchase({kind,scope:shop});
    const approval=await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,{id:randomUUID(),paymentIntentId:item.id,reason:'Возврат для проверки автономного пакета.'});
    if(kind==='listing')await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,shop,{postmoderation:true}).fulfill(item.id);
    const remote=provider(item,approval.id,shop),worker=compiled('placement-refund-worker').createPlacementRefundWorker(db,shop,remote.fetcher);
    await check();assert.deepEqual(await worker.tick(),{state:'completed'});
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
    assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
    assert.equal(remote.posts(),1);assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(remote.posts(),1);
   }
  });
  await suite.test('compiled response consumer discovers an unread paid response and compensates it once',async()=>{
   const shop={...merchant,shopId:'artifact-response-'+randomBytes(6).toString('hex')},work=await purchase({kind:'workRequest',scope:shop});
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-interval '7 days',clock_timestamp()-interval '6 days') returning id",[operator.id,work.targetId,randomUUID()])).rows[0].id;
   const id=randomUUID(),item={id,ownerId:operator.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:shop.shopId,isTest:true,providerPaymentId:randomUUID(),capturedAt:new Date(Date.now()-6*86400000-1000).toISOString()};
   item.metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
   const requestBody=JSON.stringify({amount:{value:item.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:item.metadata});
   await ownerDb.transaction(async tx=>{
    const {providerPaymentId,capturedAt,metadata,...binding}=item;assert.ok(providerPaymentId&&capturedAt&&metadata);
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,item.ownerId,randomUUID(),application]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,item.providerPaymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,item.providerPaymentId,item.capturedAt]);
   });
   const remote=provider(item,id,shop),worker=compiled('application-compensation-worker').createApplicationCompensationWorker(db,shop,remote.fetcher);
   let completed=false;
   for(let page=0;page<100;page++){const result=await worker.sweep();if(result.processing.state==='completed'){completed=true;break;}}
   assert.equal(completed,true);
   assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['application_compensation:'+id])).rows[0].n,1);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[id])).rows[0].status,'refunded');
   assert.equal((await admin.query('select status from app.applications where id=$1',[application])).rows[0].status,'sent');
   assert.equal(remote.posts(),1);assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(remote.posts(),1);
   await check();
  });
  assert.equal(unexpectedHttp,0);
 }finally{globalThis.fetch=originalFetch;try{await db?.close();}finally{rmSync(owned,{recursive:true,force:true});}}
}
