import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {enableRefundFixtureTls} from './local-refund-runtime-cases.mjs';
import {provider} from './refund-worker-role-cases.mjs';

export async function testHostedRefundWorkflow(suite,{admin,config,load,operator,worker,docker,container,directory}){
 const ca=join(directory,'refund-ca.crt'),key=join(directory,'refund-key.pem');
 await enableRefundFixtureTls(admin,{docker,container},ca,key);
 for(const file of ['candidates/0077-admin-refund-actions.sql','permissions/admin-refund-actions.sql']){
  await admin.query(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
 }
 const deadline=Date.now()+5000;
 while((await admin.query("select current_setting('ssl') as ssl")).rows[0].ssl!=='on'){
  assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20));
 }
 const region=(await admin.query("insert into app.regions(slug,name) values('hosted-refund-region','Стендовый регион') returning id")).rows[0].id;
 const city=(await admin.query("insert into app.cities(region_id,slug,name) values($1,'hosted-refund-city','Стендовый город') returning id",[region])).rows[0].id;
 const profession=(await admin.query("insert into app.specialist_categories(slug,name,parent_name) values('hosted-refund-work','Стендовая профессия','Услуги') returning id")).rows[0].id;
 for(const [targetType,tariffId,outcome] of [
  ['listing','listing-publication','succeeded'],
  ['vacancy','vacancy-publication','succeeded'],
  ['workRequest','work-request-publication','succeeded'],
  ['workRequest','work-request-publication','canceled'],
 ]){
  await suite.test(targetType+' keeps the original operation through '+outcome,()=>
   verifyPlacementRefund({admin,config,load,operator,worker,ca,city,profession,targetType,tariffId,outcome}));
 }
}

export async function testHostedMarqueeRefund({admin,config,load,operator,worker,directory}){
 const ca=join(directory,'refund-ca.crt');
 const city=(await admin.query("select id from app.cities where slug='hosted-refund-city'")).rows[0].id;
 return verifyPlacementRefund({admin,config,load,operator,worker,ca,city,targetType:'ad_marquee',tariffId:'ad-marquee',outcome:'succeeded'});
}

async function capturePlacement(admin,{id,ownerId,targetId,targetType,tariffId,amount,durationDays,merchant,createdAt,capturedAt,origin,service=false}){
 const providerPaymentId=randomUUID(),metadata={localPaymentId:id,targetId,targetType,tariffId};
 const body={amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:origin+'/return'},metadata};
 await admin.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,
  amount,duration_days,merchant_shop_id,is_test,request_body,created_at)
  values($1,$2,$3,$4,1,$5,$6,$7,$8,true,$9,$10)`,[id,ownerId,targetType,targetId,tariffId,amount,durationDays,merchant.shopId,JSON.stringify(body),createdAt]);
 await admin.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision,created_at) values($1,$2,$3,$4,$5,1,$6)',
  [id,ownerId,randomUUID(),targetType,targetId,createdAt]);
 if(service)await admin.query('insert into app.service_payment_terms(intent_id) values($1)',[id]);
 await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);
 await admin.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
 await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);
 await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);
 return {id,targetId,providerPaymentId,amount,capturedAt,metadata};
}

async function seedAdvertisingQueue({admin,load,actor,payer,merchant,city,createdAt,capturedAt,origin}){
 await admin.query(`insert into app.tariffs(id,action,name,price,duration_days) values
  ('ad-marquee','ad_marquee','Рекламная строка',299,7),('fair-participation','fair_participation','Стендовая ярмарка',1000,null)`);
 const paid=[];
 const db=new(load('postgres').PostgresDatabase)(admin);
 const services=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(db,merchant);
 const publicService=new(load('postgres-public-service').PostgresPublicServiceStore)(db);
 async function service(position,kind){
  const owner=position===0?payer:await actor('user');
  const phone='+7999555120'+position,targetId=randomUUID();
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner.id,{name:'Стендовый рекламодатель',phone}]);
  await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner.id,phone,'hosted-ad-refund-'+position]);
  const fair=kind==='fair';
  const form=load('service-publication-contract').parseServicePublicationForm(kind,{
   title:'Синтетическая услуга '+position,placementRightConfirmed:true,
   ...(fair?{description:'Синтетическая заявка',category:'Посуда',cityName:'Стендовый город',contactPhone:phone,email:owner.id+'@refund.invalid'}:{href:origin}),
  });
  await admin.query('insert into app.service_publications(id,author_id,kind,creation_key,form,created_at,city_id) values($1,$2,$3,$4,$5,$6,$7)',
   [targetId,owner.id,kind,randomUUID(),form,createdAt,fair?city:null]);
  await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[targetId]);
  return capturePlacement(admin,{id:randomUUID(),ownerId:owner.id,targetId,targetType:fair?'fair_application':'ad_marquee',tariffId:fair?'fair-participation':'ad-marquee',
   amount:fair?'1000.00':'299.00',durationDays:fair?null:7,merchant,createdAt,capturedAt:new Date(Date.parse(capturedAt)+position).toISOString(),origin,service:true});
 }
 for(let position=0;position<7;position++)paid.push(await service(position,'marquee'));
 const active=async()=>(await publicService.list('marquee')).map(row=>row.id);
 for(const purchase of paid.slice(0,5))assert.equal((await services.fulfill(purchase.id)).state,'fulfilled');
 assert.deepEqual(await active(),paid.slice(0,5).map(row=>row.targetId));
 const waiting=paid.slice(5);
 assert.deepEqual(await services.discover(),waiting.map(row=>row.id));
 const fair=await service(7,'fair');
 return{purchase:paid[0],fair,active,services,waiting,original:paid.slice(0,5)};
}

async function verifyPlacementRefund({admin,config,load,operator,worker,ca,city,profession,targetType,tariffId,outcome}){
 const origin='https://refund-fixture.example.invalid';
 const merchant={shopId:'hosted-refund-fixture',isTest:true,secretKey:'test_synthetic_only'};
 const environment=(entry,kind)=>({
  NODE_ENV:'production',BLIZHNIY_PAYMENT_MODE:'test',
  [kind==='operator'?'BLIZHNIY_REFUND_OPERATOR':'BLIZHNIY_REFUND_WORKER']:targetType==='ad_marquee'?'hosted-marquee-schema-local-test':'hosted-schema-local-test',
  BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:entry.role,BLIZHNIY_DB_PASSWORD:entry.password,BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_DB_SSL_MODE:'verify-full',
  BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:merchant.secretKey,
 });
 const compiled=(entry,file)=>import(pathToFileURL(join(entry.destination,'scripts',file+'.mjs')).href);
 const {createLocalRefundOperatorRuntime}=await compiled(operator,'local-refund-operator-runtime');
 const {startLocalRefundOperatorServer}=await compiled(operator,'local-refund-operator-server');
 const {createLocalRefundWorkerRuntime}=await compiled(worker,'local-refund-worker-runtime');
 const {hashSessionToken}=load('identity');
 async function actor(role){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await admin.query('insert into app.users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,clock_timestamp(),$4)',
   [id,id+'@refund.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  return{id,token};
 }
 const payer=await actor('user'),reviewer=await actor('admin'),peer=await actor('admin');
 const createdAt=new Date(Date.now()-120000).toISOString(),capturedAt=new Date(Date.now()-60000).toISOString();
 const ads=targetType==='ad_marquee'?await seedAdvertisingQueue({admin,load,actor,payer,merchant,city,createdAt,capturedAt,origin}):null;
 const targetId=ads?.purchase.targetId??randomUUID();
 const targetTable=ads?'service_publications':targetType==='listing'?'listings':'work_publications';
 if(!ads&&targetType==='listing'){
  const category=(await admin.query("insert into app.categories(slug,name) values('hosted-refund-category','Стендовая категория') returning id")).rows[0].id;
  await admin.query(`insert into app.listings(id,author_id,listing_type,title,description,created_at,category_id,city_id)
   values($1,$2,'sell','Синтетическое объявление','Проверка возврата',$3,$4,$5)`,[targetId,payer.id,createdAt,category,city]);
 }else if(!ads){
  const form=load('work-publication-contract').parseWorkPublicationForm(targetType,{title:'Синтетическая публикация'});
  await admin.query(`insert into app.work_publications(id,author_id,kind,creation_key,form,city_id,profession_id,created_at)
   values($1,$2,$3,$4,$5,$6,$7,$8)`,[targetId,payer.id,targetType,randomUUID(),form,city,profession,createdAt]);
 }
 const purchase=ads?.purchase??await capturePlacement(admin,{id:randomUUID(),ownerId:payer.id,targetId,targetType,tariffId,amount:'199.00',
  durationDays:30,merchant,createdAt,capturedAt,origin});
 const {id,amount}=purchase;
 if(!ads){
  await admin.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2::timestamptz,$2::timestamptz+interval '30 days')",[id,capturedAt]);
  await admin.query(`update app.${targetTable} l set status='published',is_paid=true,published_at=f.published_at,expires_at=f.expires_at
   from app.payment_fulfillments f where l.id=$1 and f.intent_id=$2`,[targetId,id]);
 }
 const approvalId=randomUUID(),remote=provider(purchase,approvalId,merchant);
 const merchantStatus=()=>Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization:{enabled:false}});
 let refundId,operatorGet=0,refundStatus='pending',webDb,operatorRuntime,operatorSocket,workerRuntime;
 try{
  operatorRuntime=await createLocalRefundOperatorRuntime(environment(operator,'operator'),{fetcher:async(url,init)=>{
   assert.equal(init.method,'GET');
   if(url==='https://api.yookassa.ru/v3/me')return merchantStatus();
   operatorGet++;
   const observed=await remote.fetcher(url,init);
   if(url==='https://api.yookassa.ru/v3/refunds/'+refundId)return Response.json({...await observed.json(),status:refundStatus});
   return observed;
  }});
  workerRuntime=await createLocalRefundWorkerRuntime(environment(worker,'worker'),{fetcher:async(url,init)=>{
   if(url==='https://api.yookassa.ru/v3/me')return merchantStatus();
   const result=await remote.fetcher(url,init);
   if(init.method==='POST'){
    const observed=(await result.json()).id;
    if(refundId)assert.equal(observed,refundId);
    refundId=observed;throw Error('Synthetic lost refund response after provider receives request');
   }
   return result;
  }});
  await operatorRuntime.preflight();await workerRuntime.preflight();
  const tls=(await admin.query(`select usename,ssl from pg_stat_activity join pg_stat_ssl using(pid)
   where application_name in ('blizhniy-local-refund-operator','blizhniy-local-refund-worker')`)).rows;
  assert.ok(tls.some(row=>row.usename===operator.role));assert.ok(tls.some(row=>row.usename===worker.role));
  assert.ok(tls.every(row=>row.ssl));
  operatorSocket=await startLocalRefundOperatorServer(operatorRuntime);
  const forward=(token,command,signal,shop)=>load('local-refund-operator-client').callLocalRefundOperator(operatorSocket.socketPath,token,command,signal,shop);
  const bridge=(token,command,signal)=>forward(token,command,signal,merchant.shopId);
  const {createAdminRefundHandler}=load('admin-refund-http');
  const handler=command=>createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command}),()=>{});
  const normal=handler(bridge),lost=handler(async(...args)=>{await bridge(...args);throw Error('Synthetic lost approval response after commit');});
  const invoke=(run,action,input,actor=reviewer)=>run(new Request(origin+'/api/admin/refunds',{
   method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-real-ip':'192.0.2.15','x-blizhniy-request':'1',
    cookie:'__Host-blizhniy_session='+actor.token},body:JSON.stringify({action,expectedAdminId:actor.id,input}),
  }));
  const approval={id:approvalId,paymentIntentId:id,reason:'Проверка возврата за размещение.'};
  const row=async()=>(await admin.query(`select p.status,l.is_paid,l.status as publication from app.payment_orders p
   cross join app.${targetTable} l where p.id=$1 and l.id=$2`,[id,targetId])).rows[0];
  const period=async()=>(await admin.query(`select published_at,expires_at from app.${targetTable} where id=$1`,[targetId])).rows[0];
  const originalPeriod=await period();
  const published={status:'succeeded',is_paid:true,publication:'published'};
  const password=randomBytes(32).toString('hex');
  await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
  webDb=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'blizhniy_runtime',password,max:2}));
  const journal=async(status,kind=targetType,paymentId=id)=>(await load('postgres-admin-payment-journal').readAdminPaymentJournal(webDb,merchant.shopId,reviewer.token,
   {expectedAdminId:reviewer.id,kind,status,after:null},true)).items.find(item=>item.id===paymentId);
  assert.deepEqual((await journal('succeeded'))?.refundAction,{kind:'approve'});
  if(ads){
   assert.equal((await journal('succeeded','fair_application',ads.fair.id))?.refundAction,null);
   assert.equal((await invoke(normal,'approve',{...approval,id:randomUUID(),paymentIntentId:ads.fair.id})).status,503);
   assert.equal((await admin.query('select app.refund_target_admitted($1,$1) allowed',[ads.fair.id])).rows[0].allowed,false);
   assert.equal((await admin.query('select count(*)::int n from app.payment_refund_approvals where payment_intent_id=$1',[ads.fair.id])).rows[0].n,0);
  }
  await assert.rejects(webDb.query('select app_payment_admin.refund_action($1,$2)',['{}',merchant.shopId]),{code:'42501'});
  await assert.rejects(webDb.query('select app_payment_admin.list_orders_with_refund_actions($1,$2,$3,null,null,null,null)',
   [hashSessionToken(payer.token),payer.id,merchant.shopId]),{code:'42501'});
  assert.equal((await invoke(handler(forward),'approve',approval)).status,503);
  assert.equal((await invoke(handler((...args)=>forward(...args,'another-shop')),'approve',approval)).status,503);
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_approvals where payment_intent_id=$1',[id])).rows[0].n,0);
  assert.equal((await invoke(normal,'approve',approval,payer)).status,503);
  assert.equal((await invoke(lost,'approve',approval)).status,503);
  const read=await invoke(normal,'read',approvalId);
  assert.equal(read.status,200);assert.equal((await read.json()).amount,amount);
  assert.equal((await invoke(normal,'approve',{...approval,id:randomUUID()},peer)).status,503);
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_approvals where payment_intent_id=$1',[id])).rows[0].n,1);
  assert.equal(remote.posts(),0);
  const first=await workerRuntime.placement.tick();
  assert.deepEqual(first,{state:'deferred',code:'processing_unavailable'});
  assert.equal(remote.posts(),3);assert.ok(refundId);
  assert.deepEqual(await row(),published);
  assert.equal((await journal('succeeded'))?.refund,'unknown');
  assert.deepEqual((await journal('succeeded'))?.refundAction,{kind:'recover',operationId:approvalId,providerRefundId:null});
  const observing={id:randomUUID(),operationId:approvalId,providerRefundId:refundId,reason:'Сверка исходного возврата.'};
  const waiting=await invoke(normal,'recover',observing);
  assert.equal(waiting.status,200);assert.equal((await waiting.json()).state,'pending');
  assert.deepEqual(await row(),published);
  assert.equal((await journal('succeeded'))?.refund,'pending');
  assert.deepEqual((await journal('succeeded'))?.refundAction,{kind:'recover',operationId:approvalId,providerRefundId:refundId});
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where payment_intent_id=$1',[id])).rows[0].n,0);
  if(ads){
   assert.deepEqual(await ads.active(),ads.original.map(row=>row.targetId));
   for(const waiting of ads.waiting)assert.equal((await ads.services.fulfill(waiting.id)).state,'queued');
  }
  refundStatus=outcome;
  const recovery={...observing,id:randomUUID()};
  const confirmed=await invoke(normal,'recover',recovery);
  const succeeded=outcome==='succeeded',orderStatus=succeeded?'refunded':'succeeded';
  assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).state,succeeded?'applied':'canceled');
  assert.ok(operatorGet>0);
  const requests=operatorGet;
  assert.equal((await invoke(normal,'recover',recovery)).status,200);
  assert.equal(operatorGet,requests);assert.equal(remote.posts(),3);
  assert.deepEqual(await row(),succeeded?{status:'refunded',is_paid:false,publication:'archived'}:published);
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where payment_intent_id=$1',[id])).rows[0].n,Number(succeeded));
  assert.equal((await admin.query('select count(*)::int n from app.notifications where event_key=$1',['placement_refund:'+id])).rows[0].n,Number(succeeded));
  assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n,1);
  assert.deepEqual(await period(),originalPeriod);
  const recorded=await journal(orderStatus);
  assert.equal(recorded?.refund,succeeded?'applied':'canceled');
  assert.equal(recorded?.refundAction,null);
  if(ads){
   const [next,later]=ads.waiting;
   assert.deepEqual(await ads.active(),ads.original.slice(1).map(row=>row.targetId));
   const [laterResult,nextResult]=await Promise.all([ads.services.fulfill(later.id),ads.services.fulfill(next.id)]);
   assert.equal(laterResult.state,'queued');
   assert.equal(nextResult.state,'fulfilled');
   assert.ok(Date.parse(nextResult.period.publishedAt)>Date.parse(next.capturedAt));
   assert.equal(Date.parse(nextResult.period.expiresAt)-Date.parse(nextResult.period.publishedAt),7*86400000);
   assert.deepEqual(await ads.services.fulfill(next.id),nextResult);
   assert.equal((await ads.services.fulfill(later.id)).state,'queued');
   assert.deepEqual(await ads.active(),[...ads.original.slice(1).map(row=>row.targetId),next.targetId]);
  }
  await admin.query('update app.users set auth_version=auth_version+1 where id=$1',[reviewer.id]);
  assert.equal((await invoke(normal,'recover',recovery)).status,503);
  await assert.rejects(journal(orderStatus),{name:'AppSessionAccessError'});
  assert.equal(operatorGet,requests);assert.equal(remote.posts(),3);
 }finally{
  if(operatorSocket)await operatorSocket.close();else await operatorRuntime?.close();
  await workerRuntime?.close();await webDb?.close();
 }
}
