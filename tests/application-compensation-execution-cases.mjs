import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

export async function testApplicationCompensationExecution(suite,{admin,ownerDb,store,merchant,purchase,view,load}) {
 for(const file of ['0044-work-owner-actions.sql','0045-customer-closure-compensation.sql','0046-response-checkout-fence.sql','0047-checkout-cancellation.sql','0048-application-compensation-refunds.sql'])await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
 await admin.query('grant execute on function app.lock_application_compensation_source(uuid,text) to compensation_worker');
 await suite.test('a committed compensation case admits only its canonical full refund reservation',async()=>{
  const item=await purchase();await store.claim(item.id);
  await admin.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount)
   values($1,$1,$2,$3,true,99)`,[item.id,item.providerPaymentId,merchant.shopId]);
  assert.equal((await admin.query('select id from app.payment_refund_reservations where payment_intent_id=$1',[item.id])).rows[0].id,item.id);
 });
 const {PostgresDatabase}=load('postgres'),{createApplicationCompensationRefundProcessor}=load('primary-application-compensation-refund');
 const {PostgresApplicationCompensationRefundStore}=load('postgres-application-compensation-refund');
 const config={...merchant,secretKey:'test_synthetic_compensation'},workerPassword=randomUUID();
 // Only this disposable fixture gets these capabilities; no existing runtime role changes.
 await admin.query(`create role compensation_refund_worker login password ${pg.escapeLiteral(workerPassword)} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  grant connect on database blizhniy_test to compensation_refund_worker;
  grant usage on schema app to compensation_refund_worker;
  grant select(id),update(id) on app.users to compensation_refund_worker;
  grant select on app.payment_checkout_intents,app.payment_orders,app.payment_provider_links,app.payment_verifications,
   app.payment_refund_reservations,app.payment_refund_requests,app.payment_refund_dispatch_anchors,app.payment_refund_send_attempts,
   app.payment_refund_candidates,app.payment_refund_provider_links,app.payment_refund_observations,app.payment_refund_effects,
   app.application_compensation_cases,app.application_compensation_refunds to compensation_refund_worker;
  grant update(id) on app.payment_checkout_intents,app.payment_orders to compensation_refund_worker;
  grant insert(payment_intent_id,merchant_shop_id) on app.application_compensation_cases,app.application_compensation_refunds to compensation_refund_worker;
  grant insert(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) on app.payment_refund_reservations to compensation_refund_worker;
  grant insert(operation_id,idempotence_key,request_body) on app.payment_refund_requests to compensation_refund_worker;
  grant insert(operation_id) on app.payment_refund_dispatch_anchors to compensation_refund_worker;
  grant insert(id,operation_id) on app.payment_refund_send_attempts to compensation_refund_worker;
  grant insert(operation_id,attempt_id,provider_refund_id) on app.payment_refund_candidates to compensation_refund_worker;
  grant insert(operation_id,provider_refund_id) on app.payment_refund_provider_links to compensation_refund_worker;
  grant insert(operation_id,provider_refund_id,status,provider_created_at) on app.payment_refund_observations to compensation_refund_worker;
  grant insert(operation_id,merchant_shop_id) on app.payment_refund_effects to compensation_refund_worker;
  grant execute on function app.lock_application_compensation_source(uuid,text),app.refund_target_admitted(uuid,uuid) to compensation_refund_worker`);
 const worker=new PostgresDatabase(new pg.Pool({...admin.options,user:'compensation_refund_worker',password:workerPassword,max:5}));
 async function provider(item){
  const original=JSON.parse(item.requestBody),amount=original.amount.value,capturedAt=(await admin.query('select captured_at from app.payment_verifications where intent_id=$1',[item.id])).rows[0].captured_at;
  const calls=[],state={status:'succeeded',losePost:false,postHook:null,refundId:randomUUID(),createdAt:new Date().toISOString()};
  const refund=()=>({id:state.refundId,payment_id:item.providerPaymentId,amount:{value:amount,currency:'RUB'},status:state.status,created_at:state.createdAt,metadata:{localRefundId:item.id,localPaymentId:item.id}});
  const fetcher=async(value,init)=>{
   const url=String(value);calls.push({url,method:init.method,body:init.body,key:init.headers['Idempotence-Key']});assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
   if(init.method==='POST'){
    assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+item.id);
    assert.deepEqual(JSON.parse(init.body),{payment_id:item.providerPaymentId,amount:{value:amount,currency:'RUB'},metadata:{localRefundId:item.id,localPaymentId:item.id}});
    if(state.postHook)await state.postHook();if(state.losePost)throw new TypeError('Synthetic uncertain refund response');return Response.json(refund());
   }
   assert.equal(init.method,'GET');
   if(url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json({id:item.providerPaymentId,amount:original.amount,status:'succeeded',paid:true,test:true,refundable:true,captured_at:capturedAt,recipient:{account_id:merchant.shopId},metadata:original.metadata});
   if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
   assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+state.refundId);return Response.json(refund());
  };
  return{state,calls,fetcher,processor:createApplicationCompensationRefundProcessor(worker,config,fetcher)};
 }
 const order=async item=>(await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status;
 const effects=async item=>(await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[item.id])).rows[0].n;
 const notifications=async item=>(await admin.query('select count(*)::int as n from app.notifications where user_id=$1 and event_key=$2',[item.applicant,'application_compensation:'+item.id])).rows[0].n;
 async function expireWindow(id){await admin.query('alter table app.payment_refund_dispatch_anchors disable trigger user');try{await admin.query("update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '25 hours' where operation_id=$1",[id]);}finally{await admin.query('alter table app.payment_refund_dispatch_anchors enable trigger user');}}
 try{
  await suite.test('a scoped worker compensates both original fiscal modes once and preserves delivered response data',async()=>{
   for(const receipt of [false,true]){
    const item=await purchase({receipt}),remote=await provider(item),before=(await admin.query('select snapshot,status,is_paid,sent_at from app.applications where id=$1',[item.application])).rows[0];
    const result=await remote.processor.process(item.id);assert.equal(result.state,'applied');assert.equal(result.effect.amount,'99.00');assert.equal(await order(item),'refunded');
    assert.deepEqual((await admin.query('select snapshot,status,is_paid,sent_at from app.applications where id=$1',[item.application])).rows[0],before);
    assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
    await admin.query("delete from app.notifications where user_id=$1 and event_key=$2",[item.applicant,'application_compensation:'+item.id]);
    await expireWindow(item.id);const previous=remote.calls.length;assert.equal((await remote.processor.process(item.id)).state,'applied');
    assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);assert.equal(await effects(item),1);assert.equal(await notifications(item),0,'replay does not recreate a deleted notification');
   }
  });
  await suite.test('pending then succeeded uses GET-only recovery and canceled never applies an effect',async()=>{
   for(const status of ['pending','canceled']){
    const item=await purchase(),remote=await provider(item);remote.state.status=status;
    assert.equal((await remote.processor.process(item.id)).state,status);assert.equal(await order(item),'succeeded');assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
    const previous=remote.calls.length;if(status==='pending')remote.state.status='succeeded';
    assert.equal((await remote.processor.process(item.id)).state,status==='pending'?'applied':'canceled');assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));
    assert.equal(await order(item),status==='pending'?'refunded':'succeeded');
   }
  });
  await suite.test('recent or already-viewed responses do not prepare requests or reach the provider',async()=>{
   for(const viewed of [false,true]){
    const item=await purchase({ageDays:1});if(viewed)await view(item);const remote=await provider(item),result=await remote.processor.process(item.id);
    assert.equal(result.state,viewed?'ineligible':'waiting');assert.equal(remote.calls.length,0);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_reservations where payment_intent_id=$1',[item.id])).rows[0].n,0);
   }
  });
  await suite.test('late disclosure after a committed case cannot cancel the compensation right',async()=>{
   const item=await purchase();await store.claim(item.id);await view(item);const remote=await provider(item);
   assert.equal((await remote.processor.process(item.id)).state,'applied');assert.equal(await notifications(item),1);
   assert.equal((await admin.query('select count(*)::int as n from app.application_contact_views where application_id=$1',[item.application])).rows[0].n,1);
  });
  await suite.test('concurrent processes share one operation, provider identity and financial effect',async()=>{
   const item=await purchase(),remote=await provider(item);await store.claim(item.id);
   const results=await Promise.allSettled([remote.processor.process(item.id),remote.processor.process(item.id)]);
   assert.ok(results.some(result=>result.status==='fulfilled'&&result.value.state==='applied'));assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
   assert.equal(new Set(remote.calls.filter(call=>call.method==='POST').map(call=>call.key)).size,1);
  });
  await suite.test('unknown POST retries keep exact bytes and the original key, never a second operation',async()=>{
   const item=await purchase(),remote=await provider(item);remote.state.losePost=true;
   await assert.rejects(remote.processor.process(item.id));assert.equal(await effects(item),0);assert.equal(await order(item),'succeeded');
   remote.state.losePost=false;assert.equal((await remote.processor.process(item.id)).state,'applied');
   assert.equal(new Set(remote.calls.filter(call=>call.method==='POST').map(call=>call.body)).size,1);
   assert.equal(new Set(remote.calls.filter(call=>call.method==='POST').map(call=>call.key)).size,1);assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
  });
  await suite.test('expired UNKNOWN requires operator reconciliation and cannot open a fresh window',async()=>{
   const item=await purchase(),remote=await provider(item);remote.state.losePost=true;await assert.rejects(remote.processor.process(item.id));assert.ok(remote.calls.some(call=>call.method==='POST'));assert.ok((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[item.id])).rows[0].n>0);await expireWindow(item.id);
   remote.state.losePost=false;const previous=remote.calls.length;await assert.rejects(remote.processor.process(item.id));assert.equal(remote.calls.length,previous);assert.equal(await effects(item),0);
  });
  await suite.test('direct SQL refuses an application without a case, wrong operation key and partial amounts',async()=>{
   const item=await purchase();const reserve=(id,amount)=>admin.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) values($1,$2,$3,$4,true,$5)`,[id,item.id,item.providerPaymentId,merchant.shopId,amount]);
   await assert.rejects(reserve(item.id,'99.00'),{code:'23514'});await store.claim(item.id);
   await assert.rejects(reserve(randomUUID(),'99.00'),{code:'23514'});await assert.rejects(reserve(item.id,'98.00'),{code:'23514'});
   await assert.rejects(new (load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(worker,merchant).reserve(item.id,item.id));
   await assert.rejects(new PostgresApplicationCompensationRefundStore(worker,merchant).apply(item.id));assert.equal(await order(item),'succeeded');assert.equal(await notifications(item),0);
  });
  await suite.test('worker cannot forge effect outcomes, alter evidence/history, reveal contacts or directly change money',async()=>{
   for(const sql of ["update app.payment_orders set status='refunded' where false","select email from app.users","select snapshot from app.applications","insert into app.application_contact_views default values","delete from app.application_compensation_refunds where false","update app.application_compensation_cases set amount=1 where false","insert into app.application_compensation_refunds(payment_intent_id,merchant_shop_id,amount) values(gen_random_uuid(),'compensation-fixture',1)"]){await assert.rejects(worker.query(sql),{code:'42501'});}
   assert.equal((await worker.query('select app.refund_target_admitted(gen_random_uuid(),gen_random_uuid()) as admitted')).rows[0].admitted,false);
  });
  await suite.test('the application branch keeps the original twelve-attempt cap without provider HTTP',async()=>{
   const item=await purchase();await store.claim(item.id);await new PostgresApplicationCompensationRefundStore(worker,merchant).reserve(item.id);
   await new (load('postgres-refund-requests').PostgresRefundRequestStore)(worker,merchant).prepare(item.id);
   const dispatch=new (load('postgres-refund-dispatch').PostgresRefundDispatchStore)(worker,merchant);
   for(let attempt=0;attempt<12;attempt++)assert.equal((await dispatch.authorize(item.id,randomUUID())).decision,'post');
   await assert.rejects(dispatch.authorize(item.id,randomUUID()));
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_send_attempts where operation_id=$1',[item.id])).rows[0].n,12);
   assert.equal(await effects(item),0);assert.equal(await notifications(item),0);
  });
  await suite.test('lost effect COMMIT acknowledgement recovers one effect and notification by GET only',async()=>{
   const item=await purchase(),remote=await provider(item);let lose=true;
   const uncertain={transaction:async work=>{
    let applied=false;const value=await worker.transaction(tx=>work({query:(sql,values)=>{if(sql.startsWith('insert into app.application_compensation_refunds'))applied=true;return tx.query(sql,values);}}));
    if(applied&&lose){lose=false;throw Error('Synthetic lost effect COMMIT acknowledgement');}return value;
   }};
   const processor=createApplicationCompensationRefundProcessor(uncertain,config,remote.fetcher);
   await assert.rejects(processor.process(item.id),/lost effect COMMIT/);assert.equal(await order(item),'refunded');assert.equal(await effects(item),1);assert.equal(await notifications(item),1);
   const previous=remote.calls.length;assert.equal((await processor.process(item.id)).state,'applied');assert.ok(remote.calls.slice(previous).every(call=>call.method==='GET'));assert.equal(await notifications(item),1);
  });
  await suite.test('wrong merchant and invalid identifiers fail before provider calls',async()=>{
   const item=await purchase(),remote=await provider(item),wrong=createApplicationCompensationRefundProcessor(worker,{...config,shopId:'different-fixture'},remote.fetcher);
   await assert.rejects(wrong.process(item.id));for(const invalid of [null,{},'',item.id+'\n'])await assert.rejects(remote.processor.process(invalid));assert.equal(remote.calls.length,0);
  });
  await suite.test('legacy placement execution requires no new helper or case privilege',async()=>{
   const item=await purchase(),id=randomUUID(),targetId=randomUUID(),providerPaymentId=randomUUID(),metadata={localPaymentId:id,targetId,targetType:'listing',tariffId:'listing-publication'};
   const requestBody=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata});
   await ownerDb.transaction(async tx=>{
    await new (load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{id,ownerId:item.applicant,targetType:'listing',targetId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,...merchant,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,1)",[id,item.applicant,randomUUID(),targetId]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,new Date(Date.now()-3600000).toISOString()]);
   });
   await admin.query('revoke execute on function app.refund_target_admitted(uuid,uuid) from compensation_refund_worker;revoke select on app.application_compensation_cases,app.application_compensation_refunds from compensation_refund_worker');
   try{
    const reserved=await new (load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(worker,merchant).reserve(id,id);assert.equal(reserved.id,id);
    await new (load('postgres-refund-requests').PostgresRefundRequestStore)(worker,merchant).prepare(id);
    const remote=await provider({...item,id,providerPaymentId,requestBody}),processor=load('primary-placement-refund-processor').createPrimaryPlacementRefundProcessor(worker,config,remote.fetcher);
    const result=await processor.process(id,async()=>{});assert.equal(result.state,'applied');assert.equal(result.effect.effect,'unfulfilled');
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[id])).rows[0].status,'refunded');assert.equal(remote.calls.filter(call=>call.method==='POST').length,1);
   }finally{await admin.query('grant execute on function app.refund_target_admitted(uuid,uuid) to compensation_refund_worker;grant select on app.application_compensation_cases,app.application_compensation_refunds to compensation_refund_worker');}
  });
 }finally{await worker.close();}
}
