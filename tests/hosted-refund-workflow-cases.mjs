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

export async function testHostedPlacementRefundWithReceipt({admin,config,load,operator,worker,directory,upgrade}){
 const ca=join(directory,'refund-ca.crt');
 const city=(await admin.query("select id from app.cities where slug='hosted-refund-city'")).rows[0].id;
 const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
 return verifyPlacementRefund({admin,config,load,operator,worker,ca,city,profession,targetType:'vacancy',tariffId:'vacancy-publication',
  outcome:'succeeded',withReceipt:true,marqueeScope:true,upgrade});
}

export async function testHostedSpecialistRefund({admin,config,load,operator,worker,directory,upgrade}){
 const ca=join(directory,'refund-ca.crt');
 const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
 return verifyPlacementRefund({admin,config,load,operator,worker,ca,profession,targetType:'specialist',tariffId:'specialist-publication',
  outcome:'succeeded',withReceipt:true,marqueeScope:true,upgrade});
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

async function captureHostedPlacement({admin,load,merchant,origin,payer,targetId,targetType,tariffId}){
 const specialist=targetType==='specialist';
 await admin.query("insert into app.tariffs(id,action,name,price,duration_days) values($1,$2,'Стендовое размещение',199,30) on conflict(id) do nothing",
  [tariffId,({specialist:'specialist_publication',listing:'listing_publication',vacancy:'vacancy_publication',workRequest:'work_request_publication'})[targetType]]);
 const flags=specialist?{BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',
  BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:payer.id,
  YOOKASSA_SHOP_ID:merchant.shopId,YOOKASSA_SECRET_KEY:merchant.secretKey}:{};
 const before=Object.fromEntries(Object.keys(flags).map(key=>[key,process.env[key]]));
 if(specialist)await admin.query('insert into app.specialist_test_enrollment(owner_id,shop_id) values($1,$2)',[payer.id,merchant.shopId]);
 Object.assign(process.env,flags);
 try{
  const db=new(load('postgres').PostgresDatabase)(admin);
  const policy={postmoderation:true,...(targetType==='listing'?{}:{targetType}),publicationTestOwner:payer.id};
  const checkout=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(db,{...merchant,siteOrigin:origin,receiptVatCode:1},policy);
  const preview=await checkout.preview(payer.token,payer.id,targetId,'1');
  const order=await checkout.prepare(payer.token,payer.id,{listingId:targetId,expectedRevision:'1',creationKey:randomUUID(),
   expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount,expectedDurationDays:preview.tariff.durationDays});
  const binding=await checkout.authorizeDispatch(payer.token,payer.id,order.id,true);
  const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db),providerPaymentId=randomUUID();
  const started=await intents.authorize(binding);
  assert.equal(started.decision,'post');
  const body=JSON.parse(started.requestBody);
  assert.equal(body.metadata.publicationMode,specialist?'specialist-account-test-v1':'account-test-v1');
  assert.equal(body.receipt.items[0].amount.value,order.amount);
  await intents.bindProvider(binding,providerPaymentId);
  const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as time`)).rows[0].time;
  await admin.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);
  await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[order.id,providerPaymentId,capturedAt]);
  const publication=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,merchant,
   {...policy,...(specialist?{specialistAccountTest:true}:{})});
  assert.equal((await publication.fulfill(order.id)).state,'fulfilled');
  return {id:order.id,targetId,providerPaymentId,amount:order.amount,capturedAt,metadata:body.metadata,requestBody:started.requestBody};
 }finally{
  for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  if(specialist)await admin.query('delete from app.specialist_test_enrollment where owner_id=$1',[payer.id]);
 }
}

async function expireSpecialistFixture(client,targetId,paymentId){
 // Age captured periods only in this disposable fixture.
  await client.query('alter table app.payment_fulfillments disable trigger payment_fulfillment_guard');
  await client.query('alter table app.service_publications disable trigger specialist_publication_window_guard');
  const aged=(await client.query(`update app.payment_fulfillments
   set published_at=statement_timestamp()-(expires_at-published_at),expires_at=statement_timestamp()
   where intent_id=$1 returning published_at::text,expires_at::text`,[paymentId])).rows[0];
  await client.query('update app.service_publications set published_at=$2,expires_at=$3 where id=$1',
   [targetId,aged.published_at,aged.expires_at]);
  await client.query('alter table app.payment_fulfillments enable trigger payment_fulfillment_guard');
  await client.query('alter table app.service_publications enable trigger specialist_publication_window_guard');
}

async function verifyHostedSpecialistExpiry({admin,load,payer,peer,targetId,paymentId}){
 const client=await admin.connect();
 try{
  await client.query('begin');
  await expireSpecialistFixture(client,targetId,paymentId);
  const query=(sql,params)=>client.query(sql,params);
  const db={query,transaction:work=>work({query})};
  const cabinet=new(load('postgres-service-publications').PostgresServicePublicationStore)(db,{specialistProfileIdentity:true});
  const catalog=new(load('postgres-public-service').PostgresPublicServiceStore)(db,{specialistProfileIdentity:true,testPublicationLabels:true});
  const history=new(load('postgres-payment-history').PostgresPaymentHistoryStore)(db);
  const read=await cabinet.read(payer.token,payer.id,'specialist',targetId);
  assert.equal(read.status,'expired');
  assert.equal(read.paid,true);
  assert.equal(await catalog.read('specialist',targetId),undefined);
  assert.equal((await catalog.list('specialist')).some(card=>card.id===targetId),false);
  const original=await history.readSpecialistOrder(payer.token,payer.id,paymentId);
  assert.equal(original.order.status,'succeeded');
  assert.equal(original.testPublication,true);
  assert.deepEqual(original.fulfillment,{publishedAt:read.publishedAt,expiresAt:read.expiresAt});
  assert.equal(await history.readSpecialistOrder(peer.token,peer.id,paymentId),null);
  await assert.rejects(client.query(`insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision)
   values($1,$2,$3,'specialist',$4,$5::bigint)`,[randomUUID(),payer.id,randomUUID(),targetId,read.revision]),
  {code:'23505',constraint:'payment_order_active_target_idx'});
 }finally{
  await client.query('rollback');
  client.release();
 }
}

async function assertHostedPlacementReceipt(admin,purchase,upgrade){
 const {id,requestBody}=purchase,body=JSON.parse(requestBody);
 const fiscalMode=async patch=>(await admin.query(`select app.placement_refund_fiscal_mode(jsonb_populate_record(i,$2::jsonb)) as mode
  from app.payment_checkout_intents i where id=$1`,[id,patch])).rows[0]?.mode;
 await assert.rejects(fiscalMode({}),{code:'23514'});
 await upgrade();
 assert.equal((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[id])).rows[0].request_body,requestBody);
 assert.equal(await fiscalMode({}),'provider-automatic-full');
 const {publicationMode,...legacy}=body.metadata;
 if(publicationMode==='account-test-v1'){
  assert.equal(await fiscalMode({request_body:JSON.stringify({...body,metadata:legacy,receipt:undefined})}),'test-without-receipt');
 }else{
  assert.equal(publicationMode,'specialist-account-test-v1');
  for(const patch of [
   {request_body:JSON.stringify({...body,metadata:legacy})},
   {request_body:JSON.stringify({...body,metadata:{...body.metadata,publicationMode:'account-test-v1'}})},
   {merchant_shop_id:'local-fixture-shop'},{duration_days:null},{tariff_id:'work-request-publication'},
  ])await assert.rejects(fiscalMode(patch),{code:'23514'});
 }
 for(const patch of [
  {request_body:JSON.stringify({...body,metadata:{...body.metadata,publicationMode:'other'}})},
  {request_body:JSON.stringify({...body,metadata:{...body.metadata,extra:'other'}})},
  {request_body:JSON.stringify({...body,receipt:undefined})},
  {is_test:false},
 ])await assert.rejects(fiscalMode(patch),{code:'23514'});
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

async function hostedRefundActor(admin,load,role){
  const id=randomUUID(),token=randomBytes(32).toString('hex');
  await admin.query('insert into app.users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,clock_timestamp(),$4)',
   [id,id+'@refund.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
  const {hashSessionToken}=load('identity');
  await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  return{id,token};
 }

export async function seedHostedRefundCommand(admin,load,merchant){
 const payer=await hostedRefundActor(admin,load,'user'),reviewer=await hostedRefundActor(admin,load,'admin');
 const city=(await admin.query("select id from app.cities where slug='hosted-refund-city'")).rows[0].id;
 const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
 const phone='+79995550158',targetId=randomUUID(),origin=process.env.BLIZHNIY_AUTH_ORIGIN;
 await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer.id,{name:'Стендовый работодатель',phone}]);
 await admin.query("insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,'hosted-refund-cli')",[payer.id,phone]);
 const form=load('work-publication-contract').parseWorkPublicationForm('vacancy',{
  title:'Синтетическая проверка запуска возврата',description:'Вакансия для проверки установленной TEST-службы.',
  cityName:'Стендовый город',professionName:'Стендовая профессия',professionId:profession,employerType:'person',
  organization:'Стендовый работодатель',salary:'3500',contactPhone:phone,placementRightConfirmed:true});
 await admin.query("insert into app.work_publications(id,author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,'vacancy',$3,$4,$5,$6)",
  [targetId,payer.id,randomUUID(),form,city,profession]);
 const item=await captureHostedPlacement({admin,load,merchant,origin,payer,targetId,targetType:'vacancy',tariffId:'vacancy-publication'});
 return {item,reviewer};
}

async function hostedSpecialistCard(admin,load,payer,profession,phone,subject){
  const name='Стендовый специалист';
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer.id,{name,phone}]);
  await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer.id,phone,subject]);
  const db=new(load('postgres').PostgresDatabase)(admin);
  const forms=new(load('postgres-service-publications').PostgresServicePublicationStore)(db,{specialistProfileIdentity:true});
  const draft=await forms.create(payer.token,payer.id,'specialist',randomUUID(),{title:name,cityName:'Стендовый город',
   professionName:'Стендовая профессия',professionId:profession,description:'Синтетическая анкета специалиста для проверки платежа.',
   price:'1500',contactPhone:phone,placementRightConfirmed:true});
  assert.equal(draft.revision,'1');
  await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[draft.id]);

  return draft.id;
}

async function verifyPlacementRefund({admin,config,load,operator,worker,ca,city,profession,targetType,tariffId,outcome,withReceipt=false,marqueeScope=targetType==='ad_marquee',upgrade}){
 const specialist=targetType==='specialist';
 const origin=specialist?process.env.BLIZHNIY_AUTH_ORIGIN:'https://refund-fixture.example.invalid';
 const merchant={shopId:specialist?'900000001':'hosted-refund-fixture',isTest:true,secretKey:'test_synthetic_only'};
 const environment=(entry,kind)=>({
  NODE_ENV:'production',BLIZHNIY_PAYMENT_MODE:'test',
  [kind==='operator'?'BLIZHNIY_REFUND_OPERATOR':'BLIZHNIY_REFUND_WORKER']:specialist?'hosted-specialist-schema-local-test':
   marqueeScope?'hosted-marquee-schema-local-test':'hosted-schema-local-test',
  BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:entry.role,BLIZHNIY_DB_PASSWORD:entry.password,BLIZHNIY_DB_CA_FILE:ca,BLIZHNIY_DB_SSL_MODE:'verify-full',
  BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,BLIZHNIY_PAYMENT_SECRET_KEY:merchant.secretKey,
 });
 const compiled=(entry,file)=>import(pathToFileURL(join(entry.destination,'scripts',file+'.mjs')).href);
 const {createLocalRefundOperatorRuntime}=await compiled(operator,'local-refund-operator-runtime');
 const {startLocalRefundOperatorServer}=await compiled(operator,'local-refund-operator-server');
 const {createLocalRefundWorkerRuntime}=await compiled(worker,'local-refund-worker-runtime');
 const {hashSessionToken}=load('identity');
 const actor=role=>hostedRefundActor(admin,load,role);
 const payer=await actor('user'),reviewer=await actor('admin'),peer=await actor('admin');
 const createdAt=new Date(Date.now()-120000).toISOString(),capturedAt=new Date(Date.now()-60000).toISOString();
 const ads=targetType==='ad_marquee'?await seedAdvertisingQueue({admin,load,actor,payer,merchant,city,createdAt,capturedAt,origin}):null;
 let targetId=ads?.purchase.targetId??randomUUID();
 const targetTable=ads||specialist?'service_publications':targetType==='listing'?'listings':'work_publications';
 if(specialist){
  targetId=await hostedSpecialistCard(admin,load,payer,profession,'+79995551298','hosted-specialist-refund');
 }else if(!ads&&targetType==='listing'){
  const category=(await admin.query("insert into app.categories(slug,name) values('hosted-refund-category','Стендовая категория') returning id")).rows[0].id;
  await admin.query(`insert into app.listings(id,author_id,listing_type,title,description,created_at,category_id,city_id)
   values($1,$2,'sell','Синтетическое объявление','Проверка возврата',$3,$4,$5)`,[targetId,payer.id,createdAt,category,city]);
 }else if(!ads){
  const phone='+79995551299';
  if(withReceipt){
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer.id,{name:'Стендовый работодатель',phone}]);
   await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer.id,phone,'hosted-refund-receipt']);
  }
  const form=load('work-publication-contract').parseWorkPublicationForm(targetType,{title:'Синтетическая публикация',
   ...(withReceipt?{description:'Синтетическая вакансия для проверки исходного платежа.',cityName:'Стендовый город',
    professionName:'Стендовая профессия',professionId:profession,employerType:'person',organization:'Стендовый работодатель',
    salary:'3500',contactPhone:phone,placementRightConfirmed:true}:{})});
  await admin.query(`insert into app.work_publications(id,author_id,kind,creation_key,form,city_id,profession_id,created_at)
   values($1,$2,$3,$4,$5,$6,$7,$8)`,[targetId,payer.id,targetType,randomUUID(),form,city,profession,createdAt]);
 }
 const purchase=ads?.purchase??(withReceipt?await captureHostedPlacement({admin,load,merchant,origin,payer,targetId,targetType,tariffId})
  :await capturePlacement(admin,{id:randomUUID(),ownerId:payer.id,targetId,targetType,tariffId,amount:'199.00',durationDays:30,merchant,createdAt,capturedAt,origin}));
 const {id,amount}=purchase;
 if(withReceipt)await assertHostedPlacementReceipt(admin,purchase,upgrade);
 if(!ads&&!withReceipt){
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
  const specialistDb=specialist?new(load('postgres').PostgresDatabase)(admin):null;
  const catalogue=specialistDb?new(load('postgres-public-service').PostgresPublicServiceStore)(specialistDb,
   {specialistProfileIdentity:true,testPublicationLabels:true}):null;
  const specialistForm=async()=>(await admin.query('select revision,form from app.service_publications where id=$1',[targetId])).rows[0];
  const originalForm=specialist?await specialistForm():null;
  if(catalogue){
   assert.equal((await catalogue.read('specialist',targetId))?.id,targetId);
   assert.equal((await admin.query('select count(*)::int n from app.specialist_test_enrollment where owner_id=$1',[payer.id])).rows[0].n,0);
   await verifyHostedSpecialistExpiry({admin,load,payer,peer,targetId,paymentId:id});
   assert.deepEqual(await period(),originalPeriod);
  }
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
  if(withReceipt){
   const saved=(await admin.query('select fiscal_mode from app.payment_refund_approvals where id=$1',[approvalId])).rows[0];
   assert.deepEqual(saved,{fiscal_mode:'provider-automatic-full'});
  }
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
  if(catalogue){
   assert.equal(await catalogue.read('specialist',targetId),undefined);
   assert.deepEqual(await specialistForm(),originalForm);
   const history=new(load('postgres-payment-history').PostgresPaymentHistoryStore)(specialistDb);
   const original=await history.readSpecialistOrder(payer.token,payer.id,id);
   assert.equal(original.order.status,'refunded');assert.ok(original.fulfillment);assert.equal(original.testPublication,true);
   assert.deepEqual((await admin.query('select action_href from app.notifications where event_key=$1',['placement_refund:'+id])).rows,
    [{action_href:'/cabinet/specialist'}]);
  }
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
   const count=(await admin.query(`select count(*)::int active from app.service_publications where kind='marquee'
    and status='published' and is_paid and deleted_at is null and published_at<=clock_timestamp() and expires_at>clock_timestamp()`)).rows[0].active;
   assert.equal(count,5);
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

export async function testHostedSpecialistRepeat({admin,config,load,reconciler,refundOperator,refundWorker,upgrade}){
 const payer=await hostedRefundActor(admin,load,'user'),peer=await hostedRefundActor(admin,load,'user');
 const reviewer=await hostedRefundActor(admin,load,'admin');
 const merchant={shopId:'900000001',isTest:true,secretKey:'test_synthetic_only'},origin=process.env.BLIZHNIY_AUTH_ORIGIN;
 const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
 const targetId=await hostedSpecialistCard(admin,load,payer,profession,'+79995551291','hosted-specialist-repeat');
 const original=await captureHostedPlacement({admin,load,merchant,origin,payer,targetId,targetType:'specialist',tariffId:'specialist-publication'});
 await upgrade();
 const PostgresDatabase=load('postgres').PostgresDatabase,password=randomBytes(32).toString('hex');
 await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
 const web=new PostgresDatabase(new pg.Pool({...config,user:'blizhniy_runtime',password,max:3}));
 const vars={BLIZHNIY_SPECIALIST_PAYMENT:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:payer.id,YOOKASSA_SHOP_ID:merchant.shopId,YOOKASSA_SECRET_KEY:merchant.secretKey};
 const previous=Object.fromEntries(Object.keys(vars).map(key=>[key,process.env[key]]));
 Object.assign(process.env,vars);
 try{
  await admin.query(`grant connect on database blizhniy_test to blizhniy_runtime;
   grant usage on schema app to blizhniy_runtime;
   grant select on app.users,app.sessions,app.cabinet_profiles,app.cities,app.specialist_categories,app.tariffs,
    app.service_publications,app.service_moderation,app.service_publication_photos,app.media_objects to blizhniy_runtime;
   grant update(auth_version) on app.users to blizhniy_runtime;
   grant update(last_seen_at) on app.sessions to blizhniy_runtime;
   grant update(profile) on app.cabinet_profiles to blizhniy_runtime;
   grant update(form) on app.service_publications to blizhniy_runtime;
   grant update(state) on app.service_moderation to blizhniy_runtime;
   grant execute on function app.phone_is_confirmed(uuid) to blizhniy_runtime`);
  for(const file of ['listing-checkout.sql','listing-checkout-dispatch.sql']){
   await admin.query(await readFile(new URL('../database/permissions/'+file,import.meta.url),'utf8'));
  }
  await admin.query('insert into app.specialist_test_enrollment(owner_id,shop_id) values($1,$2)',[payer.id,merchant.shopId]);
  await admin.query("insert into app.checkout_cancellation_test_enrollment(target_type,owner_id,shop_id) values('specialist',$1,$2)",[payer.id,merchant.shopId]);
  const {checkout:offerConfig,merchant:dispatchConfig}=load('specialist-checkout-config').readSpecialistAccountTest();
  const policy={postmoderation:true,targetType:'specialist',publicationTestOwner:payer.id};
  const checkout=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(web,offerConfig,policy);
  const fulfill=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(reconciler,merchant,{...policy,specialistAccountTest:true});
  const refundMerchant={...merchant,marqueeRefunds:true,specialistRefunds:true};
  const approvals=new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(refundOperator,refundMerchant);
  const approval={id:randomUUID(),paymentIntentId:original.id,reason:'Возврат за первый срок размещения.'};
  const cancel=new(load('postgres-checkout-cancellation').PostgresCheckoutCancellation)(web,{specialist:{
   shopId:merchant.shopId,ownerId:payer.id,publicationMode:'specialist-account-test-v1',
  }});
  const catalog=new(load('postgres-public-service').PostgresPublicServiceStore)(web,{specialistProfileIdentity:true,testPublicationLabels:true});
  const cabinet=new(load('postgres-service-publications').PostgresServicePublicationStore)(web,{specialistProfileIdentity:true});
  const current=()=>cabinet.read(payer.token,payer.id,'specialist',targetId,true);
  const preview=()=>checkout.preview(payer.token,payer.id,targetId,'1');
  const prepare=input=>checkout.prepare(payer.token,payer.id,input);
  assert.equal((await current()).canRepeat,undefined);
  assert.equal((await catalog.read('specialist',targetId))?.id,targetId);
  await assert.rejects(preview(),{name:'ListingCheckoutUnavailableError'});
  await assert.rejects(admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'specialist',$4,1)",
   [randomUUID(),payer.id,randomUUID(),targetId]),{code:'PSP01'});
  await new PostgresDatabase(admin).transaction(tx=>expireSpecialistFixture(tx,targetId,original.id));
  const originalHistory=await checkout.readOrder(payer.token,payer.id,original.id);
  const expired=await current();
  assert.equal(expired.status,'expired');assert.equal(expired.canRepeat,true);
  assert.equal(await catalog.read('specialist',targetId),undefined);
  await assert.rejects(checkout.preview(peer.token,peer.id,targetId,'1'),{name:'ListingCheckoutUnavailableError'});
  const quote=await preview();
  assert.equal(quote.activePayment,null);
  const input={listingId:targetId,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:quote.tariff.id,
   expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
  const inputs=[input,{...input,creationKey:randomUUID()}];
  const attempts=await Promise.allSettled(inputs.map(prepare));
  const winnerIndex=attempts.findIndex(result=>result.status==='fulfilled');
  assert.ok(winnerIndex>=0);
  const loser=attempts[1-winnerIndex];
  assert.equal(loser.status,'rejected');assert.equal(loser.reason.name,'ListingCheckoutConflictError');
  const draft=attempts[winnerIndex].value;
  assert.deepEqual(await prepare(inputs[winnerIndex]),draft);
  assert.equal((await preview()).activePayment.id,draft.id);
  const cancelInput={targetType:'specialist',paymentId:draft.id};
  assert.equal((await cancel.cancel(payer.token,payer.id,cancelInput)).state,'cancelled');
  assert.deepEqual(await current(),expired);
  await admin.query('update app.tariffs set price=price+1,duration_days=duration_days+1 where id=$1',[quote.tariff.id]);
  try{await assert.rejects(prepare({...input,creationKey:randomUUID()}),{name:'ListingCheckoutConflictError'});}
  finally{await admin.query('update app.tariffs set price=$2,duration_days=$3 where id=$1',[quote.tariff.id,quote.tariff.amount,quote.tariff.durationDays]);}
  const next=await prepare({...input,creationKey:randomUUID()}),providerId=randomUUID();
  assert.notEqual(next.id,original.id);
  let status='pending',body,capturedAt,writes=0,reads=0;
  const fetcher=async(url,init)=>{
   if(init.method==='POST'){
    assert.equal(String(url),'https://api.yookassa.ru/v3/payments');writes++;
    assert.equal(init.headers['Idempotence-Key'],next.id);
    body=JSON.parse(init.body);
    assert.equal(body.metadata.targetId,targetId);
    assert.equal(body.metadata.publicationMode,'specialist-account-test-v1');
    assert.equal(body.receipt.items[0].amount.value,quote.tariff.amount);
   }else{
    assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+providerId);reads++;
   }
   return Response.json({id:providerId,status,paid:status==='succeeded',test:true,recipient:{account_id:merchant.shopId},
    amount:body.amount,metadata:body.metadata,...(status==='pending'?{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}}:{captured_at:capturedAt})});
  };
  const payments=load('account-test-listing-payment').createAccountTestListingPayment(web,checkout,dispatchConfig,fetcher);
  const verification=new(load('postgres-payment-verification').PostgresPaymentVerificationStore)(reconciler,merchant,fetcher);
  await payments.dispatch(payer.token,payer.id,next.id);
  assert.equal((await verification.reconcile(next.id)).orderStatus,'pending');
  assert.equal((await fulfill.fulfill(next.id)).state,'not_ready');
  assert.deepEqual(await current(),expired);
  assert.equal(await catalog.read('specialist',targetId),undefined);
  assert.equal((await admin.query('select app.refund_target_admitted($1,$1) ready',[original.id])).rows[0].ready,false);
  await assert.rejects(approvals.approve(reviewer.token,reviewer.id,approval));
  await assert.rejects(cancel.cancel(payer.token,payer.id,{targetType:'specialist',paymentId:next.id}),{code:'CHECKOUT_STARTED'});
  capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp`)).rows[0].stamp;
  status='succeeded';
  assert.equal((await verification.reconcile(next.id)).orderStatus,'succeeded');
  assert.deepEqual(await current(),expired);
  const settled=await Promise.all([fulfill.fulfill(next.id),fulfill.fulfill(next.id)]);
  assert.equal(settled[0].state,'fulfilled');assert.deepEqual(settled[1],settled[0]);
  const fresh=await current();
  assert.equal(fresh.id,targetId);assert.equal(fresh.revision,expired.revision);assert.deepEqual(fresh.form,expired.form);
  assert.equal(fresh.status,'published');assert.equal(fresh.canRepeat,undefined);
  assert.deepEqual(settled[0].period,{publishedAt:fresh.publishedAt,expiresAt:fresh.expiresAt});
  assert.ok(fresh.publishedAt>=capturedAt);assert.ok(fresh.publishedAt>expired.expiresAt);
  assert.equal(Date.parse(fresh.expiresAt)-Date.parse(fresh.publishedAt),86400000*quote.tariff.durationDays);
  assert.equal((await catalog.read('specialist',targetId))?.testPublication,true);
  assert.deepEqual(await checkout.readOrder(payer.token,payer.id,original.id),originalHistory);
  assert.deepEqual((await fulfill.fulfill(original.id)).period,originalHistory.fulfillment);
  assert.equal((await admin.query('select app.refund_target_admitted($1,$1) ready',[original.id])).rows[0].ready,true);
  await assert.rejects(admin.query('update app.service_publications set published_at=$2,expires_at=$3 where id=$1',
   [targetId,expired.publishedAt,expired.expiresAt]),{code:'PSP03'});
  const receipts=await admin.query('select intent_id from app.payment_fulfillments where intent_id=any($1::uuid[])',[ [original.id,draft.id,next.id] ]);
  assert.deepEqual(new Set(receipts.rows.map(r=>r.intent_id)),new Set([original.id,next.id]));
  assert.equal(writes,1);assert.equal(reads,2);
  await approvals.approve(reviewer.token,reviewer.id,approval);
  const remote=provider(original,approval.id,merchant);
  const processor=load('primary-approved-placement-refund').createApprovedPlacementRefundProcessor(refundWorker,refundMerchant,remote.fetcher);
  const refunded=await processor.process(approval.id);
  assert.equal(refunded.state,'applied');assert.equal(refunded.effect.effect,'superseded');
  assert.deepEqual(await current(),fresh);
  assert.equal((await catalog.read('specialist',targetId))?.id,targetId);
  const refundedHistory=await checkout.readOrder(payer.token,payer.id,original.id);
  assert.equal(refundedHistory.order.status,'refunded');
  assert.deepEqual(refundedHistory.fulfillment,originalHistory.fulfillment);
  assert.deepEqual((await checkout.readOrder(payer.token,payer.id,next.id)).fulfillment,settled[0].period);
  assert.equal(remote.posts(),1);
 }finally{
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await web.close();
 }
}

export async function testHostedPlacementRenewals({admin,config,load,reconciler,compiledWorker,refundOperator,refundWorker}){
 const payer=await hostedRefundActor(admin,load,'user'),peer=await hostedRefundActor(admin,load,'user');
 const reviewer=await hostedRefundActor(admin,load,'admin');
 const origin=process.env.BLIZHNIY_AUTH_ORIGIN,merchant={shopId:'900000001',isTest:true,secretKey:'test_synthetic_only'};
 const city=(await admin.query("select id from app.cities where slug='hosted-refund-city'")).rows[0].id;
 const profession=(await admin.query("select id from app.specialist_categories where slug='hosted-refund-work'")).rows[0].id;
 const category=(await admin.query("select id from app.categories where slug='hosted-refund-category'")).rows[0].id;
 const phone='+79995551290',name='Стендовый заказчик';
 await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer.id,{name,phone}]);
 await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer.id,phone,'hosted-placement-renewal']);
 await admin.query(`grant select on app.listings,app.listing_blocks,app.listing_photos,app.categories,app.listing_owner_removals to blizhniy_runtime;
  grant update(title) on app.listings to blizhniy_runtime`);
 const password=randomBytes(32).toString('hex');
 await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
 const dbType=load('postgres').PostgresDatabase;
 const web=new dbType(new pg.Pool({...config,user:'blizhniy_runtime',password,max:3}));
 const flags={BLIZHNIY_PLACEMENT_RENEWALS:'account-publication-test',BLIZHNIY_LISTING_PAYMENT:'account-publication-test',
  BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',BLIZHNIY_PAYMENT_SHOP_ID:merchant.shopId,
  BLIZHNIY_PAYMENT_RECEIPT_VAT:'1',BLIZHNIY_PAYMENT_TEST_USER_ID:payer.id,YOOKASSA_SHOP_ID:merchant.shopId,YOOKASSA_SECRET_KEY:merchant.secretKey};
 const previous=Object.fromEntries(Object.keys(flags).map(key=>[key,process.env[key]]));
 Object.assign(process.env,flags);
 const stamp=column=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
 try{
  for(const [kind,tariffId,expired] of [['listing','listing-publication',false],['vacancy','vacancy-publication',true],['workRequest','work-request-publication',false]]){
   const targetId=randomUUID(),table=kind==='listing'?'listings':'work_publications';
   if(kind==='listing'){
    await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,price,contact_phone)
     values($1,$2,'sell',$3,$4,'Тестовое продление объявления','Подробное описание синтетического объявления.',500,$5)`,[targetId,payer.id,category,city,phone]);
   }else{
    const form=load('work-publication-contract').parseWorkPublicationForm(kind,{title:'Синтетическое размещение',
     description:'Подробное описание синтетической публикации для проверки продления.',cityName:'Стендовый город',
     professionName:'Стендовая профессия',professionId:profession,
     ...(kind==='vacancy'?{employerType:'person',organization:name,salary:'3500'}:{budget:'3500'}),
     contactPhone:phone,placementRightConfirmed:true});
    await admin.query('insert into app.work_publications(id,author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,$3,$4,$5,$6,$7)',
     [targetId,payer.id,kind,randomUUID(),form,city,profession]);
   }
   const initial=await captureHostedPlacement({admin,load,merchant,origin,payer,targetId,targetType:kind,tariffId});
   const window=async()=>(await admin.query(`select status,is_paid,${stamp('published_at')} as "publishedAt",${stamp('expires_at')} as "expiresAt"
    from app.${table} where id=$1`,[targetId])).rows[0];
   if(expired)await new dbType(admin).transaction(async tx=>{
    // Age the fixture while preserving the correlation between target and its paid receipt.
    await tx.query('alter table app.payment_fulfillments disable trigger payment_fulfillment_guard');
    const aged=(await tx.query(`update app.payment_fulfillments set published_at=statement_timestamp()-(expires_at-published_at),expires_at=statement_timestamp()
     where intent_id=$1 returning ${stamp('published_at')} as start,${stamp('expires_at')} as finish`,[initial.id])).rows[0];
    await tx.query(`update app.${table} set published_at=$2,expires_at=$3 where id=$1`,[targetId,aged.start,aged.finish]);
    await tx.query('alter table app.payment_fulfillments enable trigger payment_fulfillment_guard');
   });
   const before=await window();
   const policy={postmoderation:true,publicationTestOwner:payer.id,...(kind==='listing'?{}:{targetType:kind})};
   const offerConfig={...merchant,siteOrigin:origin,receiptVatCode:1};
   const checkout=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(web,offerConfig,{...policy,renewals:true});
   const quote=()=>checkout.preview(payer.token,payer.id,targetId,'1');
   const original=await checkout.readOrder(payer.token,payer.id,initial.id);
   const offer=await quote();
   assert.equal(offer.activePayment,null);
   await assert.rejects(checkout.preview(peer.token,peer.id,targetId,'1'),{name:'ListingCheckoutUnavailableError'});
   const input={listingId:targetId,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:offer.tariff.id,expectedAmount:offer.tariff.amount,
    expectedDurationDays:offer.tariff.durationDays};
   const prepare=value=>checkout.prepare(payer.token,payer.id,value);
   if(kind==='listing'){
    await admin.query("insert into app.checkout_cancellation_test_enrollment(target_type,owner_id,shop_id) values('listing',$1,$2) on conflict(target_type) do update set owner_id=excluded.owner_id,shop_id=excluded.shop_id",[payer.id,merchant.shopId]);
    const canceled=await prepare(input);
    const cancellation=new(load('postgres-checkout-cancellation').PostgresCheckoutCancellation)(web,{listing:{shopId:merchant.shopId,ownerId:payer.id,publicationMode:'account-test-v1'}});
    assert.equal((await cancellation.cancel(payer.token,payer.id,{targetType:'listing',paymentId:canceled.id})).state,'cancelled');
    assert.deepEqual(await window(),before);
   }
   const attempts=[{...input,creationKey:randomUUID()},{...input,creationKey:randomUUID()}];
   const prepared=await Promise.allSettled(attempts.map(prepare)),index=prepared.findIndex(value=>value.status==='fulfilled');
   assert.ok(index>=0);assert.equal(prepared[1-index].status,'rejected');assert.equal(prepared[1-index].reason.name,'ListingCheckoutConflictError');
   let order=prepared[index].value;
   assert.deepEqual(await prepare(attempts[index]),order);
   assert.equal((await quote()).activePayment.id,order.id);
   assert.deepEqual(await window(),before);
   assert.equal((await admin.query('select app.refund_target_admitted($1,$1) ready',[initial.id])).rows[0].ready,false);
   let providerId=randomUUID();
   let status='pending',body,capturedAt,posts=0;
   const fetcher=async(url,init)=>{
    if(init.method==='POST'){
     assert.equal(String(url),'https://api.yookassa.ru/v3/payments');posts++;
     assert.equal(init.headers['Idempotence-Key'],order.id);
     body=JSON.parse(init.body);
     assert.equal(body.metadata.targetId,targetId);assert.equal(body.metadata.publicationMode,'account-test-v1');
    }else{assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+providerId);}
    return Response.json({id:providerId,status,paid:status==='succeeded',test:true,recipient:{account_id:merchant.shopId},
     amount:body.amount,metadata:body.metadata,...(status==='pending'?{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}}:status==='succeeded'?{captured_at:capturedAt}:{})});
   };
   const payments=load('account-test-listing-payment').createAccountTestListingPayment(web,checkout,{...merchant,publication:true,ownerId:payer.id},fetcher);
   await admin.query('update app.tariffs set price=price+1 where id=$1',[tariffId]);
   try{await assert.rejects(payments.dispatch(payer.token,payer.id,order.id),{name:'ListingCheckoutConflictError'});assert.equal(posts,0);}
   finally{await admin.query('update app.tariffs set price=$2 where id=$1',[tariffId,offer.tariff.amount]);}
   await payments.dispatch(payer.token,payer.id,order.id);
   const verify=new(load('postgres-payment-verification').PostgresPaymentVerificationStore)(reconciler,merchant,fetcher);
   assert.equal((await verify.reconcile(order.id)).orderStatus,'pending');
   assert.deepEqual(await window(),before);
   const worker=compiledWorker(reconciler,merchant,fetcher,payer.id);
   if(kind==='workRequest'){
    status='canceled';
    assert.deepEqual(await worker.tick(),{state:'completed'});
    assert.equal((await checkout.readOrder(payer.token,payer.id,order.id)).order.status,'failed');
    assert.deepEqual(await window(),before);
    order=await prepare({...input,creationKey:randomUUID()});
    providerId=randomUUID();status='pending';
    await payments.dispatch(payer.token,payer.id,order.id);
   }
   capturedAt=(await admin.query(`select ${stamp('clock_timestamp()')} as stamp`)).rows[0].stamp;
   status='succeeded';
   process.env.BLIZHNIY_PLACEMENT_RENEWALS='disabled';
   try{assert.deepEqual(await worker.tick(),{state:'completed'});}
   finally{process.env.BLIZHNIY_PLACEMENT_RENEWALS=flags.BLIZHNIY_PLACEMENT_RENEWALS;}
   assert.deepEqual(await worker.tick(),{state:'idle'});
   const renewed=await window(),readback=await checkout.readOrder(payer.token,payer.id,order.id);
   const historical=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(web,offerConfig,{...policy,testModeHistory:true});
   assert.deepEqual((await historical.readOrder(payer.token,payer.id,order.id)).fulfillment,readback.fulfillment);
   assert.deepEqual(await checkout.readOrder(payer.token,payer.id,initial.id),original);
   assert.equal(renewed.status,'published');assert.equal(renewed.is_paid,true);
   assert.equal(renewed.expiresAt,readback.fulfillment.expiresAt);
   if(expired){assert.equal(renewed.publishedAt,readback.fulfillment.publishedAt);assert.ok(renewed.publishedAt>=capturedAt);}
   else{assert.equal(renewed.publishedAt,before.publishedAt);assert.equal(readback.fulfillment.publishedAt,before.expiresAt);}
   assert.equal(Date.parse(renewed.expiresAt)-Date.parse(readback.fulfillment.publishedAt),offer.tariff.durationDays*86400000);
   const journal=(await admin.query('select previous_intent_id from app.payment_renewals where intent_id=$1',[order.id])).rows;
   assert.deepEqual(journal,[{previous_intent_id:initial.id}]);
   assert.equal((await admin.query('select app.refund_target_admitted($1,$1) ready',[initial.id])).rows[0].ready,false);
   assert.equal(posts,kind==='workRequest'?2:1);
   if(expired){
    const refundMerchant={...merchant,marqueeRefunds:true,specialistRefunds:true};
    const approvals=new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(refundOperator,refundMerchant);
    const approval={id:randomUUID(),paymentIntentId:order.id,reason:'Возврат за последнее продление.'};
    await approvals.approve(reviewer.token,reviewer.id,approval);
    const remote=provider({id:order.id,providerPaymentId:providerId,amount:order.amount,capturedAt,metadata:body.metadata},approval.id,merchant);
    const processor=load('primary-approved-placement-refund').createApprovedPlacementRefundProcessor(refundWorker,refundMerchant,remote.fetcher);
    const refunded=await processor.process(approval.id);
    assert.equal(refunded.state,'applied');assert.equal(refunded.effect.effect,'revoked');
    assert.deepEqual(await window(),{...before,status:'archived'});
    const history=await checkout.readOrder(payer.token,payer.id,order.id);
    assert.equal(history.order.status,'refunded');assert.deepEqual(history.fulfillment,readback.fulfillment);
    assert.equal(remote.posts(),1);
   }
  }
  await assert.rejects(web.query('select * from app.apply_hosted_placement_renewal($1,$2)',[randomUUID(),randomUUID()]),{code:'42501'});
  await assert.rejects(reconciler.query('select * from app.apply_hosted_placement_renewal($1,$2)',[randomUUID(),randomUUID()]),{code:'PRN01'});
  assert.equal((await reconciler.query("select has_any_column_privilege('app.payment_renewals','INSERT') as granted")).rows[0].granted,false);
 }finally{
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await web.close();
 }
}

export async function testHostedMarqueeAdmission({admin,config,load,reconciler,compiledWorker,refundOperator,refundWorker}){
 const payer=await hostedRefundActor(admin,load,'user'),peer=await hostedRefundActor(admin,load,'user');
 const reviewer=await hostedRefundActor(admin,load,'admin'),origin=process.env.BLIZHNIY_AUTH_ORIGIN;
 const shopId='900000001',secretKey='test_synthetic_only',merchant={shopId,isTest:true,secretKey};
 const phone='+79995551289';
 await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[payer.id,{name:'Стендовый владелец',phone}]);
 await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[payer.id,phone,'hosted-marquee-admission']);
 const form=load('service-publication-contract').parseServicePublicationForm('marquee',{
  title:'Синтетическая рекламная строка',href:'https://advertising.example.invalid/',placementRightConfirmed:true,
 });
 const target=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'marquee',$2,$3) returning id",
  [payer.id,randomUUID(),form])).rows[0].id;
 await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);
 const password=randomBytes(32).toString('hex');
 await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
 const dbType=load('postgres').PostgresDatabase;
 const web=new dbType(new pg.Pool({...config,user:'blizhniy_runtime',password,max:3}));
 try{
  const {PostgresServiceCheckoutStore}=load('postgres-service-checkout');
  const checkoutConfig={...merchant,siteOrigin:origin,receiptVatCode:1};
  assert.throws(()=>new PostgresServiceCheckoutStore(web,checkoutConfig,'fair',payer.id),{name:'ServiceCheckoutUnavailableError'});
  const store=new PostgresServiceCheckoutStore(web,checkoutConfig,'marquee',payer.id);
  const dispatch=load('primary-payment-dispatch').createPrimaryPaymentDispatcher;
  const invoke=load('service-checkout-http').createServiceCheckoutHandler({origin},'marquee',{
   store,limiter:{allowProduction:async()=>true},dispatch:()=>assert.fail('No dispatch during preparation'),
  });
  const quote=await store.preview(payer.token,payer.id,target,'1');
  const input={publicationId:target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:quote.tariff.id,
   expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays,expectedFairDate:null};
  const prepare=(actor=payer,request=input)=>invoke(new Request(origin+'/api/account/marquee-checkout',{method:'PUT',headers:{
   host:new URL(origin).host,origin,'X-Blizhniy-Request':'1','x-real-ip':'192.0.2.19','content-type':'application/json',
   cookie:'__Host-blizhniy_session='+actor.token,
  },body:JSON.stringify({...request,expectedOwnerId:actor.id})}));
  const unadmitted=await prepare();
  assert.equal(unadmitted.status,409);assert.deepEqual(await unadmitted.json(),{error:{code:'CHECKOUT_NOT_READY'}});
  assert.equal((await admin.query('select count(*)::int as n from app.payment_orders where target_id=$1',[target])).rows[0].n,0);
  await admin.query('insert into app.marquee_test_enrollment(owner_id,shop_id) values($1,$2)',[payer.id,shopId]);
  const denied=await prepare(peer);
  assert.equal(denied.status,409);
  for(const patch of [{expectedTariffId:'fair-participation'},{expectedFairDate:'2026-11-29'}]){
   assert.equal((await prepare(payer,{...input,...patch})).status,422);
  }
  const first=await prepare();
  assert.equal(first.status,200);
  const draft=await first.json();
  assert.deepEqual(await (await prepare()).json(),draft);
  assert.deepEqual(await store.readIntent(payer.token,payer.id,input.creationKey),draft);
  assert.equal((await admin.query('select count(*)::int as n from app.marquee_test_admissions where intent_id=$1',[draft.id])).rows[0].n,1);
  await assert.rejects(admin.query('update app.marquee_test_admissions set intent_id=intent_id where intent_id=$1',[draft.id]),{code:'23514'});
  await assert.rejects(web.query('select shop_id from app.marquee_test_enrollment'),{code:'42501'});
  await assert.rejects(reconciler.query('insert into app.marquee_test_admissions(intent_id) values($1)',[randomUUID()]),{code:'42501'});
  await admin.query("insert into app.checkout_cancellation_test_enrollment(target_type,owner_id,shop_id) values('ad_marquee',$1,$2)",[payer.id,shopId]);
  const cancel=new(load('postgres-checkout-cancellation').PostgresCheckoutCancellation)(web,{ad_marquee:{ownerId:payer.id,shopId}});
  assert.equal((await cancel.cancel(payer.token,payer.id,{targetType:'ad_marquee',paymentId:draft.id})).state,'cancelled');
  assert.equal((await store.readOrder(payer.token,payer.id,draft.id)).order.status,'failed');
  await assert.rejects(cancel.cancel(payer.token,payer.id,{targetType:'fair_application',paymentId:draft.id}),{name:'CheckoutCancellationInputError'});
  const next=await prepare(payer,{...input,creationKey:randomUUID()});
  assert.equal(next.status,200);
  const order=await next.json(),id=order.id,providerId=randomUUID();
  let capturedAt,body,posts=0,gets=0;
  const fetcher=async(url,init)=>{
   if(init.method==='POST'){
    assert.equal(String(url),'https://api.yookassa.ru/v3/payments');assert.equal(init.headers['Idempotence-Key'],id);posts++;
    body=JSON.parse(init.body);
    assert.equal(body.metadata.targetType,'ad_marquee');assert.equal(body.metadata.targetId,target);
    assert.equal(body.confirmation.return_url,origin+'/oplata/uslugi/'+id+'?type=marquee');
    assert.equal(body.receipt.items[0].amount.value,order.amount);
   }else{gets++;assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+providerId);}
   return Response.json({id:providerId,status:capturedAt?'succeeded':'pending',paid:!!capturedAt,test:true,recipient:{account_id:shopId},
    amount:body.amount,metadata:body.metadata,...(capturedAt?{captured_at:capturedAt}:{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}})});
  };
  const payment=dispatch(web,merchant,fetcher);
  const send=async()=>payment.dispatch(await store.authorizeDispatch(payer.token,payer.id,id),
   attempt=>store.authorizeDispatch(payer.token,payer.id,id,true,attempt));
  assert.equal((await send()).confirmationUrl,'https://yoomoney.ru/checkout');
  const laterTarget=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'marquee',$2,$3) returning id",
   [payer.id,randomUUID(),{...form,title:'Следующая синтетическая рекламная строка'}])).rows[0].id;
  await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[laterTarget]);
  const later=(await store.prepare(payer.token,payer.id,{...input,publicationId:laterTarget,creationKey:randomUUID()}));
  const laterProviderId=randomUUID();
  let laterBody,laterCapturedAt,laterPosts=0,laterGets=0;
  const laterProvider=async(url,init)=>{
   if(init.method==='POST'){assert.equal(init.headers['Idempotence-Key'],later.id);laterPosts++;laterBody=JSON.parse(init.body);}
   else{assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+laterProviderId);laterGets++;}
   return Response.json({id:laterProviderId,status:laterCapturedAt?'succeeded':'pending',paid:!!laterCapturedAt,test:true,recipient:{account_id:shopId},
    amount:laterBody.amount,metadata:laterBody.metadata,...(laterCapturedAt?{captured_at:laterCapturedAt}:{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/next'}})});
  };
  await dispatch(web,merchant,laterProvider).dispatch(await store.authorizeDispatch(payer.token,payer.id,later.id),
   attempt=>store.authorizeDispatch(payer.token,payer.id,later.id,true,attempt));
  await admin.query('delete from app.marquee_test_enrollment where owner_id=$1',[payer.id]);
  assert.equal((await send()).confirmationUrl,'https://yoomoney.ru/checkout');
  assert.equal(posts,1);
  await assert.rejects(cancel.cancel(payer.token,payer.id,{targetType:'ad_marquee',paymentId:id}),{code:'CHECKOUT_STARTED'});
  const publicStore=new(load('postgres-public-service').PostgresPublicServiceStore)(web,{testPublicationLabels:true});
  assert.equal(await publicStore.read('marquee',target),undefined);
  const stamp=async()=>(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') stamp`)).rows[0].stamp;
  capturedAt=await stamp();
  laterCapturedAt=await stamp();
  assert.ok(laterCapturedAt>capturedAt);
  const background=()=>compiledWorker(reconciler,merchant,(url,init)=>String(url).endsWith('/'+laterProviderId)?laterProvider(url,init):fetcher(url,init),peer.id,undefined,true,true);
  const worker=background(),beforeVerification=gets;
  for(let tick=0;tick<2;tick++)assert.equal((await worker.tick()).state,'completed');
  assert.equal(gets,beforeVerification+1);assert.equal(laterGets,1);
  assert.equal((await store.readOrder(payer.token,payer.id,id)).order.status,'succeeded');
  assert.equal((await store.readOrder(payer.token,payer.id,later.id)).order.status,'succeeded');
  const {id:fair}=(await admin.query("select i.id from app.payment_checkout_intents i join app.payment_orders o on o.id=i.id and o.status='succeeded' where i.target_type='fair_application' limit 1")).rows[0];
  assert.equal((await admin.query('select app.service_payment_eligible($1) as ready',[fair])).rows[0].ready,false);
  for(const table of ['service_payment_terms','payment_dispatch_anchors']){
   await assert.rejects(web.query(`insert into app.${table}(intent_id) values($1)`,[fair]),{code:'PSM01'});
  }
  await assert.rejects(reconciler.query('insert into app.payment_fulfillments(intent_id) values($1)',[fair]),{code:'PSV01'});
  assert.equal((await admin.query('select app.refund_target_admitted($1,$1) as ready',[fair])).rows[0].ready,false);
  const slots=async()=>(await admin.query("select id from app.service_publications where kind='marquee' and status='published' and is_paid and expires_at>clock_timestamp() order by id")).rows;
  const oldSlots=await slots();
  assert.equal(oldSlots.length,5);
  assert.equal((await admin.query('select app.service_payment_eligible($1) as ready',[id])).rows[0].ready,true);
  await assert.rejects(reconciler.query('insert into app.payment_fulfillments(intent_id) values($1)',[id]),{code:'PSQ01'});
  assert.equal((await store.readOrder(payer.token,payer.id,id)).fulfillment,null);
  for(let tick=0;tick<13;tick++)assert.equal((await worker.tick()).state,'idle');
  assert.equal(gets,beforeVerification+1);assert.equal(laterGets,1);
  await admin.query('update app.service_publications set expires_at=statement_timestamp() where id=$1',[oldSlots[0].id]);
  const fills=await Promise.all([worker.tick(),background().tick()]);
  assert.ok(fills.some(result=>result.state==='completed'));
  assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n,1);
  assert.equal(gets,beforeVerification+1);assert.equal(laterGets,1);assert.equal(posts,1);
  assert.equal((await slots()).length,5);
  assert.equal((await store.readOrder(payer.token,payer.id,later.id)).fulfillment,null);
  assert.equal(await publicStore.read('marquee',laterTarget),undefined);
  const snapshot=await store.readOrder(payer.token,payer.id,id);
  assert.ok(snapshot.fulfillment.publishedAt>=capturedAt);
  assert.equal(Date.parse(snapshot.fulfillment.expiresAt)-Date.parse(snapshot.fulfillment.publishedAt),order.durationDays*86400000);
  const published=await publicStore.read('marquee',target);
  assert.equal(published.id,target);
  assert.equal(published.text,'ТЕСТ · '+form.title);
  assert.equal(published.publishedAt,snapshot.fulfillment.publishedAt);
  assert.equal(published.expiresAt,snapshot.fulfillment.expiresAt);
  const refundMerchant={...merchant,marqueeRefunds:true,specialistRefunds:true};
  const approval={id:randomUUID(),paymentIntentId:id,reason:'Контроль возврата размещения рекламы.'};
  await new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(refundOperator,refundMerchant).approve(reviewer.token,reviewer.id,approval);
  const remote=provider({id,providerPaymentId:providerId,amount:order.amount,capturedAt,metadata:body.metadata},approval.id,merchant);
  const refund=load('primary-approved-placement-refund').createApprovedPlacementRefundProcessor(refundWorker,refundMerchant,remote.fetcher);
  const refunded=await refund.process(approval.id);
  assert.equal(refunded.state,'applied');assert.equal(refunded.effect.effect,'revoked');assert.equal(remote.posts(),1);
  assert.equal(await publicStore.read('marquee',target),undefined);
  assert.equal((await slots()).length,4);
  const history=await store.readOrder(payer.token,payer.id,id);
  assert.equal(history.order.status,'refunded');assert.deepEqual(history.fulfillment,snapshot.fulfillment);
  assert.equal((await worker.tick()).state,'completed');
  assert.equal((await slots()).length,5);
  const nextPeriod=(await store.readOrder(payer.token,payer.id,later.id)).fulfillment;
  assert.ok(nextPeriod.publishedAt>=laterCapturedAt);
  assert.equal(Date.parse(nextPeriod.expiresAt)-Date.parse(nextPeriod.publishedAt),later.durationDays*86400000);
  assert.equal((await publicStore.read('marquee',laterTarget))?.expiresAt,nextPeriod.expiresAt);
  assert.equal(laterPosts,1);assert.equal(laterGets,1);
 }finally{await web.close();}
}
