import assert from 'node:assert/strict';import {test} from 'node:test';
import {createApplicationPaymentClient,ApplicationPaymentClientError} from '../src/lib/client-application-payment.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',paymentId='10000000-0000-4000-8000-000000000004',stamp='2026-10-26T08:00:00.123456Z';
const input={applicationId:id,expectedRevision:'9007199254740993',creationKey:key,expectedTariffId:'job-response',expectedAmount:'199.00'};
const order={id:paymentId,creationKey:key,targetId:id,targetRevision:input.expectedRevision,tariffId:'job-response',amount:'199.00',durationDays:null,status:'created',createdAt:stamp};
const quote={applicationId:id,revision:input.expectedRevision,tariff:{id:'job-response',name:'Отклик',amount:'199.00',currency:'RUB',durationDays:null},activePayment:null};
test('application payment uses exact cookie-only requests and preserves a null duration instead of inventing placement days',async()=>{
 const calls=[],client=createApplicationPaymentClient(async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,init,body});return Response.json(body.action==='preview'?quote:body.action==='order'?{order,deliveredAt:null}:body.action==='dispatch'?{confirmationUrl:'https://yoomoney.ru/checkout/payments/v2/contract?orderId=fixture',isTest:true}:order);});
 assert.deepEqual(await client.preview(owner,id,input.expectedRevision),quote);assert.deepEqual(await client.prepare(owner,input),order);assert.deepEqual(await client.recover(owner,key),order);assert.deepEqual(await client.read(owner,paymentId),{order,deliveredAt:null});assert.equal((await client.dispatch(owner,paymentId)).isTest,true);
 for(const call of calls){assert.equal(call.path,'/api/account/application-checkout');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.body.expectedOwnerId,owner);}
 assert.equal(calls[1].init.method,'PUT');assert.deepEqual(calls[1].body,{expectedOwnerId:owner,...input});assert.equal(calls[0].body.action,'preview');
});
test('application quote and prepare reject swapped IDs, terms, financial fields and fake durations',async()=>{
 for(const bad of [{...quote,applicationId:owner},{...quote,revision:'1'},{...quote,secret:'x'},{...quote,tariff:{...quote.tariff,durationDays:30}},{...quote,tariff:{...quote.tariff,currency:'USD'}},{...quote,activePayment:{...order,targetId:owner}}])await assert.rejects(createApplicationPaymentClient(async()=>Response.json(bad)).preview(owner,id,input.expectedRevision),ApplicationPaymentClientError);
 for(const bad of [{...order,creationKey:owner},{...order,targetId:owner},{...order,targetRevision:'1'},{...order,amount:'200.00'},{...order,durationDays:30},{...order,tariffId:'listing'}])await assert.rejects(createApplicationPaymentClient(async()=>Response.json(bad)).prepare(owner,input),ApplicationPaymentClientError);
});
test('application snapshots separate payment success from actual delivery and reject malformed/private states',async()=>{
 for(const status of ['created','pending','succeeded','failed','refunded']){const snapshot={order:{...order,status},deliveredAt:null};assert.deepEqual(await createApplicationPaymentClient(async()=>Response.json(snapshot)).read(owner,paymentId),snapshot);}
 const delivered={order:{...order,status:'succeeded'},deliveredAt:'2026-10-26T08:01:00.123456Z'};assert.deepEqual(await createApplicationPaymentClient(async()=>Response.json(delivered)).read(owner,paymentId),delivered);
 for(const bad of [{...delivered,secret:'no'},{...delivered,order:{...order,status:'pending'}},{...delivered,deliveredAt:'2026-10-25T08:00:00.123456Z'},{...delivered,order:{...order,id:owner}},{...delivered,order:{...order,amount:'1e3'}}])await assert.rejects(createApplicationPaymentClient(async()=>Response.json(bad)).read(owner,paymentId),ApplicationPaymentClientError);
 assert.equal(await createApplicationPaymentClient(async()=>Response.json(null)).read(owner,paymentId),null);assert.equal(await createApplicationPaymentClient(async()=>Response.json(null)).recover(owner,key),null);
});
test('dispatch only accepts TEST and safe provider URLs and never upgrades a forged error response',async()=>{
 for(const url of ['http://yoomoney.ru/pay','https://evil.invalid/pay','https://yoomoney.ru.evil.invalid/pay','https://user:pass@yoomoney.ru/pay','https://yoomoney.ru:444/pay','https://yoomoney.ru/ bad','https://yoomoney.ru\\evil.invalid/pay'])await assert.rejects(createApplicationPaymentClient(async()=>Response.json({confirmationUrl:url,isTest:true})).dispatch(owner,paymentId),ApplicationPaymentClientError);
 await assert.rejects(createApplicationPaymentClient(async()=>Response.json({confirmationUrl:null,isTest:false})).dispatch(owner,paymentId),ApplicationPaymentClientError);
 assert.deepEqual(await createApplicationPaymentClient(async()=>Response.json({confirmationUrl:null,isTest:true})).dispatch(owner,paymentId),{confirmationUrl:null,isTest:true});
 await assert.rejects(createApplicationPaymentClient(async()=>Response.json({error:{code:'UNAUTHENTICATED'}},{status:409})).read(owner,paymentId),error=>error.code==='UNKNOWN');
});
test('owner payment snapshots validate closed-target metadata without losing captured history',async()=>{
 for(const targetClosed of [true,false]){
  const snapshot={order:{...order,status:'succeeded'},deliveredAt:null,targetClosed};
  assert.deepEqual(await createApplicationPaymentClient(async()=>Response.json(snapshot)).read(owner,paymentId),snapshot);
 }
 for(const targetClosed of [null,1,'true',{}])await assert.rejects(createApplicationPaymentClient(async()=>Response.json({order,deliveredAt:null,targetClosed})).read(owner,paymentId),ApplicationPaymentClientError);
});
test('invalid checkout and oversized or aborted replies do not become a successful order or trigger retries',async()=>{
 let calls=0;const client=createApplicationPaymentClient(async()=>{calls++;return Response.json(order);});await assert.rejects(client.prepare(owner,{...input,durationDays:30}),ApplicationPaymentClientError);assert.equal(calls,0);
 await assert.rejects(createApplicationPaymentClient(async()=>Response.json({x:'x'.repeat(17000)})).read(owner,paymentId),ApplicationPaymentClientError);
 const controller=new AbortController();controller.abort();await assert.rejects(client.read(owner,paymentId,{signal:controller.signal}),ApplicationPaymentClientError);assert.equal(calls,0);
 let writes=0;await assert.rejects(createApplicationPaymentClient(async()=>{writes++;throw Error('lost');}).prepare(owner,input),ApplicationPaymentClientError);assert.equal(writes,1);
});
