import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createLocalPrimaryRefundProvider} from '../scripts/local-primary-refund-provider.mjs';

export async function testLocalPrimaryRefundProvider(suite,{admin,ownerDb,load,intent,environment,workerEnvironment,operatorModule,workerModule,stateFile,project,actor,token}){
 await suite.test('durable local provider serializes the first refund, recovers a lost response through a fresh pool and applies one effect',async()=>{
  const keys=['NODE_ENV','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'});
  let operator,worker,freshDb;const state={origin:'https://127.0.0.1:3045',database:'blizhniy_prod'};
  try{
   // Exercise the same extended-protocol adapter as the manual payment path.
   await ownerDb.query(await readFile(new URL('../database/local-primary-payment.sql',import.meta.url),'utf8'));
   const original=(await admin.query("select author_id,category_id,city_id,contact_phone from app.listings where title='Синтетическая публикация'")).rows[0];assert.ok(original);
   const listing=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) values($1,'sell',$2,$3,'Устойчивый локальный возврат','Синтетическая проверка возврата после потери ответа и нового соединения.',$4,clock_timestamp()-interval '2 minutes') returning id",[original.author_id,original.category_id,original.city_id,original.contact_phone])).rows[0].id;
   const item=await intent('listing',listing,original.author_id);
   await admin.query("insert into local_primary.provider_payments(intent_id,provider_id,status,captured_at) values($1,$2,'succeeded',$3)",[item.id,item.providerPaymentId,item.capturedAt]);
   const merchant={shopId:environment.BLIZHNIY_PAYMENT_SHOP_ID,isTest:true};
   assert.equal((await new (load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(ownerDb,merchant,{postmoderation:true}).fulfill(item.id)).state,'fulfilled');
   const fetcher=await createLocalPrimaryRefundProvider({state,ownerDb});
   const authorization='Basic '+Buffer.from(environment.BLIZHNIY_PAYMENT_SHOP_ID+':'+environment.BLIZHNIY_PAYMENT_SECRET_KEY).toString('base64');
   const headers={authorization};
   const known=await(await fetcher('https://api.yookassa.ru/v3/payments/'+item.providerPaymentId,{headers})).json();assert.equal(known.refundable,true);
   operator=await operatorModule.createLocalPrimaryRefundOperatorRuntime(environment,{stateFile,project,fetcher});
   const operation=randomUUID();await operator.approve(token,actor,{id:operation,paymentIntentId:item.id,reason:'Проверка устойчивого синтетического возврата.'});
   let sendCalls=0;const sent=[];
   const losingReply=async(url,init)=>{
    if(init.method!=='POST')return fetcher(url,init);
    sendCalls++;sent.push([new Headers(init.headers).get('idempotence-key'),init.body]);
    const results=await Promise.all([fetcher(url,init),fetcher(url,init)]),bodies=await Promise.all(results.map(r=>r.json()));
    assert.deepEqual(bodies[0],bodies[1]);throw Error('Synthetic provider response lost after commit');
   };
   worker=await workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher:losingReply});
   await worker.preflight();assert.deepEqual(await worker.placement.tick(),{state:'deferred',code:'processing_unavailable'});assert.equal(sendCalls,3);assert.equal(new Set(sent.map(value=>JSON.stringify(value))).size,1);
   assert.equal((await admin.query('select count(*)::int as n from local_primary.provider_refunds')).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where payment_intent_id=$1',[item.id])).rows[0].n,0);
   await worker.close();worker=undefined;
   freshDb=new(load('postgres').PostgresDatabase)(new pg.Pool({...admin.options,password:admin.options.password,max:2,application_name:'blizhniy-local-provider-restart'}));
   const restarted=await createLocalPrimaryRefundProvider({state,ownerDb:freshDb});
   const request=(await admin.query('select idempotence_key,request_body from app.payment_refund_requests where operation_id=$1',[operation])).rows[0];
   const init={method:'POST',headers:{authorization,'content-type':'application/json','idempotence-key':request.idempotence_key},body:request.request_body};
   const before=await(await restarted('https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100',{headers})).json();assert.equal(before.items.length,1);
   assert.deepEqual(await(await restarted('https://api.yookassa.ru/v3/refunds/'+before.items[0].id,{headers})).json(),before.items[0]);
   for(const altered of [{...init,body:init.body+' '},{...init,headers:{...init.headers,'idempotence-key':'refund-'+randomUUID()}},{...init,body:init.body.replace('199.00','1.00')}])await assert.rejects(restarted('https://api.yookassa.ru/v3/refunds',altered),{message:'Local refund simulator unavailable'});
   for(const change of [{shopId:'foreign-synthetic-shop'},{isTest:false}]){
    const {ownerId,targetType,targetId,targetRevision,tariffId,amount,durationDays}=item;
    const binding={id:randomUUID(),ownerId,targetType,targetId,targetRevision,tariffId,amount,durationDays,shopId:merchant.shopId,isTest:true,...change};
    const body={amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://owned.example.invalid/return'},metadata:{...item.metadata,localPaymentId:binding.id}};
    await ownerDb.transaction(tx=>new(load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,requestBody:JSON.stringify(body)}));
    const foreignId=randomUUID();await admin.query("insert into local_primary.provider_payments(intent_id,provider_id,status,captured_at) values($1,$2,'succeeded',$3)",[binding.id,foreignId,item.capturedAt]);
    for(const url of ['https://api.yookassa.ru/v3/payments/'+foreignId,'https://api.yookassa.ru/v3/refunds?payment_id='+foreignId+'&limit=100'])await assert.rejects(restarted(url,{headers}),{message:'Local refund simulator unavailable'});
    await assert.rejects(restarted('https://api.yookassa.ru/v3/refunds',{...init,body:init.body.replace(item.providerPaymentId,foreignId)}),{message:'Local refund simulator unavailable'});
    assert.equal((await admin.query('select count(*)::int as n from local_primary.provider_refunds')).rows[0].n,1);
   }
   await admin.query("update local_primary.provider_payments set status='pending',captured_at=null where intent_id=$1",[item.id]);
   try{await assert.rejects(restarted('https://api.yookassa.ru/v3/refunds',init),{message:'Local refund simulator unavailable'});}
   finally{await admin.query("update local_primary.provider_payments set status='succeeded',captured_at=$2 where intent_id=$1",[item.id,item.capturedAt]);}
   const locker=await admin.connect(),controller=new AbortController();let canceled;
   try{
    await locker.query('begin');await locker.query('select provider_id from local_primary.provider_payments where intent_id=$1 for update',[item.id]);
    canceled=restarted('https://api.yookassa.ru/v3/refunds',{...init,signal:controller.signal}).then(()=>({accepted:true}),error=>({error}));
    const deadline=Date.now()+1500;let waiting=false;
    while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where application_name='blizhniy-local-provider-restart' and wait_event_type='Lock') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true);controller.abort();
   }finally{try{await locker.query('rollback');}finally{locker.release();}}
   const canceledResult=await canceled;assert.equal(canceledResult.accepted,undefined);assert.equal(canceledResult.error.message,'Local refund simulator unavailable');
   assert.equal((await admin.query('select count(*)::int as n from local_primary.provider_refunds')).rows[0].n,1);
   worker=await workerModule.createLocalPrimaryRefundWorkerRuntime(workerEnvironment,{stateFile,project,fetcher:restarted});
   await worker.preflight();assert.deepEqual(await worker.placement.tick(),{state:'idle'});
   await admin.query("update app.placement_refund_jobs set available_at=clock_timestamp()-interval '1 second' where approval_id=$1",[operation]);
   assert.equal((await worker.placement.tick()).state,'completed');assert.deepEqual(await worker.placement.tick(),{state:'idle'});
   assert.deepEqual(await(await restarted('https://api.yookassa.ru/v3/refunds',{...init})).json(),before.items[0]);
   assert.equal((await admin.query('select count(*)::int as n from local_primary.provider_refunds')).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where payment_intent_id=$1',[item.id])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where event_key=$1',['placement_refund:'+item.id])).rows[0].n,1);
   assert.deepEqual((await admin.query('select status,is_paid from app.listings where id=$1',[listing])).rows[0],{status:'archived',is_paid:false});
   assert.equal((await(await restarted('https://api.yookassa.ru/v3/payments/'+item.providerPaymentId,{headers})).json()).refundable,false);
  }finally{
   try{try{await worker?.close();}finally{try{await operator?.close();}finally{await freshDb?.close();}}}
   finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  }
 });
}
