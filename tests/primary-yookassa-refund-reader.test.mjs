import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPrimaryYooKassaRefundReader} from '../src/lib/primary-yookassa-refund-reader.ts';
import {validatePrimaryYooKassaRefund,mergeRefundVerification} from '../src/lib/yookassa-refund-contract.ts';
import {createYooKassaTransport} from '../src/lib/yookassa-transport.ts';

const payment={id:'10000000-0000-4000-8000-000000000001',targetId:'10000000-0000-4000-8000-000000000002',targetType:'listing',tariffId:'listing-publication',amount:'199.99',shopId:'fixture-shop',isTest:true,providerPaymentId:'2b3f5e11-000f-5000-8000-123456789abc'};
const binding=()=>({payment:{...payment},providerRefundId:'216749f7-0016-50be-b000-078d43a63ae4',amount:'99.99'});
const merchant={shopId:payment.shopId,isTest:true,secretKey:'test_synthetic_fixture_only'};
const captured='2026-01-01T12:00:00.123456789Z',created='2026-01-01T12:01:00.123456789Z',now=Date.parse('2026-01-02T00:00:00Z');
const paid=()=>({id:payment.providerPaymentId,amount:{value:payment.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,captured_at:captured,recipient:{account_id:payment.shopId},metadata:{localPaymentId:payment.id,targetId:payment.targetId,targetType:payment.targetType,tariffId:payment.tariffId}});
const refund=(status='pending')=>({id:binding().providerRefundId,payment_id:payment.providerPaymentId,amount:{value:binding().amount,currency:'RUB'},status,created_at:created});
const verified=(status='pending')=>validatePrimaryYooKassaRefund(refund(status),binding(),now,captured);

test('refund verification uses two authoritative GETs and strips unrelated provider fields',async()=>{
 const calls=[],reader=createPrimaryYooKassaRefundReader(merchant,async(url,init)=>{
  calls.push({url,init});return Response.json(calls.length===1?paid():{...refund('succeeded'),description:'private reason',metadata:{private:'private metadata'},refund_authorization_details:{rrn:'private bank data'}});
 });
 assert.deepEqual(await reader.read(binding()),{id:binding().providerRefundId,paymentId:payment.providerPaymentId,amount:{value:'99.99',currency:'RUB'},status:'succeeded',createdAt:created});
 assert.deepEqual(calls.map(c=>c.url),[`https://api.yookassa.ru/v3/payments/${payment.providerPaymentId}`,`https://api.yookassa.ru/v3/refunds/${binding().providerRefundId}`]);
 for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);assert.equal(init.headers['Idempotence-Key'],undefined);assert.ok(init.headers.Authorization.startsWith('Basic '));}
 assert.equal(calls[0].init.signal,calls[1].init.signal);
});

test('invalid refund/payment bindings and merchant changes fail before any network request',async()=>{
 let calls=0;const reader=createPrimaryYooKassaRefundReader(merchant,async()=>{calls++;return Response.json(paid());});
 for(const patch of [{providerRefundId:undefined},{providerRefundId:'../../payments'},{providerRefundId:'a'.repeat(10000)},{amount:'0.00'},{amount:99.99},{amount:'99.990'},{amount:'1e2'},{amount:'200.00'},{amount:'NaN'},{amount:'099.99'}])await assert.rejects(reader.read({...binding(),...patch}));
 for(const patch of [{providerPaymentId:undefined},{providerPaymentId:'../../refunds'},{amount:'0.00'},{shopId:'wrong'},{isTest:false}])await assert.rejects(reader.read({...binding(),payment:{...payment,...patch}}));
 assert.equal(calls,0);assert.throws(()=>createPrimaryYooKassaRefundReader({...merchant,isTest:false}));
});

test('only a matching captured payment authorizes fetching its refund',async()=>{
 for(const patch of [{recipient:{account_id:'wrong'}},{test:false},{metadata:{}},{amount:{value:'199.98',currency:'RUB'}},{status:'pending',paid:false,captured_at:undefined},{status:'waiting_for_capture',paid:true,captured_at:undefined},{status:'canceled',paid:false,captured_at:undefined}]){
  let calls=0;await assert.rejects(createPrimaryYooKassaRefundReader(merchant,async()=>{calls++;return Response.json({...paid(),...patch});}).read(binding()));assert.equal(calls,1);
 }
});

test('all provider refund outcomes require exact ID, payment, amount and valid creation time',()=>{
 for(const status of ['pending','succeeded','canceled'])assert.equal(verified(status).status,status);
 for(const patch of [{id:payment.providerPaymentId},{payment_id:binding().providerRefundId},{amount:{value:'100.00',currency:'RUB'}},{amount:{value:'99.99',currency:'USD'}},{amount:{value:99.99,currency:'RUB'}},{amount:{value:'99.990',currency:'RUB'}},{status:'refunded'},{status:'waiting_for_capture'},{created_at:undefined},{created_at:'2026-02-30T00:00:00Z'},{created_at:'2026-01-01T12:01:00+00:00'},{created_at:'2027-01-01T12:01:00Z'},{created_at:'2026-01-01T12:00:00.123456788Z'}])assert.throws(()=>validatePrimaryYooKassaRefund({...refund(),...patch},binding(),now,captured));
 for(const invalid of [null,[],{},'private provider body'])assert.throws(()=>validatePrimaryYooKassaRefund(invalid,binding(),now,captured),e=>!e.message.includes('private provider body'));
 assert.equal(validatePrimaryYooKassaRefund({...refund(),created_at:captured},binding(),now,captured).createdAt,captured);
 assert.equal(validatePrimaryYooKassaRefund({...refund(),created_at:captured},binding(),now).createdAt,captured);
 assert.throws(()=>validatePrimaryYooKassaRefund(refund(),binding(),NaN));
});

test('refund totals use integer kopecks, including a full refund and large boundary amounts',()=>{
 const full={...binding(),amount:payment.amount};assert.equal(validatePrimaryYooKassaRefund({...refund(),amount:{value:full.amount,currency:'RUB'}},full,now).amount.value,payment.amount);
 const large={...binding(),amount:'9999999999.99',payment:{...payment,amount:'9999999999.99'}};
 assert.equal(validatePrimaryYooKassaRefund({...refund(),amount:{value:large.amount,currency:'RUB'}},large,now).amount.value,large.amount);
 assert.throws(()=>validatePrimaryYooKassaRefund({...refund(),amount:{value:'9999999999.99',currency:'RUB'}},{...large,payment:{...payment,amount:'9999999999.98'}},now));
});

test('refund timestamps preserve nanoseconds and enforce the exact future tolerance',()=>{
 const edge={...refund(),created_at:'2026-01-02T00:05:00.000000000Z'};
 assert.equal(validatePrimaryYooKassaRefund(edge,binding(),now).createdAt,edge.created_at);
 assert.throws(()=>validatePrimaryYooKassaRefund({...edge,created_at:'2026-01-02T00:05:00.000000001Z'},binding(),now));
 for(const created_at of ['2026-01-01T12:01:00Z','2026-01-01T12:01:00.1Z','2026-01-01T12:01:00.123456789Z'])assert.equal(validatePrimaryYooKassaRefund({...refund(),created_at},binding(),now).createdAt,created_at);
 for(const created_at of ['2026-01-01T12:01:00.1234567890Z','2026-01-01T12:01:00Z\n','2026-13-01T12:01:00Z','2026-01-01T25:00:00Z'])assert.throws(()=>validatePrimaryYooKassaRefund({...refund(),created_at},binding(),now));
});

test('late pending observations cannot undo terminal refunds; contradictions and changed bindings are refused',()=>{
 const pending=verified();assert.deepEqual(mergeRefundVerification(null,pending),pending);
 for(const terminal of ['succeeded','canceled']){
  const saved=verified(terminal);assert.deepEqual(mergeRefundVerification(pending,saved),saved);assert.deepEqual(mergeRefundVerification(saved,pending),saved);assert.deepEqual(mergeRefundVerification(saved,saved),saved);
  assert.throws(()=>mergeRefundVerification(saved,verified(terminal==='succeeded'?'canceled':'succeeded')));
  for(const patch of [{id:payment.providerPaymentId},{paymentId:saved.id},{amount:{value:'99.98',currency:'RUB'}},{createdAt:'2026-01-01T12:01:00.123456788Z'}])assert.throws(()=>mergeRefundVerification(saved,{...pending,...patch}));
 }
 const coarse={...pending,createdAt:'2026-01-01T12:01:00.123Z'},padded={...verified('succeeded'),createdAt:'2026-01-01T12:01:00.123000000Z'};
 assert.equal(mergeRefundVerification(coarse,padded).createdAt,coarse.createdAt);
});

test('provider failures never become refund success and never fall back to POST',async()=>{
 for(const response of [()=>Response.json({description:'private provider error'},{status:404}),()=>Response.json({...refund(),payment_id:binding().providerRefundId}),()=>new Response('invalid JSON')]){
  const calls=[];await assert.rejects(createPrimaryYooKassaRefundReader(merchant,async(url,init)=>{calls.push({url,method:init.method});return calls.length===1?Response.json(paid()):response();}).read(binding()),e=>!e.message.includes('private provider error'));
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'));
 }
});

test('payment and refund GETs share a three-attempt budget',async()=>{
 const calls=[];await assert.rejects(createPrimaryYooKassaRefundReader(merchant,async(url,init)=>{
  calls.push({url,method:init.method});return Response.json(calls.length===2?paid():{}, {status:calls.length===2?200:503});
 }).read(binding()));
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls[0].url.includes('/payments/'));assert.equal(calls[1].url,calls[0].url);assert.ok(calls[2].url.includes('/refunds/'));
});

test('the shared deadline includes payment body reading and prevents a later refund request',async()=>{
 let clock=0,calls=0,canceled=false;
 const reader=createPrimaryYooKassaRefundReader(merchant,async()=>{
  calls++;return new Response(new ReadableStream({pull(controller){clock=36_000;controller.enqueue(new TextEncoder().encode(JSON.stringify(paid())));},cancel(){canceled=true;}}));
 });
 const transport=createYooKassaTransport({fetch:()=>{throw Error('unused transport fetch');},monotonicNow:()=>clock,setTimeout,clearTimeout});
 await assert.rejects(transport.withYooKassaRequestBudget(budget=>reader.read(binding(),budget)));
 assert.equal(calls,1);assert.equal(canceled,true);
 await assert.rejects(transport.withYooKassaRequestBudget(budget=>{budget.controller.abort();return reader.read(binding(),budget);}));
 assert.equal(calls,1);
});

test('missing captured_at is not replaced by an invented settlement time',async()=>{
 let calls=0;const reader=createPrimaryYooKassaRefundReader(merchant,async()=>Response.json(++calls===1?{...paid(),captured_at:undefined}:refund()));
 assert.equal((await reader.read(binding())).createdAt,created);assert.equal(calls,2);
});

test('in-flight callers cannot rebind the expected payment, refund or merchant',async()=>{
 const original=binding(),config={...merchant},calls=[];
 const reader=createPrimaryYooKassaRefundReader(config,async(url)=>{
  calls.push(url);if(calls.length===1){original.payment.providerPaymentId=binding().providerRefundId;original.payment.amount='0.01';original.amount='0.01';original.providerRefundId=payment.providerPaymentId;config.shopId='wrong';config.secretKey='test_changed';}
  return Response.json(calls.length===1?paid():refund());
 });
 assert.equal((await reader.read(original)).amount.value,'99.99');assert.ok(calls[1].endsWith(binding().providerRefundId));
});

test('oversized or excessive-chunk refund responses are bounded',async()=>{
 for(const make of [()=>new Response('x'.repeat(65537)),()=>new Response(new ReadableStream({start(c){for(let i=0;i<2050;i++)c.enqueue(new Uint8Array(0));c.close();}}))]){
  let calls=0;await assert.rejects(createPrimaryYooKassaRefundReader(merchant,async()=>++calls===1?Response.json(paid()):make()).read(binding()));assert.equal(calls,2);
 }
});
