import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const claim={intentId:'11111111-1111-4111-8111-111111111111',claimId:'22222222-2222-4222-8222-222222222222',attempts:1};
function fixture(overrides={}){
 const calls=[],queue={claim:async()=>claim,owns:async()=>true,finish:async(...args)=>{calls.push(['finish',...args]);return true;},...overrides.queue};
 const verifier={reconcile:async id=>{calls.push(['GET',id]);return{orderStatus:'succeeded',capturedAt:'2026-10-19T12:00:00.123456Z'};},...overrides.verifier};
 const fulfillment={fulfill:async id=>{calls.push(['fulfill',id]);return{state:'fulfilled'};},...overrides.fulfillment};
 const exports={},deps={'./postgres-payment-reconciliation.ts':{PostgresPaymentReconciliationQueue:class{constructor(){return queue;}}},'./postgres-payment-verification.ts':{PostgresPaymentVerificationStore:class{constructor(){return verifier;}}},'./postgres-listing-payment-fulfillment':{PostgresListingPaymentFulfillmentStore:class{constructor(){return fulfillment;}}}};
 new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/payment-reconciliation-worker.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(path=>{if(!Object.hasOwn(deps,path))throw Error('Unapproved worker dependency');return deps[path];},exports);
 return{worker:exports.createPaymentReconciliationWorker({},{}),calls};
}
test('worker requires a live claim before GET and before fulfillment; no browser JSON supplies financial state',async()=>{
 const success=fixture();assert.deepEqual(await success.worker.tick(),{state:'completed'});assert.deepEqual(success.calls.map(row=>row[0]),['GET','fulfill','finish']);
 const lost=fixture({queue:{owns:async()=>false}});assert.deepEqual(await lost.worker.tick(),{state:'lost'});assert.deepEqual(lost.calls,[]);
 let checks=0;const expired=fixture({queue:{owns:async()=>++checks===1}});assert.deepEqual(await expired.worker.tick(),{state:'lost'});assert.deepEqual(expired.calls.map(row=>row[0]),['GET']);
});
test('worker defers pending/missing capture, records publication blocks, completes cancellation without fulfillment and never retries claim failures internally',async()=>{
 for(const [state,capturedAt,reason] of [['pending',null,'provider_pending'],['succeeded',null,'capture_required']]){
  const f=fixture({verifier:{reconcile:async()=>({orderStatus:state,capturedAt})}});assert.deepEqual(await f.worker.tick(),{state:'deferred',code:reason});assert.equal(f.calls[0][2],'retry');assert.equal(f.calls[0][3],reason);
 }
 const canceled=fixture({verifier:{reconcile:async()=>({orderStatus:'failed',capturedAt:null})}});assert.deepEqual(await canceled.worker.tick(),{state:'completed'});assert.deepEqual(canceled.calls.map(row=>row[0]),['finish']);
 const blocked=fixture({fulfillment:{fulfill:async()=>({state:'blocked'})}});assert.deepEqual(await blocked.worker.tick(),{state:'blocked',code:'publication_blocked'});
 const error=fixture({verifier:{reconcile:async()=>{throw Error('private payload');}}});assert.deepEqual(await error.worker.tick(),{state:'deferred',code:'processing_unavailable'});assert.equal(JSON.stringify(error.calls).includes('private'),false);
 const exhausted=fixture({queue:{claim:async()=>({...claim,attempts:12})},verifier:{reconcile:async()=>({orderStatus:'pending',capturedAt:null})}});assert.deepEqual(await exhausted.worker.tick(),{state:'blocked',code:'attempts_exhausted'});
 let claims=0;const unknown=fixture({queue:{claim:async()=>{claims++;throw Error('Synthetic lost claim COMMIT');}}});await assert.rejects(unknown.worker.tick(),/Synthetic lost/);assert.equal(claims,1);
});
test('worker does not blindly acknowledge after a lost lease or unknown completion COMMIT',async()=>{
 const stale=fixture({queue:{finish:async()=>false}});assert.deepEqual(await stale.worker.tick(),{state:'lost'});
 let finishes=0;const unknown=fixture({queue:{finish:async()=>{finishes++;throw Error('Synthetic lost finish COMMIT');}}});await assert.rejects(unknown.worker.tick(),/Synthetic lost finish/);assert.equal(finishes,1);
});
