import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

export async function testPlacementRefundQueue(suite,{admin,ownerDb,purchase,load,operator,merchant}){
 for(const name of ['0043-application-compensation-cases.sql','0044-work-owner-actions.sql','0045-customer-closure-compensation.sql','0046-response-checkout-fence.sql','0047-checkout-cancellation.sql','0048-application-compensation-refunds.sql','0049-application-compensation-queue.sql','0050-application-compensation-discovery.sql','0051-refund-recovery.sql','0052-placement-refund-queue.sql'])await admin.query(await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8'));
 const {PostgresDatabase}=load('postgres'),{PostgresPlacementRefundQueue}=load('postgres-placement-refund-queue'),{createPlacementRefundWorker}=load('placement-refund-worker');
 const password=randomBytes(24).toString('hex');
 await admin.query(`create role placement_queue_worker login password ${pg.escapeLiteral(password)} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  grant connect on database blizhniy_test to placement_queue_worker;grant usage on schema app to placement_queue_worker;
  grant select(id),update(id) on app.users to placement_queue_worker;
  grant select on app.payment_checkout_intents,app.payment_orders,app.payment_provider_links,app.payment_verifications,
   app.payment_refund_approvals,app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,
   app.payment_refund_send_attempts,app.payment_refund_candidates,app.payment_refund_provider_links,app.payment_refund_observations,app.payment_refund_effects to placement_queue_worker;
  grant update(id) on app.payment_checkout_intents,app.payment_orders to placement_queue_worker;
  grant insert(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) on app.payment_refund_reservations to placement_queue_worker;
  grant insert(operation_id,idempotence_key,request_body) on app.payment_refund_requests to placement_queue_worker;
  grant insert(operation_id) on app.payment_refund_dispatch_anchors to placement_queue_worker;
  grant insert(id,operation_id) on app.payment_refund_send_attempts to placement_queue_worker;
  grant insert(operation_id,attempt_id,provider_refund_id) on app.payment_refund_candidates to placement_queue_worker;
  grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to placement_queue_worker;
  grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to placement_queue_worker;
  grant insert(operation_id,merchant_shop_id) on app.payment_refund_effects to placement_queue_worker;
  grant execute on function app.enqueue_placement_refund_batch(text,integer),app.claim_placement_refund_job(text),app.owns_placement_refund_job(text,uuid,uuid),app.assert_placement_refund_job(text,uuid,uuid),app.finish_placement_refund_job(text,uuid,uuid,text,text) to placement_queue_worker`);
 const db=new PostgresDatabase(new pg.Pool({...admin.options,user:'placement_queue_worker',password,max:5}));
 const scope=()=>({...merchant,shopId:'placement-'+randomBytes(8).toString('hex')});
 async function setup(options={}){
  const shop=options.scope??scope(),item=await purchase({...options,scope:shop});
  const proposal={id:options.approvalId??randomUUID(),paymentIntentId:item.id,reason:'Возврат по обращению владельца.'};
  const approval=options.approved===false?proposal:await new (load('postgres-refund-approvals').PostgresRefundApprovalStore)(ownerDb,shop).approve(operator.token,operator.id,proposal);
  const queue=new PostgresPlacementRefundQueue(db,shop),calls=[],state={status:'succeeded',losePost:false,postHook:null,refundId:randomUUID(),createdAt:new Date().toISOString()};
  const refund=()=>({id:state.refundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:state.status,created_at:state.createdAt,metadata:{localRefundId:approval.id,localPaymentId:item.id}});
  const fetcher=async(value,init)=>{
   const url=String(value);calls.push({url,method:init.method,body:init.body,key:init.headers['Idempotence-Key']});assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
   if(init.method==='POST'){
    assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+approval.id);
    assert.deepEqual(JSON.parse(init.body),{payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},metadata:{localRefundId:approval.id,localPaymentId:item.id}});
    if(state.postHook)await state.postHook();if(state.losePost)throw Error('Synthetic unknown refund');return Response.json(refund());
   }
   assert.equal(init.method,'GET');
   if(url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:item.capturedAt,recipient:{account_id:shop.shopId},metadata:item.metadata});
   if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
   assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+state.refundId);return Response.json(refund());
  };
  return{item,approval,shop,queue,calls,state,fetcher,worker:createPlacementRefundWorker(db,shop,fetcher)};
 }
 const due=async value=>admin.query("update app.placement_refund_jobs set available_at=clock_timestamp()-interval '1 second' where approval_id=$1",[value.approval.id]);
 const job=async value=>(await admin.query('select state,attempts,claim_id,last_code from app.placement_refund_jobs where approval_id=$1',[value.approval.id])).rows[0];
 const notices=async value=>(await admin.query('select title,body,action_href from app.notifications where user_id=$1 and event_key=$2',[value.item.ownerId,'placement_refund:'+value.item.id])).rows;
 const effects=async value=>(await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[value.approval.id])).rows[0].n;
 try{
  await suite.test('approved full TEST placement queues once and completes with one effect and notice for all three target types',async()=>{
   for(const kind of ['listing','vacancy','workRequest'])for(const receipt of [false,true]){
    const value=await setup({kind,receipt});assert.equal((await job(value)).state,'queued');
    if(kind==='listing')assert.equal((await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,value.shop,{postmoderation:true}).fulfill(value.item.id)).state,'fulfilled');
    assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.equal(await effects(value),1);assert.equal(value.calls.filter(c=>c.method==='POST').length,1);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'refunded');
    assert.deepEqual((await notices(value)).map(n=>n.action_href),[kind==='listing'?'/cabinet/obyavleniya':kind==='vacancy'?'/cabinet/vakansii':'/cabinet/zakazy']);assert.ok((await notices(value))[0].body.includes(value.approval.reason));
    if(kind==='listing')assert.equal((await admin.query('select status from app.listings where id=$1',[value.item.targetId])).rows[0].status,'archived');
    const count=value.calls.length;assert.deepEqual(await value.worker.tick(),{state:'idle'});assert.equal(value.calls.length,count);assert.equal((await job(value)).state,'completed');
   }
  });
  await suite.test('pending is retried only by GET and canceled never changes money or sends a success notice',async()=>{
   for(const status of ['pending','canceled']){
    const value=await setup();value.state.status=status;assert.deepEqual(await value.worker.tick(),{state:status==='pending'?'deferred':'blocked',code:'provider_'+status});assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);
    const before=value.calls.length;
    if(status==='pending'){value.state.status='succeeded';await due(value);assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.ok(value.calls.slice(before).every(c=>c.method==='GET'));assert.equal((await notices(value)).length,1);}
    else{assert.deepEqual(await value.worker.tick(),{state:'idle'});assert.equal(value.calls.length,before);}
   }
  });
  await suite.test('unknown claim COMMIT performs no HTTP and a later lease recovers the original approval',async()=>{
   const value=await setup();let lose=true;
   const ambiguous={transaction:async work=>{let hit=false;const result=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.includes('claim_placement_refund_job'))hit=true;return tx.query(sql,values);}}));if(hit&&lose){lose=false;throw Error('Synthetic claim COMMIT lost');}return result;}};
   await assert.rejects(createPlacementRefundWorker(ambiguous,value.shop,value.fetcher).tick(),/claim COMMIT lost/);assert.equal(value.calls.length,0);
   await due(value);assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.equal(await effects(value),1);assert.equal(value.calls.filter(c=>c.method==='POST').length,1);
  });
  await suite.test('unknown effect COMMIT completes from local proof without provider access or duplicate/deleted notices',async()=>{
   const value=await setup();let lose=true;
   const ambiguous={transaction:async work=>{let hit=false;const result=await db.transaction(tx=>work({query:(sql,values)=>{if(sql.startsWith('insert into app.payment_refund_effects'))hit=true;return tx.query(sql,values);}}));if(hit&&lose){lose=false;throw Error('Synthetic effect COMMIT lost');}return result;}};
   assert.equal((await createPlacementRefundWorker(ambiguous,value.shop,value.fetcher).tick()).state,'deferred');assert.equal(await effects(value),1);assert.equal((await notices(value)).length,1);
   await admin.query('delete from app.notifications where user_id=$1 and event_key=$2',[value.item.ownerId,'placement_refund:'+value.item.id]);await admin.query('update app.placement_refund_jobs set attempts=12 where approval_id=$1',[value.approval.id]);await due(value);
   assert.deepEqual(await createPlacementRefundWorker(db,value.shop,async()=>{throw Error('No HTTP after durable effect');}).tick(),{state:'completed'});assert.deepEqual(await notices(value),[]);assert.equal(await effects(value),1);
  });
  await suite.test('twelve operational attempts block; neither a forged completion nor stale claim can finish',async()=>{
   const value=await setup();let old;
   for(let n=0;n<12;n++){
    const claim=await value.queue.claim();assert.equal(claim.attempts,n+1);if(old)assert.equal(await value.queue.finish(old,'retry','processing_unavailable'),false);
    await assert.rejects(value.queue.finish(claim,'completed'));assert.equal(await value.queue.finish(claim,'retry','processing_unavailable'),true);old=claim;await due(value);
   }
   assert.deepEqual(await value.worker.tick(),{state:'blocked',code:'attempts_exhausted'});assert.equal(value.calls.length,0);assert.equal((await job(value)).attempts,12);
  });
  await suite.test('bounded backfill visits old approvals and concurrent consumers skip a locked job',async()=>{
   const boundary=(await admin.query(`select to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as approved_at,id from app.payment_refund_approvals order by approved_at desc,id desc limit 1`)).rows[0];
   const shared=scope(),values=[];for(let n=0;n<4;n++)values.push(await setup({scope:shared}));
   await admin.query('insert into app.placement_refund_queue_cursors(merchant_shop_id,after_created_at,after_approval) values($1,$2,$3)',[shared.shopId,boundary.approved_at,boundary.id]);
   await admin.query('delete from app.placement_refund_jobs where merchant_shop_id=$1',[shared.shopId]);
   assert.equal(await values[0].queue.enqueueBatch(2),2);assert.equal((await admin.query('select count(*)::int as n from app.placement_refund_jobs where merchant_shop_id=$1',[shared.shopId])).rows[0].n,2);
   assert.equal(await values[0].queue.enqueueBatch(2),2);assert.equal(await values[0].queue.enqueueBatch(2),0);
   const locker=await admin.connect();try{await locker.query('begin');await locker.query('select approval_id from app.placement_refund_jobs where approval_id=$1 for update',[values[0].approval.id]);const claims=await Promise.all([values[0].queue.claim(),values[0].queue.claim()]);assert.equal(new Set(claims.map(c=>c.approvalId)).size,2);assert.ok(claims.every(c=>c.approvalId!==values[0].approval.id));}finally{await locker.query('rollback');locker.release();}
   const wrong=new PostgresPlacementRefundQueue(db,scope());assert.equal(await wrong.claim(),null);await assert.rejects(wrong.assertActive(await values[0].queue.claim(),{query:(sql,params)=>db.query(sql,params)}));
  });
  await suite.test('backfill advances across bounded raw history even when every approval belongs to another merchant',async()=>{
   const shop=scope(),queue=new PostgresPlacementRefundQueue(db,shop),total=(await admin.query('select count(*)::int as n from app.payment_refund_approvals')).rows[0].n;
   let visited=0;
   for(let page=0;page<=Math.ceil(total/2);page++){const count=await queue.enqueueBatch(2);assert.ok(count>=0&&count<=2);visited+=count;if(count===0)break;}
   assert.equal(visited,total);assert.equal(await queue.enqueueBatch(2),0);assert.equal(await queue.claim(),null);
   assert.equal((await admin.query('select count(*)::int as n from app.placement_refund_jobs where merchant_shop_id=$1',[shop.shopId])).rows[0].n,0);
  });
  await suite.test('private queue worker cannot approve, reset queue, write notices, change money or read account credentials',async()=>{
   for(const sql of ["insert into app.payment_refund_approvals default values","update app.placement_refund_jobs set attempts=0 where false","select * from app.placement_refund_jobs","update app.payment_orders set status='refunded' where false","insert into app.notifications default values","select email from app.users","delete from app.placement_refund_queue_cursors where false"])
    await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('a delayed admission COMMIT cannot issue POST after the lease expired; a new claim keeps the original key',async()=>{
   const value=await setup();let gates=0;
   const delayed={transaction:async work=>{
    let pause=false;
    const result=await db.transaction(tx=>work({query:async(sql,values)=>{
     if(sql.includes('assert_placement_refund_job')&&++gates===3){
      await admin.query("update app.placement_refund_jobs set available_at=clock_timestamp()+interval '150 milliseconds' where approval_id=$1",[value.approval.id]);pause=true;
     }
     return tx.query(sql,values);
    }}));
    if(pause)await new Promise(resolve=>setTimeout(resolve,220));return result;
   }};
   assert.equal((await createPlacementRefundWorker(delayed,value.shop,value.fetcher).tick()).state,'lost');assert.equal(gates>=3,true);assert.equal(value.calls.filter(c=>c.method==='POST').length,0);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[value.approval.id])).rows[0].n,1);
   assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.equal(value.calls.filter(c=>c.method==='POST').length,1);assert.equal(await effects(value),1);
  });
  await suite.test('a lease lost after provider success cannot apply an effect; the next claim uses GET only',async()=>{
   const value=await setup();value.state.postHook=()=>due(value);
   assert.equal((await value.worker.tick()).state,'lost');assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'succeeded');
   const before=value.calls.length;value.state.postHook=null;assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.ok(value.calls.slice(before).every(c=>c.method==='GET'));assert.equal(await effects(value),1);assert.equal((await notices(value)).length,1);
  });
  await suite.test('the effect lease is checked after a real financial row-lock wait, not before it',async()=>{
   const value=await setup();value.state.postHook=()=>due(value);assert.equal((await value.worker.tick()).state,'lost');value.state.postHook=null;
   const claim=await value.queue.claim(),locker=await admin.connect();let outcome;
   try{
    await locker.query('begin');await locker.query('select id from app.payment_orders where id=$1 for update',[value.item.id]);
    outcome=new (load('postgres-placement-refund-effect').PostgresPlacementRefundEffectStore)(db,value.shop).apply(value.approval.id,async tx=>{await value.queue.assertActive(claim,tx);}).then(result=>({result}),error=>({error}));
    const deadline=Date.now()+1500;let waiting=false;
    while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='placement_queue_worker' and wait_event_type='Lock') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true);await due(value);await locker.query('commit');assert.equal((await outcome).error?.code,'PRQ01');assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);
   }finally{await locker.query('rollback');locker.release();if(outcome)await outcome;}
   assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.equal(await effects(value),1);
  });
  await suite.test('expiry while the effect trigger waits on its target rolls back the entire effect and notice',async()=>{
   const value=await setup();await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,value.shop,{postmoderation:true}).fulfill(value.item.id);
   value.state.postHook=()=>due(value);assert.equal((await value.worker.tick()).state,'lost');value.state.postHook=null;
   const claim=await value.queue.claim(),locker=await admin.connect();let outcome;
   try{
    await locker.query('begin');await locker.query('select id from app.listings where id=$1 for update',[value.item.targetId]);
    await admin.query("update app.placement_refund_jobs set available_at=clock_timestamp()+interval '500 milliseconds' where approval_id=$1",[value.approval.id]);
    outcome=new (load('postgres-placement-refund-effect').PostgresPlacementRefundEffectStore)(db,value.shop).apply(value.approval.id,async tx=>{await value.queue.assertActive(claim,tx);}).then(result=>({result}),error=>({error}));
    const deadline=Date.now()+1500;let waiting=false;
    while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='placement_queue_worker' and wait_event_type='Lock' and query like 'insert into app.payment_refund_effects%') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true);await new Promise(resolve=>setTimeout(resolve,550));await locker.query('commit');assert.equal((await outcome).error?.code,'PRQ01');
    assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);assert.equal((await admin.query('select status from app.listings where id=$1',[value.item.targetId])).rows[0].status,'published');
   }finally{await locker.query('rollback');locker.release();if(outcome)await outcome;}
   assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.equal(await effects(value),1);
  });
  await suite.test('a notice storage failure rolls back money and placement together; retry retains provider identity',async()=>{
   const value=await setup();await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,value.shop,{postmoderation:true}).fulfill(value.item.id);
   await admin.query(`alter table app.notifications add constraint queue_fixture_notice_fail check(event_key<>${pg.escapeLiteral('placement_refund:'+value.item.id)}) not valid`);
   try{
    assert.equal((await value.worker.tick()).state,'deferred');assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'succeeded');
    assert.equal((await admin.query('select status from app.listings where id=$1',[value.item.targetId])).rows[0].status,'published');
   }finally{await admin.query('alter table app.notifications drop constraint queue_fixture_notice_fail');}
   const before=value.calls.length;await due(value);assert.deepEqual(await value.worker.tick(),{state:'completed'});assert.ok(value.calls.slice(before).every(c=>c.method==='GET'));assert.equal((await notices(value)).length,1);
  });
  await suite.test('operator recovery completes a capped UNKNOWN job and fences any previous claim',async()=>{
   const value=await setup();value.state.losePost=true;assert.equal((await value.worker.tick()).state,'deferred');value.state.losePost=false;
   await due(value);const previous=await value.queue.claim();
   await admin.query("update app.placement_refund_jobs set state='blocked',attempts=12,claim_id=null,last_code='attempts_exhausted' where approval_id=$1",[value.approval.id]);
   await admin.query('alter table app.payment_refund_dispatch_anchors disable trigger user');try{await admin.query("update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '25 hours' where operation_id=$1",[value.approval.id]);}finally{await admin.query('alter table app.payment_refund_dispatch_anchors enable trigger user');}
   const before=value.calls.length;
   assert.equal((await load('primary-refund-recovery').createPrimaryRefundRecovery(ownerDb,value.shop,value.fetcher).recover(operator.token,operator.id,{id:randomUUID(),operationId:value.approval.id,providerRefundId:value.state.refundId,reason:'Сверка истёкшей неизвестной операции'})).state,'applied');
   assert.deepEqual(await job(value),{state:'completed',attempts:12,claim_id:null,last_code:null});assert.equal(await value.queue.finish(previous,'retry','processing_unavailable'),false);
   assert.ok(value.calls.slice(before).every(c=>c.method==='GET'));assert.equal(await effects(value),1);assert.equal((await notices(value)).length,1);
  });
  await suite.test('legacy authoritative refund survives a deleted historical payer without inventing a notification recipient',async()=>{
   const payerId=randomUUID();await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[payerId,payerId+'@queue.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   const value=await setup({payerId,approved:false});
   await new (load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,value.shop).reserve(value.item.id,value.approval.id);
   await new (load('postgres-refund-requests').PostgresRefundRequestStore)(db,value.shop).prepare(value.approval.id);
   await new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(db,value.shop).authorize(value.approval.id,randomUUID());
   await new (load('postgres-refund-journal').PostgresRefundJournalStore)(db,value.shop,value.fetcher).reconcile(value.approval.id,value.state.refundId);
   await admin.query('delete from app.users where id=$1',[payerId]);
   const result=await new (load('postgres-placement-refund-effect').PostgresPlacementRefundEffectStore)(db,value.shop).apply(value.approval.id);
   assert.equal(result.effect,'unfulfilled');assert.equal(await effects(value),1);assert.deepEqual(await notices(value),[]);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'refunded');
  });
  await suite.test('application recovery cannot finish a placement job whose approval UUID coincides with its payment UUID',async()=>{
   const id=randomUUID(),value=await setup({approvalId:id}),work=(await purchase({kind:'workRequest',scope:value.shop})).targetId;
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-interval '7 days',clock_timestamp()-interval '6 days') returning id",[operator.id,work,randomUUID()])).rows[0].id;
   const paymentId=randomUUID(),refundId=randomUUID(),capturedAt=new Date(Date.now()-6*86400000-1000).toISOString(),metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
   const body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata});
   await ownerDb.transaction(async tx=>{
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{id,ownerId:operator.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:value.shop.shopId,isTest:true,requestBody:body});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,operator.id,randomUUID(),application]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,paymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,paymentId,capturedAt]);
   });
   assert.equal((await new (load('postgres-application-compensation').PostgresApplicationCompensationStore)(ownerDb,value.shop).claim(id)).state,'claimed');
   await new (load('postgres-application-compensation-refund').PostgresApplicationCompensationRefundStore)(ownerDb,value.shop).reserve(id);
   await new (load('postgres-refund-requests').PostgresRefundRequestStore)(ownerDb,value.shop).prepare(id);
   await new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(ownerDb,value.shop).authorize(id,randomUUID());
   const fetcher=async(url,init)=>{
    assert.equal(init.method,'GET');
    if(String(url).endsWith('/payments/'+paymentId))return Response.json({id:paymentId,amount:{value:'99.00',currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:capturedAt,recipient:{account_id:value.shop.shopId},metadata});
    assert.equal(String(url),'https://api.yookassa.ru/v3/refunds/'+refundId);return Response.json({id:refundId,payment_id:paymentId,amount:{value:'99.00',currency:'RUB'},status:'succeeded',created_at:new Date().toISOString(),metadata:{localRefundId:id,localPaymentId:id}});
   };
   assert.equal((await load('primary-refund-recovery').createPrimaryRefundRecovery(ownerDb,value.shop,fetcher).recover(operator.token,operator.id,{id:randomUUID(),operationId:id,providerRefundId:refundId,reason:'Проверка разных источников операций'})).state,'applied');
   assert.equal((await job(value)).state,'queued');assert.equal(await effects(value),0);assert.deepEqual(await notices(value),[]);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[value.item.id])).rows[0].status,'succeeded');
  });
 }finally{await db.close();}
}
