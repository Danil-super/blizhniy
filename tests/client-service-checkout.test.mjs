import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {parseServicePaymentOrder,parseServicePaymentSnapshot,serviceCheckout}=load('client-service-checkout');
const id='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const fair={id,creationKey:key,targetId:target,targetRevision:'1',tariffId:'fair-participation',amount:'1000.00',durationDays:null,status:'created',createdAt:'2026-11-13T00:00:00.000000Z',fairEvent:{date:'2026-11-29',endsAt:'2026-11-29T21:00:00.000000Z'}};
test('service responses preserve fixed fair terms and distinguish paid waiting advertising from execution',()=>{
 assert.deepEqual(parseServicePaymentOrder('fair',fair),fair);
 const marquee={...fair,tariffId:'ad-marquee',amount:'299.00',durationDays:7,fairEvent:null,status:'succeeded'};assert.deepEqual(parseServicePaymentSnapshot('marquee',{order:marquee,eventEnded:false,fulfillment:null},id),{order:marquee,eventEnded:false,fulfillment:null});
 for(const value of [{...fair,href:'javascript:bad'},{...fair,durationDays:30},{...fair,amount:'1e3'},{...fair,fairEvent:{...fair.fairEvent,endsAt:'bad'}}])assert.throws(()=>parseServicePaymentOrder('fair',value));
 assert.throws(()=>parseServicePaymentSnapshot('fair',{order:fair,eventEnded:false,fulfillment:{publishedAt:fair.createdAt,expiresAt:fair.fairEvent.endsAt}},id));
 assert.throws(()=>parseServicePaymentSnapshot('fair',{order:{...fair,status:'succeeded'},eventEnded:false,fulfillment:{publishedAt:fair.createdAt,expiresAt:'2026-12-27T21:00:00.000000Z'}},id));
});
test('prepared service readback is bound to the exact original owner request and uses same-origin no-store without automatic retry',async()=>{
 const original=globalThis.fetch;let calls=0;const input={publicationId:target,expectedRevision:'1',creationKey:key,expectedTariffId:'fair-participation',expectedAmount:'1000.00',expectedDurationDays:null,expectedFairDate:fair.fairEvent.date};
 try{
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/account/fair-checkout');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.method,'PUT');assert.equal(JSON.parse(init.body).expectedOwnerId,target);return Response.json(fair);};
  assert.deepEqual(await serviceCheckout.prepare('fair',target,input),fair);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return Response.json({...fair,targetId:id});};await assert.rejects(serviceCheckout.prepare('fair',target,input));assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;throw Error('Lost reply');};await assert.rejects(serviceCheckout.prepare('fair',target,input));assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});

test('client cancels oversized service replies and does not issue a replacement financial request',async()=>{
 const original=globalThis.fetch;let cancelled=false,calls=0;
 try{globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(20000)));},cancel(){cancelled=true;}}));};
  await assert.rejects(serviceCheckout.order('fair',target,id));assert.equal(calls,1);assert.equal(cancelled,true);
 }finally{globalThis.fetch=original;}
});
