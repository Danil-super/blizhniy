import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPrimaryYooKassaRefundInspection} from '../src/lib/primary-yookassa-refund-inspection.ts';
import {createYooKassaTransport} from '../src/lib/yookassa-transport.ts';

const original={id:'10000000-0000-4000-8000-000000000001',targetId:'10000000-0000-4000-8000-000000000002',targetType:'listing',tariffId:'listing-publication',amount:'199.99',shopId:'fixture-shop',isTest:true,providerPaymentId:'2b3f5e11-000f-5000-8000-123456789abc'};
const merchant={shopId:original.shopId,isTest:true,secretKey:'test_synthetic_fixture_only'};
const captured='2026-01-01T12:00:00.123456789Z',created='2026-01-01T12:01:00.123456789Z';
const paid=(binding=original)=>({id:binding.providerPaymentId,amount:{value:binding.amount,currency:'RUB'},status:'succeeded',paid:true,refundable:true,test:true,captured_at:captured,recipient:{account_id:binding.shopId},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId}});
const refund=(patch={})=>({id:'216749f7-0016-50be-b000-078d43a63ae4',payment_id:original.providerPaymentId,amount:{value:'99.99',currency:'RUB'},status:'canceled',created_at:created,...patch});
const history=(items=[])=>({type:'list',items});
const paymentUrl=`https://api.yookassa.ru/v3/payments/${original.providerPaymentId}`;
const historyUrl=`https://api.yookassa.ru/v3/refunds?payment_id=${original.providerPaymentId}&limit=100`;
function scenario(values,binding=original){
 const calls=[];
 const inspection=createPrimaryYooKassaRefundInspection(merchant,async(url,init)=>{
  calls.push({url,init});assert.ok(calls.length<=values.length,'unexpected extra provider request');
  const value=values[calls.length-1];return typeof value==='function'?value():Response.json(value);
 });
 return {calls,run:()=>inspection.inspect(binding)};
}
const privateText='private-provider-pii-fixture';
const safeError=error=>error instanceof Error&&!String(error).includes(privateText)&&!String(error).includes(merchant.secretKey);

for(const [targetType,tariffId] of [['listing','listing-publication'],['vacancy','vacancy-publication'],['workRequest','work-request-publication']]){
 test(`TEST ${targetType} inspection brackets complete canceled-only history with two authoritative payment GETs`,async()=>{
  const binding={...original,targetType,tariffId};
  const before={...paid(binding),refunded_amount:{value:'0.00',currency:'RUB'},description:privateText};
  const after={...before,metadata:{...before.metadata,private:privateText},payment_method:{card:{last4:privateText}}};
  const {calls,run}=scenario([before,history([refund({description:privateText,metadata:{private:privateText}})]),after],binding);
  const value=await run();
  assert.deepEqual(Object.keys(value).sort(),['amount','canceledRefundCount','currency','inspectedAt','paymentId','reportedRefundedAmount']);
  assert.deepEqual({...value,inspectedAt:'<valid ISO>'},{paymentId:original.providerPaymentId,amount:original.amount,currency:'RUB',reportedRefundedAmount:'0.00',canceledRefundCount:1,inspectedAt:'<valid ISO>'});
  assert.equal(new Date(value.inspectedAt).toISOString(),value.inspectedAt);
  assert.ok(!JSON.stringify(value).includes(privateText));
  assert.deepEqual(calls.map(call=>call.url),[paymentUrl,historyUrl,paymentUrl]);
  for(const {init} of calls){
   assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
   assert.equal(init.headers['Idempotence-Key'],undefined);assert.equal(init.headers.Authorization,`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`);
   assert.ok(init.signal instanceof AbortSignal);assert.equal(init.signal,calls[0].init.signal);
  }
 });
}

test('missing refunded_amount stays unknown and only the final observation is reported',async()=>{
 for(const [beforeZero,afterZero] of [[false,false],[true,false],[false,true],[true,true]]){
  const before=paid(),after=paid();
  if(beforeZero)before.refunded_amount={value:'0.00',currency:'RUB'};
  if(afterZero)after.refunded_amount={value:'0.00',currency:'RUB'};
  const {run}=scenario([before,history(),after]);const value=await run();
  assert.equal(value.reportedRefundedAmount,afterZero?'0.00':null);assert.equal(value.canceledRefundCount,0);
 }
});

test('invalid local provenance and non-supported or LIVE targets fail before fetch',async()=>{
 let calls=0;const inspection=createPrimaryYooKassaRefundInspection(merchant,async()=>{calls++;throw Error('unexpected fetch');});
 for(const patch of [{providerPaymentId:undefined},{providerPaymentId:null},{providerPaymentId:'../../refunds'},{providerPaymentId:'a'.repeat(10000)},{id:'invalid'},{targetId:'invalid'},{tariffId:'bad tariff'},{amount:'0.00'},{amount:199.99},{amount:'199.990'},{amount:'0199.99'},{amount:'1e2'},{amount:'NaN'},{shopId:'wrong'},{isTest:false},...['specialist','application','fair_application','ad_marquee','unknown'].map(targetType=>({targetType}))]){
  await assert.rejects(inspection.inspect({...original,...patch}),safeError);
 }
 assert.equal(calls,0);assert.throws(()=>createPrimaryYooKassaRefundInspection({...merchant,isTest:false}));
});

test('each payment snapshot independently requires matching strict provenance, succeeded, paid and refundable true',async()=>{
 const patches=[{id:refund().id},{recipient:{account_id:'wrong'}},{recipient:null},{test:false},{metadata:{}},{metadata:{...paid().metadata,targetType:'vacancy'}},{amount:{value:'199.98',currency:'RUB'}},{amount:{value:'199.99',currency:'USD'}},{amount:{value:199.99,currency:'RUB'}},{status:'pending',paid:false,captured_at:undefined},{status:'waiting_for_capture',paid:true,captured_at:undefined},{status:'canceled',paid:false,captured_at:undefined},{paid:false},{refundable:false},{refundable:undefined},{refundable:'true'},{captured_at:'2026-02-30T00:00:00Z'},{captured_at:'2099-01-01T00:00:00Z'}];
 for(const stage of [0,2])for(const patch of patches){
  const values=[paid(),history(),paid()];values[stage]={...paid(),...patch};
  const {calls,run}=scenario(values);await assert.rejects(run(),safeError);assert.equal(calls.length,stage+1);
 }
});

test('nonzero or malformed refunded_amount in either snapshot refuses full-original inspection',async()=>{
 for(const stage of [0,2])for(const refunded_amount of [null,[],{},'0.00',{value:'0.01',currency:'RUB'},{value:'199.99',currency:'RUB'},{value:'-0.01',currency:'RUB'},{value:'0',currency:'RUB'},{value:'0.0',currency:'RUB'},{value:'00.00',currency:'RUB'},{value:0,currency:'RUB'},{value:'0.00',currency:'USD'},{value:'0.00'}]){
  const values=[paid(),history(),paid()];values[stage]={...paid(),refunded_amount};
  const {calls,run}=scenario(values);await assert.rejects(run(),safeError);assert.equal(calls.length,stage+1);
 }
});

test('history requires a complete list with at most 100 rows and no next_cursor property',async()=>{
 for(const list of [null,[],{}, {type:'payments',items:[]},{type:'list',items:null},{type:'list',items:{}},{type:'list'},...['cursor','',null,false,0].map(next_cursor=>({...history(),next_cursor})),history(Array.from({length:101},(_,i)=>refund({id:`216749f7-0016-50be-b000-${String(i).padStart(12,'0')}`})))]){
  const {calls,run}=scenario([paid(),list,paid()]);await assert.rejects(run(),safeError);assert.equal(calls.length,2);
 }
 const items=Array.from({length:100},(_,i)=>refund({id:`216749f7-0016-50be-b000-${String(i).padStart(12,'0')}`}));
 assert.equal((await scenario([paid(),history(items),paid()]).run()).canceledRefundCount,100);
});

test('each history row must be a valid canceled refund bound to the original payment',async()=>{
 const patches=[{status:'pending'},{status:'succeeded'},{status:'unknown'},{status:undefined},{id:undefined},{id:'../../refunds'},{payment_id:refund().id},{payment_id:undefined},{amount:undefined},{amount:{value:'200.00',currency:'RUB'}},{amount:{value:'0.00',currency:'RUB'}},{amount:{value:'-1.00',currency:'RUB'}},{amount:{value:'99.990',currency:'RUB'}},{amount:{value:'099.99',currency:'RUB'}},{amount:{value:'1e2',currency:'RUB'}},{amount:{value:99.99,currency:'RUB'}},{amount:{value:'99.99',currency:'USD'}},{created_at:undefined},{created_at:'2026-02-30T00:00:00Z'},{created_at:'2026-01-01T12:01:00+00:00'},{created_at:'2026-01-01T12:01:00.1234567890Z'},{created_at:'2099-01-01T12:01:00Z'},{created_at:'2026-01-01T12:00:00.123456788Z'}];
 for(const row of [null,[],privateText,...patches.map(patch=>refund(patch))]){
  const {calls,run}=scenario([paid(),history([row]),paid()]);await assert.rejects(run(),safeError);assert.ok(calls.length<=3);
 }
});

test('duplicate refund IDs are refused including IDs that differ only by case',async()=>{
 for(const second of [refund(),refund({id:refund().id.toUpperCase()})]){
  await assert.rejects(scenario([paid(),history([refund(),second]),paid()]).run(),safeError);
 }
});

test('canceled amounts need not total the payment, but each must not exceed the original',async()=>{
 const items=[refund({amount:{value:original.amount,currency:'RUB'}}),refund({id:'216749f7-0016-50be-b000-078d43a63ae5',amount:{value:original.amount,currency:'RUB'}})];
 assert.equal((await scenario([paid(),history(items),paid()]).run()).canceledRefundCount,2);
 const binding={...original,amount:'9999999999.99'},large=paid(binding);
 assert.equal((await scenario([large,history([refund({amount:{value:binding.amount,currency:'RUB'}})]),large],binding).run()).amount,binding.amount);
});

test('both present capture timestamps must agree at nanosecond precision',async()=>{
 await assert.rejects(scenario([paid(),history(),{...paid(),captured_at:'2026-01-01T12:00:00.123456788Z'}]).run(),safeError);
 const before={...paid(),captured_at:'2026-01-01T12:00:00.123Z'},after={...paid(),captured_at:'2026-01-01T12:00:00.123000000Z'};
 assert.equal((await scenario([before,history(),after]).run()).paymentId,original.providerPaymentId);
});

test('optional capture timestamps are not invented and a final-only capture still bounds every refund',async()=>{
 const missing={...paid(),captured_at:undefined};
 for(const [before,after] of [[missing,missing],[paid(),missing],[missing,paid()]]){
  assert.equal((await scenario([before,history([refund()]),after]).run()).canceledRefundCount,1);
 }
 const early=refund({created_at:'2026-01-01T11:59:59.999999999Z'});
 await assert.rejects(scenario([missing,history([early]),paid()]).run(),safeError);
 await assert.rejects(scenario([paid(),history([early]),missing]).run(),safeError);
 assert.equal((await scenario([missing,history([early]),missing]).run()).canceledRefundCount,1);
 assert.equal((await scenario([paid(),history([refund({created_at:captured})]),paid()]).run()).canceledRefundCount,1);
});

test('caller and merchant mutation cannot rebind an inspection after the first fetch',async()=>{
 const binding={...original},config={...merchant},calls=[];
 const inspection=createPrimaryYooKassaRefundInspection(config,async(url,init)=>{
  calls.push({url,init});if(calls.length===1){
   Object.assign(binding,{providerPaymentId:refund().id,amount:'0.01',shopId:'wrong',isTest:false,targetId:refund().id,targetType:'specialist',tariffId:'wrong'});
   Object.assign(config,{shopId:'wrong',secretKey:'test_changed',isTest:false});
  }
  return Response.json(calls.length===2?history([refund()]):paid());
 });
 const value=await inspection.inspect(binding);assert.equal(value.amount,original.amount);assert.equal(value.paymentId,original.providerPaymentId);
 assert.deepEqual(calls.map(call=>call.url),[paymentUrl,historyUrl,paymentUrl]);
 assert.equal(new Set(calls.map(call=>call.init.headers.Authorization)).size,1);
});

test('merchant configuration is snapshotted when constructing the inspection',async()=>{
 const config={...merchant};const inspection=createPrimaryYooKassaRefundInspection(config,async(url,init)=>{
  assert.equal(init.headers.Authorization,`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`);
  return Response.json(url===historyUrl?history():paid());
 });
 Object.assign(config,{shopId:'changed',isTest:false,secretKey:'test_changed'});
 assert.equal((await inspection.inspect(original)).paymentId,original.providerPaymentId);
});

test('invalid merchant configuration is rejected without exposing credentials',()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('unexpected fetch');};
 for(const patch of [{shopId:''},{shopId:'a'.repeat(65)},{shopId:'shop/path'},{shopId:'shop\n'},
  {isTest:false},{isTest:'true'},{secretKey:undefined},{secretKey:123},{secretKey:''},
  {secretKey:privateText},{secretKey:`test_${privateText}\n`},{secretKey:`test_${'x'.repeat(2048)}`}]){
  assert.throws(()=>createPrimaryYooKassaRefundInspection({...merchant,...patch},fetcher),safeError);
 }
 assert.equal(calls,0);
});

test('HTTP failures, invalid JSON and transport errors never leak private data or issue POST',async()=>{
 for(const stage of [0,1,2])for(const fail of [()=>Response.json({description:privateText},{status:404}),()=>new Response(privateText),()=>{throw Error(privateText);}]){
  const calls=[];const inspection=createPrimaryYooKassaRefundInspection(merchant,async(url,init)=>{
   calls.push({url,init});assert.equal(init.method,'GET');
   if(calls.length>stage)return fail();return Response.json(calls.length===2?history():paid());
  });
  await assert.rejects(inspection.inspect(original),safeError);assert.ok(calls.length<=3);
 }
});

test('three GETs share the existing three-attempt limit including retries',async()=>{
 for(const transientAt of [1,2,3]){
  const calls=[];const inspection=createPrimaryYooKassaRefundInspection(merchant,async(url,init)=>{
   calls.push({url,init});return calls.length===transientAt?Response.json({description:privateText},{status:503}):Response.json(url===historyUrl?history():paid());
  });
  await assert.rejects(inspection.inspect(original),safeError);assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.init.method==='GET'));assert.equal(calls[0].init.signal,calls[2].init.signal);
 }
});

test('an originating exhausted or aborted budget prevents any provider request',async()=>{
 let calls=0;const inspection=createPrimaryYooKassaRefundInspection(merchant,async()=>{calls++;return Response.json(paid());});
 const transport=createYooKassaTransport({fetch:()=>{throw Error('unused');},monotonicNow:()=>0,setTimeout,clearTimeout});
 for(const exhaust of [budget=>{budget.attempts=3;},budget=>{budget.controller.abort();}]){
  await assert.rejects(transport.withYooKassaRequestBudget(budget=>{exhaust(budget);return inspection.inspect(original,budget);}));
 }
 assert.equal(calls,0);
});

test('a supplied budget with one prior attempt cannot complete the final payment GET',async()=>{
 const calls=[];const inspection=createPrimaryYooKassaRefundInspection(merchant,async(url,init)=>{
  calls.push({url,init});return Response.json(url===historyUrl?history():paid());
 });
 const transport=createYooKassaTransport({fetch:()=>{throw Error('unused');},monotonicNow:()=>0,setTimeout,clearTimeout});
 await assert.rejects(transport.withYooKassaRequestBudget(budget=>{budget.attempts=1;return inspection.inspect(original,budget);}),safeError);
 assert.deepEqual(calls.map(call=>call.url),[paymentUrl,historyUrl]);
});

test('the shared 35-second deadline covers every response body without resetting per GET',async()=>{
 for(const slowStage of [1,2,3]){
  let clock=0,calls=0,canceled=false;const timers=new Map();let nextTimer=0;
  const inspection=createPrimaryYooKassaRefundInspection(merchant,async()=>{
   calls++;const payload=calls===2?history():paid();
   if(calls!==slowStage){clock+=10_000;return Response.json(payload);}
   return new Response(new ReadableStream({pull(controller){clock=35_000;controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));},cancel(){canceled=true;}},{highWaterMark:0}));
  });
  const transport=createYooKassaTransport({fetch:()=>{throw Error('unused');},monotonicNow:()=>clock,setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)});
  await assert.rejects(transport.withYooKassaRequestBudget(budget=>inspection.inspect(original,budget)),/timed out/);
  assert.equal(calls,slowStage);assert.equal(canceled,true);assert.equal(timers.size,0);
 }
});

test('all three bodies enforce the existing byte and chunk limits and cancel unread streams',async()=>{
 for(const stage of [0,1,2])for(const kind of ['bytes','chunks','length']){
  let canceled=false;const values=[paid(),history(),paid()];
  values[stage]=()=>{
   const stream=new ReadableStream({start(controller){
    if(kind==='chunks')for(let i=0;i<2050;i++)controller.enqueue(new Uint8Array(0));
    else controller.enqueue(new TextEncoder().encode('x'.repeat(65537)));
   },cancel(){canceled=true;}});
   return new Response(stream,kind==='length'?{headers:{'content-length':'65537'}}:undefined);
  };
  const {calls,run}=scenario(values);await assert.rejects(run(),safeError);assert.equal(calls.length,stage+1);assert.equal(canceled,true);
 }
});
