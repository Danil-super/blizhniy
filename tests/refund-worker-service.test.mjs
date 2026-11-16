import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runRefundWorkerService} from '../scripts/refund-worker-service.mjs';

function fixture(){
 const controller=new AbortController(),events=[],calls=[],pauses=[];
 const runtime={preflight:async()=>calls.push('check'),placement:{tick:async()=>{calls.push('placement');return{state:'idle'};}},
  application:{sweep:async()=>{calls.push('application');controller.abort();return{discovery:{state:'scanned'},processing:{state:'completed'}};}},
  close:async()=>calls.push('close')};
 const run=options=>runRefundWorkerService({mode:'run',signal:controller.signal,createRuntime:async()=>runtime,
  report:async event=>events.push(event),wait:async ms=>pauses.push(ms),...options});
 return{controller,events,calls,pauses,runtime,run};
}

test('refund check performs admission without discovery, claim or provider mutations; invalid options never allocate a runtime',async()=>{
 const f=fixture();assert.equal(await f.run({mode:'check'}),0);assert.deepEqual(f.calls,['check','close']);
 assert.equal(f.events.at(-1).status,'checked');
 for(const options of [{mode:undefined},{mode:'live'},{signal:{}},{createRuntime:null},{report:null},{wait:null}]){
  const f=fixture();assert.equal(await f.run(options),1);assert.deepEqual(f.calls,[]);
 }
});

test('refund loop serially alternates both consumers, observes pacing and excludes private data from reports',async()=>{
 const f=fixture();let count=0;
 f.runtime.application.sweep=async()=>{f.calls.push('application');if(++count===2)f.controller.abort();
  return{discovery:{private:'secret'},processing:count===1?{state:'deferred',code:'provider_pending',secret:'private'}:{state:'completed',id:'private'}};};
 assert.equal(await f.run(),0);assert.deepEqual(f.calls,['check','placement','application','placement','application','close']);
 assert.deepEqual(f.pauses,[5000,250,5000]);
 assert.deepEqual(f.events.filter(e=>e.status==='tick').map(e=>e.kind),['placement','application','placement','application']);
 assert.equal(JSON.stringify(f.events).includes('private'),false);assert.equal(JSON.stringify(f.events).includes('secret'),false);
 assert.equal(new Set(f.events.map(e=>e.runId)).size,1);
});

test('abort drains the current financial tick and closes once without starting the other consumer',async()=>{
 const f=fixture();let enter,release;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.runtime.placement.tick=async()=>{f.calls.push('placement');enter();await gate;return{state:'completed'};};
 const running=f.run();await entered;f.controller.abort();await Promise.resolve();assert.deepEqual(f.calls,['check','placement']);
 release();assert.equal(await running,0);assert.deepEqual(f.calls,['check','placement','close']);
 const before=fixture();before.controller.abort();assert.equal(await before.run(),0);assert.deepEqual(before.calls,[]);
 const during=fixture();during.runtime.preflight=async()=>{during.calls.push('check');during.controller.abort();};
 assert.equal(await during.run(),0);assert.deepEqual(during.calls,['check','close']);
});

test('unknown COMMIT, invalid results and a broken report stop the loop without replay or starting another consumer',async()=>{
 for(const result of [new Error('private database key'),null,{state:'private'},{state:'blocked',code:'private'},{state:'completed',code:'source_unavailable'}]){
  const f=fixture();f.runtime.placement.tick=async()=>{f.calls.push('placement');if(result instanceof Error)throw result;return result;};
  assert.equal(await f.run(),1);assert.deepEqual(f.calls,['check','placement','close']);
  assert.equal(JSON.stringify(f.events).includes('private'),false);
 }
 const f=fixture();let writes=0;
 assert.equal(await f.run({report:async()=>{writes++;throw Error('private output');}}),1);
 assert.deepEqual(f.calls,['check','close']);assert.equal(writes,1);
 const uncertain=fixture();uncertain.runtime.placement.tick=async()=>{uncertain.calls.push('placement');return{state:'deferred',code:'processing_unavailable'};};
 assert.equal(await uncertain.run(),1);assert.deepEqual(uncertain.calls,['check','placement','close']);
 assert.equal(uncertain.events.at(-1).failureStage,'delivery');
});

test('service preserves preflight, wait and shutdown failures and stops real abortable idle waits',async()=>{
 for(const stage of ['preflight','wait','shutdown']){
  const f=fixture();if(stage==='preflight')f.runtime.preflight=async()=>{throw Error('private');};
  if(stage==='shutdown')f.runtime.close=async()=>{throw Error('private');};
  assert.equal(await f.run(stage==='wait'?{wait:async()=>{throw Error('private');}}:{}),1);
  assert.equal(f.events.at(-1).failureStage,stage);assert.equal(JSON.stringify(f.events).includes('private'),false);
 }
 const f=fixture();f.runtime.placement.tick=async()=>{f.calls.push('placement');setTimeout(()=>f.controller.abort(),10);return{state:'idle'};};
 const start=performance.now();assert.equal(await f.run({wait:undefined}),0);assert.ok(performance.now()-start<1000);
 assert.deepEqual(f.calls,['check','placement','close']);
});
