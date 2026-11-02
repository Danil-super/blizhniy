import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {createPrimaryRefundDispatcher} = load('primary-refund-dispatch');
const merchant = {shopId:'dispatch-fixture',isTest:true,secretKey:'test_synthetic_fixture'};

test('refund dispatch requires a fresh authorization callback before any SQL or provider request',async()=>{
 let sql=0,http=0;
 const db={transaction:async()=>{sql++;throw Error('unexpected SQL');},query:async()=>{sql++;throw Error('unexpected SQL');}};
 const dispatcher=createPrimaryRefundDispatcher(db,merchant,async()=>{http++;throw Error('unexpected HTTP');});
 for(const callback of [undefined,null,true,'authorized',{}]) await assert.rejects(dispatcher.dispatch('10000000-0000-4000-8000-000000000001',callback));
 assert.equal(sql,0);assert.equal(http,0);
});

const {PostgresRefundDispatchStore}=load('postgres-refund-dispatch');
const {PostgresRefundJournalStore}=load('postgres-refund-journal');
const {buildPlacementRefundRequest}=load('refund-request-contract');
const operationId='10000000-0000-4000-8000-000000000001';
const payment={id:'10000000-0000-4000-8000-000000000002',targetId:'10000000-0000-4000-8000-000000000003',targetType:'listing',tariffId:'listing-publication',amount:'199.00',shopId:merchant.shopId,isTest:true,providerPaymentId:'10000000-0000-4000-8000-000000000004'};
const providerRefundId='10000000-0000-4000-8000-000000000005';
const paymentCapturedAt='2026-01-01T00:00:00.123456Z',createdAt='2026-01-01T00:01:00.123456Z';
const request={operationId,paymentIntentId:payment.id,providerPaymentId:payment.providerPaymentId,amount:payment.amount,shopId:merchant.shopId,isTest:true,createdAt:'2026-01-01T00:00:01.000000Z',...buildPlacementRefundRequest({operationId,paymentIntentId:payment.id,providerPaymentId:payment.providerPaymentId,amount:payment.amount})};
const paid=()=>({id:payment.providerPaymentId,amount:{value:payment.amount,currency:'RUB'},status:'succeeded',paid:true,refundable:true,test:true,captured_at:paymentCapturedAt,recipient:{account_id:merchant.shopId},metadata:{localPaymentId:payment.id,targetId:payment.targetId,targetType:payment.targetType,tariffId:payment.tariffId}});
const refund=(patch={})=>({id:providerRefundId,payment_id:payment.providerPaymentId,amount:{value:payment.amount,currency:'RUB'},status:'pending',created_at:createdAt,metadata:{localRefundId:operationId,localPaymentId:payment.id},...patch});
const result={operationId,paymentIntentId:payment.id,providerRefundId,providerPaymentId:payment.providerPaymentId,amount:payment.amount,currency:'RUB',status:'pending',createdAt};
function setup(t,options={}){
 const trace=[],calls=[],ids=new Set();let candidateId=options.candidateId??null,attempted=options.attempted??false,number=0;
 const initial={request:{...request},payment:{...payment},paymentCapturedAt};
 const known=()=>({...initial,candidateId,attempted});
 const restore=[];
 function patch(type,name,fn){const previous=type.prototype[name];type.prototype[name]=fn;restore.push(()=>{type.prototype[name]=previous;});}
 t.after(()=>{for(const undo of restore.reverse())undo();});
 patch(PostgresRefundDispatchStore,'load',async id=>{trace.push('load');assert.equal(id,operationId);return known();});
 patch(PostgresRefundDispatchStore,'authorize',async(id,attemptId)=>{
  trace.push('authorize');assert.equal(id,operationId);assert.match(attemptId,/^[a-f0-9-]{36}$/);assert.ok(!ids.has(attemptId));ids.add(attemptId);
  if(options.authorize){const answer=await options.authorize({known:known(),attemptId,number:++number});if(answer.decision==='recover')candidateId=answer.known.candidateId;return answer;}
  if(candidateId)return {decision:'recover',known:known()};
  attempted=true;return {decision:'post',known:known(),attemptId,remainingMs:60000};
 });
 patch(PostgresRefundDispatchStore,'bindCandidate',async(id,attemptId,refundId,source)=>{
  trace.push('bind');assert.equal(id,operationId);assert.ok(ids.has(attemptId));assert.equal(refundId,providerRefundId);
  assert.deepEqual(source.request,initial.request);assert.deepEqual(source.payment,initial.payment);assert.equal(source.paymentCapturedAt,paymentCapturedAt);
  if(options.bind)await options.bind();candidateId=refundId;
 });
 patch(PostgresRefundJournalStore,'reconcile',async(id,candidate)=>{trace.push('reconcile');assert.equal(id,operationId);assert.equal(candidate,providerRefundId);if(options.reconcile)await options.reconcile();return result;});
 const fetcher=async(url,init)=>{
  calls.push({url:String(url),init});trace.push(init.method);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers.Authorization,`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`);
  if(init.method==='POST'){
   assert.equal(String(url),'https://api.yookassa.ru/v3/refunds');assert.equal(init.body,request.requestBody);assert.equal(init.headers['Idempotence-Key'],request.idempotenceKey);
   assert.equal(trace.at(-2),'permission');return options.post?options.post(calls.filter(c=>c.init.method==='POST').length):Response.json(refund());
  }
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers['Idempotence-Key'],undefined);
  if(String(url).includes('refunds?'))return Response.json({type:'list',items:[]});return Response.json({...paid(),...options.paymentPatch});
 };
 const db={transaction:async()=>{throw Error('mocked store must not issue SQL');}};
 return {trace,calls,ids,known,dispatcher:createPrimaryRefundDispatcher(db,merchant,fetcher),permission:async()=>{trace.push('permission');if(options.permission)await options.permission();}};
}

test('fresh dispatcher brackets inspection before durable authorization and persists POST candidate before journal',async t=>{
 const {dispatcher,permission,trace,calls}=setup(t);assert.deepEqual(await dispatcher.dispatch(operationId,permission),result);
 assert.deepEqual(trace,['load','GET','GET','GET','authorize','permission','POST','bind','reconcile']);assert.equal(calls[0].init.signal,calls[2].init.signal);
});

test('known candidate goes directly to journal without HTTP POST or callback',async t=>{
 const x=setup(t,{candidateId:providerRefundId});assert.deepEqual(await x.dispatcher.dispatch(operationId,async()=>{throw Error('unexpected permission');}),result);assert.deepEqual(x.trace,['load','reconcile']);assert.equal(x.calls.length,0);
});

test('unknown prior send skips balance inspection and retries only original immutable operation',async t=>{
 const x=setup(t,{attempted:true});await x.dispatcher.dispatch(operationId,x.permission);assert.deepEqual(x.trace,['load','authorize','permission','POST','bind','reconcile']);
});

test('503 retries each authorize freshly while preserving one shared POST budget and exact bytes',async t=>{
 const x=setup(t,{post:n=>n<3?Response.json({description:'private fixture'},{status:503}):Response.json(refund())});await x.dispatcher.dispatch(operationId,x.permission);
 const posts=x.calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,3);assert.equal(x.ids.size,3);assert.ok(posts.every(c=>c.init.signal===posts[0].init.signal));assert.equal(x.trace.filter(v=>v==='permission').length,3);assert.equal(x.trace.filter(v=>v==='bind').length,1);
});

test('unknown provider outcome never binds a candidate and next call skips inspection',async t=>{
 let succeed=false;const x=setup(t,{post:()=>{if(!succeed)throw Error('private network fixture');return Response.json(refund());}});
 await assert.rejects(x.dispatcher.dispatch(operationId,x.permission),e=>!String(e).includes('private network fixture'));assert.equal(x.ids.size,3);assert.equal(x.trace.filter(v=>v==='bind').length,0);
 succeed=true;const before=x.calls.length;await x.dispatcher.dispatch(operationId,x.permission);assert.deepEqual(x.calls.slice(before).map(c=>c.init.method),['POST']);assert.equal(x.ids.size,4);
});

test('candidate discovered by fresh authorization switches to recovery before permission and POST',async t=>{
 const x=setup(t,{authorize:({known})=>({decision:'recover',known:{...known,candidateId:providerRefundId}})});await x.dispatcher.dispatch(operationId,async()=>{throw Error('must not authorize');});assert.equal(x.trace.includes('POST'),false);assert.equal(x.trace.includes('bind'),false);assert.equal(x.trace.at(-1),'reconcile');
});

test('callback failure leaves unknown durable attempt and never issues POST',async t=>{
 const x=setup(t,{permission:()=>{throw Error('revoked permission');}});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.ids.size,1);assert.equal(x.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(x.known().attempted,true);
});

for(const [label,patch]of [['payment',{payment_id:providerRefundId}],['amount',{amount:{value:'198.00',currency:'RUB'}}],['metadata',{metadata:{localRefundId:providerRefundId,localPaymentId:payment.id}}],['capture',{created_at:'2025-12-31T00:00:00Z'}],['status',{status:'succeeded-invalid'}],['id',{id:'../../refunds'}]])test('invalid POST '+label+' cannot bind or reconcile',async t=>{
 const x=setup(t,{post:()=>Response.json(refund(patch))});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('bind'),false);assert.equal(x.trace.includes('reconcile'),false);assert.equal(x.ids.size,1);
});

test('full original prepared source must still match immediately before sending',async t=>{
 const x=setup(t,{authorize:({known,attemptId})=>({decision:'post',known:{...known,paymentCapturedAt:'2026-01-01T00:00:00.123457Z'},attemptId,remainingMs:60000})});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('POST'),false);assert.equal(x.trace.includes('permission'),false);
});

test('failed readback retains candidate for GET-only recovery',async t=>{
 let fail=true;const x=setup(t,{reconcile:()=>{if(fail)throw Error('GET unavailable');}});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.known().candidateId,providerRefundId);fail=false;const before=x.calls.length;await x.dispatcher.dispatch(operationId,async()=>{throw Error('unexpected permission');});assert.equal(x.calls.length,before);
});

test('expired authorization window prevents callback and POST',async t=>{
 const x=setup(t,{authorize:({known,attemptId})=>({decision:'post',known,attemptId,remainingMs:0})});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('permission'),false);assert.equal(x.trace.includes('POST'),false);
});

test('invalid or LIVE merchant configuration is rejected before provider or storage',()=>{
 const db={transaction:async()=>{throw Error('unexpected storage');}};
 for(const patch of [{isTest:false},{shopId:''},{secretKey:'live_fixture'},{secretKey:'test_fixture\n'}])assert.throws(()=>createPrimaryRefundDispatcher(db,{...merchant,...patch},async()=>{throw Error('unexpected fetch');}));
});

test('candidate persistence failure prevents journal readback',async t=>{
 const x=setup(t,{bind:()=>{throw Error('synthetic storage failure');}});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('bind'),true);assert.equal(x.trace.includes('reconcile'),false);assert.equal(x.known().candidateId,null);
});

test('time consumed by the authorization callback cannot extend the shared POST deadline',async t=>{
 let now=performance.now();t.mock.method(performance,'now',()=>now);
 const x=setup(t,{permission:()=>{now+=36000;}});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('permission'),true);assert.equal(x.trace.includes('POST'),false);assert.equal(x.ids.size,1);
});

test('stored capture mismatch must stop before POST',async t=>{
 const x=setup(t,{paymentPatch:{captured_at:'2026-01-01T00:00:00.123457Z'}});await assert.rejects(x.dispatcher.dispatch(operationId,x.permission));assert.equal(x.trace.includes('POST'),false);assert.equal(x.ids.size,0);
});
