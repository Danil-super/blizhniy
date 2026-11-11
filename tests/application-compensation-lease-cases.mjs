import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testApplicationCompensationLease(suite,{admin,db,purchase,provider,load,effects,notifications}){
 const {PostgresApplicationCompensationQueue}=load('postgres-application-compensation-queue'),{createApplicationCompensationWorker}=load('application-compensation-worker');
 async function setup(){
  const merchant={shopId:'lease-'+randomUUID().slice(0,8),isTest:true},config={...merchant,secretKey:'test_synthetic_lease'};
  const item=await purchase({scope:merchant});await new (load('postgres-application-compensation').PostgresApplicationCompensationStore)(db,merchant).claim(item.id);
  const remote=await provider(item,merchant),queue=new PostgresApplicationCompensationQueue(db,merchant);
  return{merchant,config,item,remote,queue,worker:database=>createApplicationCompensationWorker(database??db,config,remote.fetcher)};
 }
 await suite.test('remaining lease is merchant/nonce scoped and the original void admission capability remains available',async()=>{
  const value=await setup(),claim=await value.queue.claim();
  const remaining=await db.transaction(tx=>value.queue.remaining(claim,tx));assert.ok(Number.isInteger(remaining)&&remaining>0&&remaining<=300000);
  await db.transaction(tx=>value.queue.assertActive(claim,tx));
  const other=new PostgresApplicationCompensationQueue(db,{...value.merchant,shopId:'different-lease'});
  await assert.rejects(db.transaction(tx=>other.remaining(claim,tx)),{code:'PBQ01'});
  await assert.rejects(db.transaction(tx=>value.queue.remaining({...claim,claimId:randomUUID()},tx)),{code:'PBQ01'});
  await admin.query("update app.application_compensation_jobs set available_at=clock_timestamp()-interval '1 second' where payment_intent_id=$1",[value.item.id]);
  await assert.rejects(db.transaction(tx=>value.queue.remaining(claim,tx)),{code:'PBQ01'});assert.equal(value.remote.calls.length,0);
 });
 await suite.test('missing new lease capability fails closed before provider access and a later correctly granted claim recovers',async()=>{
  const value=await setup();
  await admin.query('revoke execute on function app.assert_application_compensation_job_remaining(text,uuid,uuid) from compensation_refund_worker');
  try{
   assert.equal((await value.worker().tick()).state,'deferred');assert.equal(value.remote.calls.length,0);assert.equal(await effects(value.item),0);assert.equal(await notifications(value.item),0);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[value.item.id])).rows[0].n,0);
  }finally{await admin.query('grant execute on function app.assert_application_compensation_job_remaining(text,uuid,uuid) to compensation_refund_worker');}
  await admin.query("update app.application_compensation_jobs set available_at=clock_timestamp()-interval '1 second' where payment_intent_id=$1",[value.item.id]);
  assert.equal((await value.worker().tick()).state,'completed');assert.equal(value.remote.calls.filter(c=>c.method==='POST').length,1);assert.equal(await effects(value.item),1);assert.equal(await notifications(value.item),1);
 });
 await suite.test('compensation POST is fenced after a delayed final admission COMMIT exceeds its lease',async()=>{
  const value=await setup();let gates=0;
  const delayed={transaction:async work=>{
   let pause=false;
   const result=await db.transaction(tx=>work({query:async(sql,values)=>{
    if(sql.includes('app.assert_application_compensation_job')&&++gates===3){
     await admin.query("update app.application_compensation_jobs set available_at=clock_timestamp()+interval '150 milliseconds' where payment_intent_id=$1",[value.item.id]);pause=true;
    }
    return tx.query(sql,values);
   }}));
   if(pause)await new Promise(resolve=>setTimeout(resolve,220));return result;
  }};
  assert.equal((await value.worker(delayed).tick()).state,'lost');assert.ok(gates>=3);assert.equal(value.remote.calls.filter(c=>c.method==='POST').length,0);
  assert.equal(await effects(value.item),0);assert.equal(await notifications(value.item),0);
  assert.equal((await value.worker().tick()).state,'completed');assert.equal(value.remote.calls.filter(c=>c.method==='POST').length,1);assert.equal(await effects(value.item),1);
 });
 await suite.test('expiry during the effect application FK lock wait rolls back money and notice, preserving the response',async()=>{
  const value=await setup(),refunds=new (load('postgres-application-compensation-refund').PostgresApplicationCompensationRefundStore)(db,value.merchant);
  const claim=await value.queue.claim();await refunds.reserve(value.item.id);await new (load('postgres-refund-requests').PostgresRefundRequestStore)(db,value.merchant).prepare(value.item.id);
  await load('primary-refund-dispatch').createPrimaryRefundDispatcher(db,value.config,value.remote.fetcher).dispatch(value.item.id,()=>refunds.assertDispatch(value.item.id));
  const before=(await admin.query('select snapshot,status,is_paid,sent_at from app.applications where id=$1',[value.item.application])).rows[0],locker=await admin.connect();let outcome;
  try{
   await locker.query('begin');await locker.query('select id from app.applications where id=$1 for update',[value.item.application]);
   await admin.query("update app.application_compensation_jobs set available_at=clock_timestamp()+interval '700 milliseconds' where payment_intent_id=$1",[value.item.id]);
   outcome=refunds.apply(value.item.id,tx=>value.queue.assertActive(claim,tx)).then(result=>({result}),error=>({error}));
   const deadline=Date.now()+1500;let waiting=false;
   while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='compensation_refund_worker' and wait_event_type='Lock' and query like 'insert into app.application_compensation_refunds%') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(waiting,true);await new Promise(resolve=>setTimeout(resolve,750));await locker.query('commit');assert.equal((await outcome).error?.code,'PBQ01');
   assert.equal(await effects(value.item),0);assert.equal(await notifications(value.item),0);assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'succeeded');
   assert.deepEqual((await admin.query('select snapshot,status,is_paid,sent_at from app.applications where id=$1',[value.item.application])).rows[0],before);
  }finally{await locker.query('rollback');locker.release();if(outcome)await outcome;}
  const calls=value.remote.calls.length;assert.equal((await value.worker().tick()).state,'completed');assert.ok(value.remote.calls.slice(calls).every(c=>c.method==='GET'));assert.equal(await effects(value.item),1);assert.equal(await notifications(value.item),1);
 });
}
