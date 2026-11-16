import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';
import {localPrimaryMerchant} from '../scripts/local-primary-payment.mjs';
import {testLocalPrimaryRefundProvider} from './local-primary-refund-provider-cases.mjs';
import {testLocalPrimaryRefundActivation} from './local-primary-refund-activation-cases.mjs';

/** Reuses only the parent's new owned synthetic prod-named database; never the persistent manual stand. */
export async function testOwnedRefundComposition(suite,{admin,owned,environment,stateFile,project,load,artifact,actor,token}){
 environment={...environment,BLIZHNIY_PAYMENT_SHOP_ID:localPrimaryMerchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:localPrimaryMerchant.secretKey};
 const plan=getRefundWorkerRolePlan('blizhniy_prod',{schema:55}),password=randomBytes(32).toString('hex'),destination=join(owned,'worker');
 buildRefundWorker(destination,{schema:55});await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
 await admin.query(plan.createRole);await admin.query("alter role blizhniy_refund_worker login password '"+password+"'");for(const sql of plan.grants)await admin.query(sql);
 const workerModule=await import(pathToFileURL(join(destination,'scripts/local-refund-worker-runtime.mjs')).href),operatorModule=await import(pathToFileURL(join(artifact,'scripts/local-refund-operator-runtime.mjs')).href);
 const {startLocalRefundOperatorServer}=await import(pathToFileURL(join(artifact,'scripts/local-refund-operator-server.mjs')).href),{runRefundWorkerService}=await import(pathToFileURL(join(destination,'scripts/refund-worker-service.mjs')).href);
 const workerEnvironment={...environment,BLIZHNIY_REFUND_OPERATOR:undefined,BLIZHNIY_REFUND_WORKER:'local-test',BLIZHNIY_DB_USER:'blizhniy_refund_worker',BLIZHNIY_DB_PASSWORD:password};
 const {PostgresDatabase}=load('postgres'),ownerDb=new PostgresDatabase(admin),{PostgresPaymentIntentStore}=load('postgres-payment-intents');
 const items=new Map(),refunds=new Map(),posts=[];let runtime,operator,server;const me=()=>Response.json({account_id:environment.BLIZHNIY_PAYMENT_SHOP_ID,test:true,status:'enabled',fiscalization:{enabled:false}});
 const fetcher=async(url,init)=>{
  assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  if(url==='https://api.yookassa.ru/v3/me'){assert.equal(init.method,'GET');return me();}
  if(init.method==='POST'){
   assert.equal(url,'https://api.yookassa.ru/v3/refunds');const body=JSON.parse(init.body),item=items.get(body.metadata.localPaymentId);assert.ok(item);const operation=body.metadata.localRefundId;
   assert.equal(init.headers['Idempotence-Key'],'refund-'+operation);assert.equal(body.payment_id,item.providerPaymentId);assert.deepEqual(body.amount,{value:item.amount,currency:'RUB'});assert.equal(posts.includes(operation),false);posts.push(operation);
   const refund={id:randomUUID(),payment_id:item.providerPaymentId,amount:body.amount,status:'succeeded',created_at:new Date().toISOString(),metadata:body.metadata};refunds.set(refund.id,refund);return Response.json(refund);
  }
  assert.equal(init.method,'GET');
  const payment=[...items.values()].find(item=>url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId);
  if(payment)return Response.json({id:payment.providerPaymentId,amount:{value:payment.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:payment.capturedAt,recipient:{account_id:environment.BLIZHNIY_PAYMENT_SHOP_ID},metadata:payment.metadata});
  if([...items.values()].some(item=>url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100'))return Response.json({type:'list',items:[]});
  const refund=[...refunds.values()].find(item=>url==='https://api.yookassa.ru/v3/refunds/'+item.id);assert.ok(refund);return Response.json(refund);
 };
 const merchant={shopId:environment.BLIZHNIY_PAYMENT_SHOP_ID,isTest:true,secretKey:environment.BLIZHNIY_PAYMENT_SECRET_KEY};
 async function intent(kind,targetId,ownerId,{age=false}={}){
  const id=randomUUID(),binding={id,ownerId,targetType:kind,targetId,targetRevision:'1',tariffId:kind==='application'?'job-response':'listing-publication',amount:kind==='application'?'99.00':'199.00',durationDays:kind==='application'?null:30,shopId:merchant.shopId,isTest:true};
  const providerPaymentId=randomUUID(),metadata={localPaymentId:id,targetId,targetType:kind,tariffId:binding.tariffId},capturedAt=new Date(Date.now()-(age?6*86400000:60000)).toISOString();
  const requestBody=JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://owned.example.invalid/return'},metadata});
  await ownerDb.transaction(async tx=>{
   await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{...binding,requestBody});
   await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[id,ownerId,randomUUID(),kind,targetId]);
   await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
   await tx.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);
  });
  const item={...binding,providerPaymentId,metadata,capturedAt};items.set(id,item);return item;
 }
 try{
  await suite.test('owned worker preserves its default prod-name refusal and rejects unowned target or actual Pool CA before a claim',async()=>{
   let pools=0,http=0;const options={stateFile,project,fetcher:async()=>{http++;throw Error('Unexpected provider');},loadModules:()=>({readPostgresConfig:()=>({database:'blizhniy_prod',ssl:{ca:'foreign certificate',rejectUnauthorized:true}}),Pool:class{constructor(){pools++;}}})};
   await assert.rejects(workerModule.createLocalRefundWorkerRuntime(workerEnvironment,options),{message:'Local refund runtime unavailable'});
   await assert.rejects(workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{...options,project:'/foreign'}),{message:'Local refund runtime unavailable'});
   await assert.rejects(workerModule.createLocalPrimaryRefundWorkerRuntime({...workerEnvironment,BLIZHNIY_DB_PORT:String(Number(workerEnvironment.BLIZHNIY_DB_PORT)+1)},options),{message:'Local refund runtime unavailable'});
   await assert.rejects(workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,options),{message:'Local refund runtime unavailable'});assert.equal(pools,0);assert.equal(http,0);
  });
  await suite.test('owned TLS operator and worker service refund three placements and one unread response exactly once across restart',async()=>{
   const payer=randomUUID(),phone='+79990000001';await admin.query("insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())",[payer,payer+'@owned.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer,{name:'Владелец размещения',phone}]);await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer,phone,'owned-refund-'+randomUUID()]);
   await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых')");
   const listing=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) select $1,'sell',c.id,city.id,'Синтетическая публикация','Синтетическое описание для проверки полного локального возврата.',$2,clock_timestamp()-interval '2 minutes' from app.categories c cross join app.cities city returning id",[payer,phone])).rows[0].id;
   const listingPayment=await intent('listing',listing,payer),placement=[listingPayment];
   for(const kind of ['vacancy','workRequest']){const target=(await admin.query('insert into app.work_publications(author_id,kind,creation_key,form) values($1,$2,$3,$4) returning id',[payer,kind,randomUUID(),{kind,title:'Синтетическая публикация'}])).rows[0].id;placement.push(await intent(kind,target,payer));}
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',statement_timestamp()-interval '7 days',statement_timestamp()-interval '6 days') returning id",[actor,placement[2].targetId,randomUUID()])).rows[0].id;
   const response=await intent('application',application,actor,{age:true}),before=(await admin.query('select status,is_paid,snapshot,sent_at from app.applications where id=$1',[application])).rows[0];
   const fulfilled=await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,merchant,{postmoderation:true}).fulfill(listingPayment.id);assert.equal(fulfilled.state,'fulfilled');
   operator=await operatorModule.createLocalPrimaryRefundOperatorRuntime(environment,{stateFile,project,fetcher:async(url,init)=>{assert.equal(init.method,'GET');return fetcher(url,init);}});server=await startLocalRefundOperatorServer(operator);
   const {callLocalRefundOperator}=load('local-refund-operator-client');
   for(const item of placement)await callLocalRefundOperator(server.socketPath,token,{action:'approve',expectedAdminId:actor,input:{id:randomUUID(),paymentIntentId:item.id,reason:'Полный возврат по обращению владельца.'}});assert.equal(posts.length,0);
   runtime=await workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher});await assert.rejects(runtime.placement.tick());assert.equal(posts.length,0);
   const controller=new AbortController(),events=[];let completed=0,compensated=0;
   const result=await runRefundWorkerService({mode:'run',signal:controller.signal,createRuntime:async()=>runtime,wait:async()=>{},report:async event=>{
    events.push(event);if(event.status==='tick'&&event.state==='completed'){if(event.kind==='placement')completed++;else compensated++;}
    if(completed===3&&compensated===1)controller.abort();if(events.length>30)throw Error('Owned fixture did not converge');
   }});assert.equal(result,0);assert.equal(completed,3);assert.equal(compensated,1);assert.equal(posts.length,4);assert.equal(new Set(posts).size,4);
   const page=await callLocalRefundOperator(server.socketPath,token,{action:'list',expectedAdminId:actor,input:null});assert.equal(page.items.length,4);assert.ok(page.items.every(item=>item.status==='refunded'&&item.refundStatus==='succeeded'&&item.appliedAt));
   assert.deepEqual((await admin.query('select status,is_paid from app.listings where id=$1',[listing])).rows[0],{status:'archived',is_paid:false});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects')).rows[0].n,3);assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_refunds where payment_intent_id=$1',[response.id])).rows[0].n,1);
   assert.deepEqual((await admin.query('select status,is_paid,snapshot,sent_at from app.applications where id=$1',[application])).rows[0],before);assert.equal((await admin.query('select count(*)::int as n from app.notifications')).rows[0].n,4);
   runtime=await workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher});await runtime.preflight();assert.deepEqual(await runtime.placement.tick(),{state:'idle'});assert.equal((await runtime.application.sweep()).processing.state,'idle');assert.equal(posts.length,4);
   const sessions=(await admin.query("select usename,s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where application_name in ('blizhniy-local-refund-worker','blizhniy-local-refund-operator')")).rows;assert.ok(sessions.some(s=>s.usename==='blizhniy_refund_worker'));assert.ok(sessions.some(s=>s.usename==='blizhniy_refund_operator'));assert.ok(sessions.every(s=>s.ssl));
  });
  await suite.test('packaged joint service starts after both real TLS admissions and closes its private IPC across restart',async()=>{
   await runtime?.close();runtime=undefined;await server.close();server=undefined;operator=undefined;
   const {startLocalRefundServices}=await import(pathToFileURL(join(destination,'scripts/local-refund-services.mjs')).href);
   const {callLocalRefundOperator}=load('local-refund-operator-client');
   for(let restart=0;restart<2;restart++){
    const controller=new AbortController(),events=[];
    const services=await startLocalRefundServices({signal:controller.signal,
     createOperator:()=>operatorModule.createLocalPrimaryRefundOperatorRuntime(environment,{stateFile,project,fetcher}),
     createWorker:()=>workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher}),
     startOperatorServer:startLocalRefundOperatorServer,report:async event=>events.push(event)});
    try{
     assert.equal(events[0].status,'ready');
     const page=await callLocalRefundOperator(services.socketPath,token,{action:'list',expectedAdminId:actor,input:null});
     assert.equal(page.items.length,4);assert.ok(page.items.every(item=>item.status==='refunded'));assert.equal(posts.length,4);
    }finally{await services.close();}
    assert.equal(await services.done,0);await assert.rejects(callLocalRefundOperator(services.socketPath,token,{action:'list',expectedAdminId:actor,input:null}));
    assert.equal((await admin.query("select count(*)::int as n from pg_stat_activity where application_name in ('blizhniy-local-refund-worker','blizhniy-local-refund-operator')")).rows[0].n,0);
   }
   assert.equal(posts.length,4);assert.equal((await admin.query('select count(*)::int as n from app.notifications')).rows[0].n,4);
  });
  await suite.test('joint startup accepts an IPC approval before its first claim and applies one refund before draining',async()=>{
   const payer=randomUUID(),phone='+79990000002';
   await admin.query("insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())",[payer,payer+'@owned.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer,{name:'Владелец размещения',phone}]);
   await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer,phone,'owned-refund-'+randomUUID()]);
   const listing=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) select $1,'sell',c.id,city.id,'Проверка общего запуска','Синтетическое описание полного возврата после совместного запуска.',$2,clock_timestamp()-interval '2 minutes' from app.categories c cross join app.cities city returning id",[payer,phone])).rows[0].id;
   const item=await intent('listing',listing,payer);
   assert.equal((await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,merchant,{postmoderation:true}).fulfill(item.id)).state,'fulfilled');
   const {startLocalRefundServices}=await import(pathToFileURL(join(destination,'scripts/local-refund-services.mjs')).href);
   const {callLocalRefundOperator}=load('local-refund-operator-client'),controller=new AbortController();let socket,completed=0;
   const service=await startLocalRefundServices({signal:controller.signal,
    createOperator:()=>operatorModule.createLocalPrimaryRefundOperatorRuntime(environment,{stateFile,project,fetcher}),
    createWorker:()=>workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher}),
    startOperatorServer:async runtime=>{const handle=await startLocalRefundOperatorServer(runtime);socket=handle.socketPath;return handle;},
    report:async event=>{
     if(event.status==='ready')await callLocalRefundOperator(socket,token,{action:'approve',expectedAdminId:actor,input:{id:randomUUID(),paymentIntentId:item.id,reason:'Возврат при совместном запуске обработчиков.'}});
     if(event.status==='tick'&&event.kind==='placement'&&event.state==='completed'){completed++;controller.abort();}
    }});
   try{assert.equal(await service.done,0);}finally{await service.close();}
   assert.equal(completed,1);assert.equal(posts.length,5);
   assert.deepEqual((await admin.query('select status,is_paid from app.listings where id=$1',[listing])).rows[0],{status:'archived',is_paid:false});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where payment_intent_id=$1',[item.id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
   await assert.rejects(callLocalRefundOperator(socket,token,{action:'list',expectedAdminId:actor,input:null}));
  });
  await testLocalPrimaryRefundProvider(suite,{admin,ownerDb,load,intent,environment,workerEnvironment,operatorModule,workerModule,stateFile,project,actor,token});
  await testLocalPrimaryRefundActivation(suite,{admin,ownerDb,load,intent,environment,workerEnvironment,stateFile,actor,token});
 }finally{try{await runtime?.close();}finally{if(server)await server.close();else await operator?.close();}}
}
