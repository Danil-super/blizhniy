import assert from 'node:assert/strict';import {test} from 'node:test';
import {createAccountTestPaymentClient} from '../src/lib/client-account-test-payment.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
const input={listingId:id,expectedRevision:'1',creationKey:key,expectedTariffId:'listing-publication',expectedAmount:'199.00',expectedDurationDays:30};
const order={id,creationKey:key,targetId:id,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,status:'created',createdAt:'2026-10-20T12:00:00.123456Z'};
test('account TEST client validates consent and hosted redirect, sends one cookie-only call and never automatically retries a lost response',async()=>{
 const calls=[],client=createAccountTestPaymentClient(async(path,init)=>{calls.push({path,init});return Response.json(init.method==='PUT'?order:{confirmationUrl:'https://yoomoney.ru/checkout',isTest:true});});
 assert.deepEqual(await client.prepare(owner,input),order);
 assert.deepEqual(await client.dispatch(owner,id),{confirmationUrl:'https://yoomoney.ru/checkout',isTest:true});
 for(const {path,init} of calls){assert.equal(path,'/api/account/listing-checkout');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,undefined);}
 let count=0;await assert.rejects(createAccountTestPaymentClient(async()=>{count++;throw Error('lost');}).prepare(owner,input));assert.equal(count,1);
});
test('account TEST client rejects forged URLs, LIVE, extra data, oversized replies and changed frozen amounts',async()=>{
 for(const reply of [{confirmationUrl:'https://evil.example.invalid',isTest:true},{confirmationUrl:'https://yoomoney.ru@evil.example.invalid',isTest:true},{confirmationUrl:'javascript:alert(1)',isTest:true},{confirmationUrl:'https://yoomoney.ru/checkout',isTest:false},{confirmationUrl:null,isTest:true,receipt:{}}])await assert.rejects(createAccountTestPaymentClient(async()=>Response.json(reply)).dispatch(owner,id));
 await assert.rejects(createAccountTestPaymentClient(async()=>new Response(' '.repeat(16385))).dispatch(owner,id));
 await assert.rejects(createAccountTestPaymentClient(async()=>Response.json({...order,amount:'200.00'})).prepare(owner,input));
 assert.deepEqual(await createAccountTestPaymentClient(async()=>Response.json(null)).recover(owner,key),null);
});
