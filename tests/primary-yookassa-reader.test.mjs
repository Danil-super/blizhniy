import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPrimaryYooKassaReader} from '../src/lib/primary-yookassa-reader.ts';
const binding={id:'10000000-0000-4000-8000-000000000001',targetId:'10000000-0000-4000-8000-000000000002',targetType:'listing',tariffId:'listing-publication',amount:'199.99',shopId:'fixture-shop',isTest:true,providerPaymentId:'2b3f5e11-000f-5000-8000-123456789abc'};
const merchant={shopId:binding.shopId,isTest:true,secretKey:'test_synthetic_fixture_only'};
const payload=()=>({id:binding.providerPaymentId,amount:{value:binding.amount,currency:'RUB'},status:'pending',paid:false,test:true,recipient:{account_id:binding.shopId},
 metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
test('primary reader performs only an authoritative fixed-origin GET for the original known provider ID',async()=>{
 const calls=[],reader=createPrimaryYooKassaReader(merchant,async(url,init)=>{calls.push({url,init});return Response.json(payload());});
 const value=await reader.read(binding);assert.equal(value.status,'pending');assert.equal(calls.length,1);
 assert.equal(calls[0].url,`https://api.yookassa.ru/v3/payments/${binding.providerPaymentId}`);assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.cache,'no-store');
 assert.ok(calls[0].init.signal instanceof AbortSignal);assert.equal(calls[0].init.body,undefined);assert.equal(calls[0].init.headers['Idempotence-Key'],undefined);
});
test('missing ID, invalid amount and changed merchant/mode fail before any request',async()=>{
 let calls=0;const reader=createPrimaryYooKassaReader(merchant,async()=>{calls++;return Response.json(payload());});
 for(const patch of [{providerPaymentId:undefined},{providerPaymentId:'../../me'},{amount:'0.00'},{amount:199.99},{shopId:'different-shop'},{isTest:false}])await assert.rejects(reader.read({...binding,...patch}));
 assert.equal(calls,0);
 assert.throws(()=>createPrimaryYooKassaReader({...merchant,isTest:false}));
});
test('a provider refusal or invalid authoritative binding never becomes success and never falls back to POST',async()=>{
 for(const response of [()=>Response.json({description:'sensitive fixture provider text'},{status:404}),()=>Response.json({...payload(),recipient:{account_id:'wrong'}}),()=>Response.json({...payload(),metadata:{}})]){
  let calls=0;const reader=createPrimaryYooKassaReader(merchant,async(_url,init)=>{calls++;assert.equal(init.method,'GET');return response();});
  await assert.rejects(reader.read(binding),error=>!error.message.includes('sensitive fixture provider text'));assert.equal(calls,1);
 }
});
test('a transient provider error retries only GET for the same original payment',async()=>{
 const calls=[];
 const reader=createPrimaryYooKassaReader(merchant,async(url,init)=>{
  calls.push({url,method:init.method});
  return calls.length===1?Response.json({}, {status:503}):Response.json(payload());
 });
 assert.equal((await reader.read(binding)).status,'pending');
 assert.deepEqual(calls,[
  {url:`https://api.yookassa.ru/v3/payments/${binding.providerPaymentId}`,method:'GET'},
  {url:`https://api.yookassa.ru/v3/payments/${binding.providerPaymentId}`,method:'GET'},
 ]);
});
test('oversized bytes and excessive empty chunks are bounded without retaining private provider data',async()=>{
 let canceled=false;
 const stream=new ReadableStream({start(controller){for(let i=0;i<2050;i++)controller.enqueue(new Uint8Array(0));controller.enqueue(new TextEncoder().encode(JSON.stringify(payload())));controller.close();},cancel(){canceled=true;}});
 await assert.rejects(createPrimaryYooKassaReader(merchant,async()=>new Response(stream)).read(binding));assert.equal(canceled,true);
 await assert.rejects(createPrimaryYooKassaReader(merchant,async()=>new Response('x'.repeat(65537))).read(binding));
});
