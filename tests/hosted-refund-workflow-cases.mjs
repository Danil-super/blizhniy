import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {enableRefundFixtureTls} from './local-refund-runtime-cases.mjs';
import {provider} from './refund-worker-role-cases.mjs';

export async function testHostedRefundWorkflow({admin,config,load,operator,worker,docker,container,directory}){
 const ca=join(directory,'refund-ca.crt'),key=join(directory,'refund-key.pem');
 await enableRefundFixtureTls(admin,{docker,container},ca,key);
 const deadline=Date.now()+5000;
 while((await admin.query("select current_setting('ssl') as ssl")).rows[0].ssl!=='on'){
  assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20));
 }
 const origin='https://refund-fixture.example.invalid';
 const merchant={shopId:'hosted-refund-fixture',isTest:true,secretKey:'test_synthetic_only'};
 const environment=(entry,kind)=>({
  NODE_ENV:'production',BLIZHNIY_PAYMENT_MODE:'test',
  [kind==='operator'?'BLIZHNIY_REFUND_OPERATOR':'BLIZHNIY_REFUND_WORKER']:'hosted-schema-local-test',
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
 const id=randomUUID(),targetId=randomUUID(),providerPaymentId=randomUUID(),amount='199.00',tariffId='listing-publication';
 const createdAt=new Date(Date.now()-120000).toISOString(),capturedAt=new Date(Date.now()-60000).toISOString();
 const metadata={localPaymentId:id,targetId,targetType:'listing',tariffId};
 const body={amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:origin+'/return'},metadata};
 const category=(await admin.query("insert into app.categories(slug,name) values('hosted-refund-category','Стендовая категория') returning id")).rows[0].id;
 const region=(await admin.query("insert into app.regions(slug,name) values('hosted-refund-region','Стендовый регион') returning id")).rows[0].id;
 const city=(await admin.query("insert into app.cities(region_id,slug,name) values($1,'hosted-refund-city','Стендовый город') returning id",[region])).rows[0].id;
 await admin.query(`insert into app.listings(id,author_id,listing_type,title,description,created_at,category_id,city_id)
  values($1,$2,'sell','Синтетическое объявление','Проверка возврата',$3,$4,$5)`,[targetId,payer.id,createdAt,category,city]);
 await admin.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,
  amount,duration_days,merchant_shop_id,is_test,request_body,created_at)
  values($1,$2,'listing',$3,1,$4,$5,30,$6,true,$7,$8)`,[id,payer.id,targetId,tariffId,amount,merchant.shopId,JSON.stringify(body),createdAt]);
 await admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision,created_at) values($1,$2,$3,'listing',$4,1,$5)",
  [id,payer.id,randomUUID(),targetId,createdAt]);
 await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);
 await admin.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
 await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);
 await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);
 await admin.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2::timestamptz,$2::timestamptz+interval '30 days')",[id,capturedAt]);
 await admin.query(`update app.listings l set status='published',is_paid=true,published_at=f.published_at,expires_at=f.expires_at
  from app.payment_fulfillments f where l.id=$1 and f.intent_id=$2`,[targetId,id]);
 const approvalId=randomUUID(),remote=provider({id,providerPaymentId,amount,capturedAt,metadata},approvalId,merchant);
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
  const bridge=(token,command,signal)=>load('local-refund-operator-client').callLocalRefundOperator(operatorSocket.socketPath,token,command,signal);
  const {createAdminRefundHandler}=load('admin-refund-http');
  const handler=command=>createAdminRefundHandler({origin},()=>({limiter:{allowProduction:async()=>true},command}),()=>{});
  const normal=handler(bridge),lost=handler(async(...args)=>{await bridge(...args);throw Error('Synthetic lost approval response after commit');});
  const invoke=(run,action,input,actor=reviewer)=>run(new Request(origin+'/api/admin/refunds',{
   method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-real-ip':'192.0.2.15','x-blizhniy-request':'1',
    cookie:'__Host-blizhniy_session='+actor.token},body:JSON.stringify({action,expectedAdminId:actor.id,input}),
  }));
  const approval={id:approvalId,paymentIntentId:id,reason:'Проверка возврата за размещение.'};
  const row=async()=>(await admin.query('select p.status,l.is_paid,l.status as listing from app.payment_orders p cross join app.listings l where p.id=$1 and l.id=$2',[id,targetId])).rows[0];
  const password=randomBytes(32).toString('hex');
  await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
  webDb=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'blizhniy_runtime',password,max:2}));
  const journal=async status=>(await load('postgres-admin-payment-journal').readAdminPaymentJournal(webDb,merchant.shopId,reviewer.token,
   {expectedAdminId:reviewer.id,kind:'listing',status,after:null})).items.find(item=>item.id===id);
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
  assert.deepEqual(await row(),{status:'succeeded',is_paid:true,listing:'published'});
  assert.equal((await journal('succeeded'))?.refund,'unknown');
  const observing={id:randomUUID(),operationId:approvalId,providerRefundId:refundId,reason:'Сверка исходного возврата.'};
  const waiting=await invoke(normal,'recover',observing);
  assert.equal(waiting.status,200);assert.equal((await waiting.json()).state,'pending');
  assert.deepEqual(await row(),{status:'succeeded',is_paid:true,listing:'published'});
  assert.equal((await journal('succeeded'))?.refund,'pending');
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where payment_intent_id=$1',[id])).rows[0].n,0);
  refundStatus='succeeded';
  const recovery={...observing,id:randomUUID()};
  const confirmed=await invoke(normal,'recover',recovery);
  assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).state,'applied');
  assert.ok(operatorGet>0);
  const requests=operatorGet;
  assert.equal((await invoke(normal,'recover',recovery)).status,200);
  assert.equal(operatorGet,requests);assert.equal(remote.posts(),3);
  assert.deepEqual(await row(),{status:'refunded',is_paid:false,listing:'archived'});
  assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where payment_intent_id=$1',[id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from app.notifications where event_key=$1',['placement_refund:'+id])).rows[0].n,1);
  assert.equal((await journal('refunded'))?.refund,'applied');
  await admin.query('update app.users set auth_version=auth_version+1 where id=$1',[reviewer.id]);
  assert.equal((await invoke(normal,'recover',recovery)).status,503);
  await assert.rejects(journal('refunded'),{name:'AppSessionAccessError'});
  assert.equal(operatorGet,requests);assert.equal(remote.posts(),3);
 }finally{
  if(operatorSocket)await operatorSocket.close();else await operatorRuntime?.close();
  await workerRuntime?.close();await webDb?.close();
 }
}
