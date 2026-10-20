import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createYooKassaTransport} from '../src/lib/yookassa-transport.ts';
import {createPrimaryYooKassaReader} from '../src/lib/primary-yookassa-reader.ts';

test('a delayed timeout callback never permits fetch after the monotonic deadline',async()=>{
 let now=0,calls=0,timerCalls=0;
 const timers=new Map();let sequence=0;
 const transport=createYooKassaTransport({monotonicNow:()=>now,fetch:async()=>{calls++;return Response.json({});},
  setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{callback:()=>{timerCalls++;callback();},delay});return id;},clearTimeout:id=>timers.delete(id)});
 await assert.rejects(transport.fetchYooKassaJson('https://api.yookassa.ru/v3/payments',{method:'POST'},undefined,async budget=>{
  budget.limit(10);now=11;
  // Time advanced without running the scheduled timer, as with a busy microtask queue.
 }));
 assert.equal(calls,0);assert.equal(timerCalls,0);assert.equal(timers.size,0);
});
test('reader handoff and an awaited body preserve the originating deadline with no timer callback',async()=>{
 let now=0,calls=0,canceled=0;const timers=new Map();let next=0;
 const binding={id:'10000000-0000-4000-8000-000000000001',targetId:'10000000-0000-4000-8000-000000000002',targetType:'listing',tariffId:'listing-publication',amount:'199.99',shopId:'fixture-shop',isTest:true,providerPaymentId:'20000000-0000-4000-8000-000000000001'};
 const payload={id:binding.providerPaymentId,status:'pending',paid:false,test:true,recipient:{account_id:binding.shopId},amount:{value:binding.amount,currency:'RUB'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId}};
 const fetcher=async()=>{
  calls++;now=34999;
  return new Response(new ReadableStream({pull(controller){now=35001;controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));},cancel(){canceled++;}},{highWaterMark:0}));
 };
 const origin=createYooKassaTransport({fetch:fetcher,monotonicNow:()=>now,setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
 const reader=createPrimaryYooKassaReader({shopId:binding.shopId,isTest:true,secretKey:'test_synthetic_fixture_only'},fetcher);
 await assert.rejects(origin.withYooKassaRequestBudget(async budget=>{budget.start();return reader.read(binding,budget);}),/timed out/);
 assert.equal(calls,1);assert.equal(canceled,1);assert.equal(timers.size,0);
});
