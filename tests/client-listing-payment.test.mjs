import assert from 'node:assert/strict';import {test} from 'node:test';
import {createListingPaymentClient,ListingPaymentClientError} from '../src/lib/client-listing-payment.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const order={id,creationKey:key,targetId:key,targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,status:'created',createdAt:'2026-10-19T12:00:00.123456Z'};
const snapshot={order,fulfillment:null};
test('payment readback is cookie-only, owner/id-bound, no-store and has no financial side effects or retries',async()=>{
 const calls=[],client=createListingPaymentClient(async(path,init)=>{calls.push({path,init});return Response.json(snapshot);});
 assert.deepEqual(await client.read(owner,id),snapshot);assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/account/listing-checkout');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.headers.Authorization,undefined);
 assert.deepEqual(JSON.parse(calls[0].init.body),{expectedOwnerId:owner,action:'order',paymentId:id});
 assert.equal(await createListingPaymentClient(async()=>Response.json(null)).read(owner,id),null);
 let attempts=0;await assert.rejects(createListingPaymentClient(async()=>{attempts++;throw Error('Lost response');}).read(owner,id),ListingPaymentClientError);assert.equal(attempts,1);
});
test('payment client refuses foreign, leaking, malformed and contradictory snapshots',async()=>{
 for(const bad of [{...snapshot,receipt:{}},{order:{...order,id:key},fulfillment:null},{order:{...order,targetRevision:1},fulfillment:null},{order:{...order,status:'paid'},fulfillment:null},{order:{...order,amount:'199.999'},fulfillment:null},{order:{...order,createdAt:'2026-02-30T12:00:00.123456Z'},fulfillment:null},{...snapshot,fulfillment:{publishedAt:order.createdAt,expiresAt:'2026-11-19T12:00:00.123456Z'}}])await assert.rejects(createListingPaymentClient(async()=>Response.json(bad)).read(owner,id),ListingPaymentClientError);
 const done={order:{...order,status:'succeeded'},fulfillment:{publishedAt:order.createdAt,expiresAt:'2026-11-18T12:00:00.123456Z'}};
 assert.deepEqual(await createListingPaymentClient(async()=>Response.json(done)).read(owner,id),done);
 for(const bad of [{...done,fulfillment:{...done.fulfillment,expiresAt:done.fulfillment.publishedAt}},{...done,fulfillment:{...done.fulfillment,expiresAt:'bad'}}])await assert.rejects(createListingPaymentClient(async()=>Response.json(bad)).read(owner,id),ListingPaymentClientError);
 assert.deepEqual(await createListingPaymentClient(async()=>Response.json({...done,order:{...done.order,status:'refunded'}})).read(owner,id),{...done,order:{...done.order,status:'refunded'}});
});
test('payment client bounds body/chunks, aborts before network and accepts only status-matched error codes',async()=>{
 for(const response of [()=>new Response('x'.repeat(16385)),()=>new Response('{'),()=>new Response(new Uint8Array([255]))])await assert.rejects(createListingPaymentClient(async()=>response()).read(owner,id),ListingPaymentClientError);
 let cancelled=false;await assert.rejects(createListingPaymentClient(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}}))).read(owner,id),ListingPaymentClientError);assert.equal(cancelled,true);
 let calls=0;await assert.rejects(createListingPaymentClient(async()=>{calls++;return Response.json(snapshot);}).read(owner,id,{signal:AbortSignal.abort()}),ListingPaymentClientError);assert.equal(calls,0);
 for(const [status,code,expected] of [[401,'UNAUTHENTICATED','UNAUTHENTICATED'],[503,'CHECKOUT_DISABLED','CHECKOUT_DISABLED'],[429,'RATE_LIMITED','RATE_LIMITED'],[500,'UNAUTHENTICATED','UNKNOWN']])await assert.rejects(createListingPaymentClient(async()=>Response.json({error:{code}},{status})).read(owner,id),error=>error.code===expected);
});
