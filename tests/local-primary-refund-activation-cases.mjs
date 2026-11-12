import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {startLocalPrimaryRefunds} from '../scripts/local-primary-refunds.mjs';

export async function testLocalPrimaryRefundActivation(suite,{admin,ownerDb,load,intent,environment,workerEnvironment,stateFile,actor,token}){
 await suite.test('manual activation builds fresh artifacts and connects the real HTTP boundary to TLS roles and durable fake refunds',async()=>{
  const state=JSON.parse(await readFile(stateFile,'utf8')),parent=dirname(stateFile),keys=['NODE_ENV','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let services;
  try{
   Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
   await writeFile(join(parent,'refunds.json'),JSON.stringify({version:1,project:state.project,containerId:state.containerId,operatorPassword:environment.BLIZHNIY_DB_PASSWORD,workerPassword:workerEnvironment.BLIZHNIY_DB_PASSWORD}),{mode:0o600});
   await writeFile(join(parent,'refund-db-ca.pem'),await readFile(environment.BLIZHNIY_DB_CA_FILE),{mode:0o600});
   const source=(await admin.query("select author_id,category_id,city_id,contact_phone from app.listings where title='Синтетическая публикация'")).rows[0];
   const listing=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) values($1,'sell',$2,$3,'Проверка ручного запуска','Синтетическая проверка HTTP, отдельного сокета и устойчивого провайдера.',$4,clock_timestamp()-interval '2 minutes') returning id",[source.author_id,source.category_id,source.city_id,source.contact_phone])).rows[0].id;
   const payment=await intent('listing',listing,source.author_id);
   await admin.query("insert into local_primary.provider_payments(intent_id,provider_id,status,captured_at) values($1,$2,'succeeded',$3)",[payment.id,payment.providerPaymentId,payment.capturedAt]);
   assert.equal((await new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,{shopId:environment.BLIZHNIY_PAYMENT_SHOP_ID,isTest:true},{postmoderation:true}).fulfill(payment.id)).state,'fulfilled');
   const {createAdminRefundHandler}=load('admin-refund-http'),{callLocalRefundOperator}=load('local-refund-operator-client');
   for(let restart=0;restart<2;restart++){
    const controller=new AbortController(),events=[];
    services=await startLocalPrimaryRefunds({stateFile,signal:controller.signal,report:async event=>events.push(event)});
    const socket=services.socketPath;
    const handler=createAdminRefundHandler({origin:'https://admin.example.invalid'},()=>({limiter:new(load('auth-http').AuthRateLimiter)(ownerDb,state.rateSecret),command:(...args)=>callLocalRefundOperator(socket,...args)}),()=>{});
    const request=command=>new Request('https://admin.example.invalid/api/admin/refunds',{method:'POST',headers:{host:'admin.example.invalid',origin:'https://admin.example.invalid','content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+token},body:JSON.stringify(command)});
    if(restart===0){
     const approved=await handler(request({action:'approve',expectedAdminId:actor,input:{id:randomUUID(),paymentIntentId:payment.id,reason:'Полный возврат через ручной локальный контур.'}}));assert.equal(approved.status,200);
     const deadline=Date.now()+20000;
     while((await admin.query('select count(*)::int as n from app.payment_refund_effects where payment_intent_id=$1',[payment.id])).rows[0].n===0){assert.ok(Date.now()<deadline,'owned worker completes the queued refund');await new Promise(resolve=>setTimeout(resolve,100));}
    }
    const listed=await handler(request({action:'list',expectedAdminId:actor,input:null}));assert.equal(listed.status,200);
    assert.ok((await listed.json()).items.some(row=>row.id===payment.id&&row.status==='refunded'));
    assert.equal(events[0].status,'ready');await services.close();assert.equal(await services.done,0);services=undefined;
    assert.equal((await handler(request({action:'list',expectedAdminId:actor,input:null}))).status,503);
    assert.equal((await readdir(parent)).filter(name=>name.startsWith('refund-runtime-')).length,0);
   }
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where payment_intent_id=$1',[payment.id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+payment.id])).rows[0].n,1);
   assert.equal((await admin.query("select count(*)::int as n from pg_stat_activity where application_name in ('blizhniy-local-refund-provider','blizhniy-local-refund-worker','blizhniy-local-refund-operator')")).rows[0].n,0);
  }finally{
   try{await services?.close();}finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
 });
}
