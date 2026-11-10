import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function testApplicationCompensationQueue(suite,{admin,db,store,merchant,config,purchase,provider,load,effects,notifications}) {
 await admin.query(await readFile(new URL('../database/migrations/0049-application-compensation-queue.sql',import.meta.url),'utf8'));
 await admin.query(`grant execute on function app.enqueue_application_compensation_batch(text,integer),app.claim_application_compensation_job(text),
  app.owns_application_compensation_job(text,uuid,uuid),app.finish_application_compensation_job(text,uuid,uuid,text,text),app.assert_application_compensation_job(text,uuid,uuid) to compensation_refund_worker`);
 const {PostgresApplicationCompensationQueue}=load('postgres-application-compensation-queue'),{createApplicationCompensationWorker}=load('application-compensation-worker');
 const queue=new PostgresApplicationCompensationQueue(db,merchant);
 const job=async id=>(await admin.query('select * from app.application_compensation_jobs where payment_intent_id=$1',[id])).rows[0];
 const due=id=>admin.query("update app.application_compensation_jobs set available_at=clock_timestamp()-interval '1 second' where payment_intent_id=$1",[id]);
 const clear=()=>admin.query("update app.application_compensation_jobs set state='blocked',claim_id=null,last_code='source_unavailable' where state in ('queued','processing')");
 const fresh=async()=>{await clear();const item=await purchase();await store.claim(item.id);return item;};
 const makeWorker=(remote,database=db)=>createApplicationCompensationWorker(database,config,remote.fetcher);
 async function waitForFinancialLock(){
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){if((await admin.query("select count(*)::int as n from pg_stat_activity where usename='compensation_refund_worker' and wait_event_type='Lock'")).rows[0].n>0)return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail('Financial operation did not reach the real lock wait');
 }
 await suite.test('durable compensation jobs exist for automatic recovery after restart',async()=>{
  assert.notEqual((await admin.query("select to_regclass('app.application_compensation_jobs') as name")).rows[0].name,null);
 });
 await suite.test('bounded cursor backfill advances past existing effects and terminal history',async()=>{
  let finished=false,total=0;
  for(let page=0;page<20;page++){
   const count=await queue.enqueueBatch(3);assert.ok(count>=0&&count<=3);total+=count;
   if(count===0){finished=true;break;}
  }
  assert.ok(finished);assert.ok(total>3);
  assert.equal((await admin.query(`select count(*)::int as n from app.application_compensation_cases c left join app.application_compensation_jobs q on q.payment_intent_id=c.payment_intent_id where c.merchant_shop_id=$1 and q.payment_intent_id is null`,[merchant.shopId])).rows[0].n,0);
  assert.equal((await admin.query(`select count(*)::int as n from app.application_compensation_jobs q join app.application_compensation_refunds f using(payment_intent_id) where q.state<>'completed'`)).rows[0].n,0);
  assert.equal(await queue.enqueueBatch(3),0);
 });
 await suite.test('a committed case automatically enqueues once and one tick applies its refund',async()=>{
  const item=await fresh(),remote=await provider(item);assert.equal((await job(item.id)).state,'queued');await store.claim(item.id);
  assert.equal((await makeWorker(remote).tick()).state,'completed');assert.equal((await job(item.id)).state,'completed');
  assert.equal(await effects(item),1);assert.equal(await notifications(item),1);assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);
  const previous=remote.calls.length;assert.equal((await makeWorker(remote).tick()).state,'idle');assert.equal(remote.calls.length,previous);
 });
 await suite.test('a case committing behind the backfill cursor still has its automatically inserted job',async()=>{
  await clear();const late=await purchase(),lock=await admin.connect();
  try{await lock.query('begin');await lock.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[late.id,merchant.shopId]);
   const newer=await purchase();await store.claim(newer.id);for(let page=0;page<20;page++)if(await queue.enqueueBatch(100)===0)break;
   await lock.query('commit');assert.equal((await job(late.id)).state,'queued');assert.equal((await queue.claim()).paymentIntentId,late.id);
  }finally{await lock.query('rollback');lock.release();}
 });
 await suite.test('lease expiry replaces the nonce and old workers cannot acknowledge or pass admission',async()=>{
  const item=await fresh(),first=await queue.claim();assert.equal(first.paymentIntentId,item.id);assert.equal(await queue.owns(first),true);
  assert.equal(await queue.claim(),null);await due(item.id);const second=await queue.claim();assert.notEqual(first.claimId,second.claimId);assert.equal(second.attempts,2);
  assert.equal(await queue.owns(first),false);assert.equal(await queue.finish(first,'retry','processing_unavailable'),false);
  await assert.rejects(db.transaction(tx=>queue.assertActive(first,tx)),{code:'PBQ01'});assert.equal(await queue.owns(second),true);
  await assert.rejects(queue.finish(second,'completed'),{code:'23514'});
 });
 await suite.test('concurrent claimers skip a real locked queue row and acquire different jobs',async()=>{
  const first=await fresh(),second=await purchase();await store.claim(second.id);
  const lock=await admin.connect();try{await lock.query('begin');await lock.query('select payment_intent_id from app.application_compensation_jobs where payment_intent_id=$1 for update',[first.id]);
   const claim=await queue.claim();assert.equal(claim.paymentIntentId,second.id);await lock.query('commit');const next=await queue.claim();assert.equal(next.paymentIntentId,first.id);assert.notEqual(claim.claimId,next.claimId);
  }finally{await lock.query('rollback');lock.release();}
 });
 await suite.test('pending refund defers with persisted backoff and canceled becomes terminal blocked',async()=>{
  for(const status of ['pending','canceled']){
   const item=await fresh(),remote=await provider(item);remote.state.status=status;
   const result=await makeWorker(remote).tick();assert.equal(result.state,status==='pending'?'deferred':'blocked');assert.equal(result.code,'provider_'+status);
   const row=await job(item.id);assert.equal(row.state,status==='pending'?'queued':'blocked');assert.equal(row.attempts,1);assert.equal(await effects(item),0);assert.equal(await queue.claim(),null);
   if(status==='pending'){await due(item.id);remote.state.status='succeeded';const previous=remote.calls.length;assert.equal((await makeWorker(remote).tick()).state,'completed');assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));}
  }
 });
 await suite.test('terminal-effect recovery after a lost acknowledgement completes without provider HTTP',async()=>{
  const item=await fresh(),remote=await provider(item);await queue.claim();assert.equal((await remote.processor.process(item.id)).state,'applied');await due(item.id);
  const previous=remote.calls.length;assert.equal((await makeWorker(remote).tick()).state,'completed');assert.equal(remote.calls.length,previous);assert.equal(await notifications(item),1);
 });
 await suite.test('unknown claim COMMIT stops before network and lease expiry safely recovers the same case',async()=>{
  const item=await fresh(),remote=await provider(item);let lose=true;
  const uncertain={transaction:async work=>{
   let claimed=false;const value=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.includes('app.claim_application_compensation_job'))claimed=true;return tx.query(sql,values);}}));
   if(claimed&&lose){lose=false;throw Error('Synthetic lost claim COMMIT');}return value;
  }};
  await assert.rejects(makeWorker(remote,uncertain).tick(),/lost claim COMMIT/);assert.equal(remote.calls.length,0);assert.equal((await job(item.id)).state,'processing');
  await due(item.id);assert.equal((await makeWorker(remote).tick()).state,'completed');assert.equal(await effects(item),1);
 });
 await suite.test('unknown finish COMMIT is not retried and a restart performs no second provider request',async()=>{
  const item=await fresh(),remote=await provider(item);let lose=true;
  const uncertain={transaction:async work=>{
   let finished=false;const value=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.includes('app.finish_application_compensation_job'))finished=true;return tx.query(sql,values);}}));
   if(finished&&lose){lose=false;throw Error('Synthetic lost finish COMMIT');}return value;
  }};
  await assert.rejects(makeWorker(remote,uncertain).tick(),/lost finish COMMIT/);assert.equal((await job(item.id)).state,'completed');assert.equal(await effects(item),1);
  const previous=remote.calls.length;assert.equal((await makeWorker(remote).tick()).state,'idle');assert.equal(remote.calls.length,previous);assert.equal(await notifications(item),1);
 });
 await suite.test('lease loss during provider inspection prevents a durable send authorization and POST',async()=>{
  const item=await fresh(),remote=await provider(item);let reclaimed;
  const fetcher=async(value,init)=>{const result=await remote.fetcher(value,init);if(!reclaimed&&init.method==='GET'){await due(item.id);reclaimed=await queue.claim();}return result;};
  assert.equal((await createApplicationCompensationWorker(db,config,fetcher).tick()).state,'lost');assert.ok(reclaimed.claimId);assert.equal(remote.calls.filter(call=>call.method==='POST').length,0);
  assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[item.id])).rows[0].n,0);assert.equal((await job(item.id)).claim_id,reclaimed.claimId);
 });
 await suite.test('a send waiting on a financial lock rechecks the nonce in the same transaction before writing attempts',async()=>{
  const item=await fresh(),claim=await queue.claim();const refunds=new (load('postgres-application-compensation-refund').PostgresApplicationCompensationRefundStore)(db,merchant);
  await refunds.reserve(item.id);await new (load('postgres-refund-requests').PostgresRefundRequestStore)(db,merchant).prepare(item.id);
  const lock=await admin.connect();let pending;
  try{await lock.query('begin');await lock.query('select id from app.users where id=$1 for update',[item.applicant]);
   pending=new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(db,merchant).authorize(item.id,randomUUID(),tx=>queue.assertActive(claim,tx));
   const rejected=assert.rejects(pending,{code:'PBQ01'});await waitForFinancialLock();await due(item.id);const next=await queue.claim();assert.notEqual(next.claimId,claim.claimId);await lock.query('commit');await rejected;
  }finally{await lock.query('rollback');lock.release();if(pending)await pending.catch(()=>{});}
  assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[item.id])).rows[0].n,0);
 });
 await suite.test('an effect waiting on a financial lock cannot apply after its lease was reclaimed',async()=>{
  const item=await fresh(),claim=await queue.claim(),remote=await provider(item),refunds=new (load('postgres-application-compensation-refund').PostgresApplicationCompensationRefundStore)(db,merchant);
  await refunds.reserve(item.id);await new (load('postgres-refund-requests').PostgresRefundRequestStore)(db,merchant).prepare(item.id);
  await load('primary-refund-dispatch').createPrimaryRefundDispatcher(db,config,remote.fetcher).dispatch(item.id,()=>refunds.assertDispatch(item.id));
  const lock=await admin.connect();let pending;
  try{await lock.query('begin');await lock.query('select id from app.users where id=$1 for update',[item.applicant]);pending=refunds.apply(item.id,tx=>queue.assertActive(claim,tx));
   const rejected=assert.rejects(pending,{code:'PBQ01'});await waitForFinancialLock();await due(item.id);await queue.claim();await lock.query('commit');await rejected;
  }finally{await lock.query('rollback');lock.release();if(pending)await pending.catch(()=>{});}
  assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
 });
 await suite.test('queue claims are capped at twelve while the original refund remains pending',async()=>{
  const item=await fresh(),remote=await provider(item);remote.state.status='pending';
  for(let attempt=1;attempt<=12;attempt++){if(attempt>1)await due(item.id);assert.equal((await makeWorker(remote).tick()).state,'deferred');}
  const calls=remote.calls.length;assert.deepEqual(await makeWorker(remote).tick(),{state:'blocked',code:'attempts_exhausted'});assert.equal(remote.calls.length,calls);
  const row=await job(item.id);assert.equal(row.attempts,12);assert.equal(row.last_code,'attempts_exhausted');assert.equal(await queue.claim(),null);assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);assert.equal(await effects(item),0);
 });
 await suite.test('lost financial effect ACK on the final attempt still recovers completion without provider HTTP',async()=>{
  const item=await fresh(),remote=await provider(item);await admin.query('update app.application_compensation_jobs set attempts=11 where payment_intent_id=$1',[item.id]);let lose=true;
  const uncertain={transaction:async work=>{
   let effect=false;const value=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.startsWith('insert into app.application_compensation_refunds'))effect=true;return tx.query(sql,values);}}));
   if(effect&&lose){lose=false;throw Error('Synthetic final effect ACK loss');}return value;
  }};
  await makeWorker(remote,uncertain).tick();assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
  await due(item.id);const previous=remote.calls.length;assert.equal((await makeWorker(remote).tick()).state,'completed');assert.equal(remote.calls.length,previous);assert.equal((await job(item.id)).attempts,12);assert.equal(await notifications(item),1);
 });
 await suite.test('another merchant and direct operational writes have no authority over these jobs',async()=>{
  const item=await fresh(),other=new PostgresApplicationCompensationQueue(db,{...merchant,shopId:'different-fixture'});assert.equal(await other.claim(),null);
  const claim=await queue.claim();assert.equal(claim.paymentIntentId,item.id);assert.equal(await other.owns(claim),false);assert.equal(await other.finish(claim,'retry','processing_unavailable'),false);
  for(const sql of ["select * from app.application_compensation_jobs","update app.application_compensation_jobs set state='completed' where false","delete from app.application_compensation_jobs where false","update app.application_compensation_queue_cursors set after_payment_id=gen_random_uuid() where false"]){await assert.rejects(db.query(sql),{code:'42501'});}
  await assert.rejects(db.query('select app.enqueue_application_compensation_batch($1,101)',[merchant.shopId]),{code:'22023'});
 });
}
