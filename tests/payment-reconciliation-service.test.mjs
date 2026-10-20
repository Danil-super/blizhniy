import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runPaymentReconciliationService,runPaymentReconciliationProcess} from '../scripts/payment-reconciliation-service.mjs';

function fixture(changes={}) {
 const controller=new AbortController(), events=[], pauses=[];
 const calls={created:0,preflight:0,tick:0,close:0};
 const runtime={
  preflight:async()=>{calls.preflight++;},
  worker:{tick:async()=>{calls.tick++;controller.abort();return{state:'completed',id:'private-payment-id'};}},
  close:async()=>{calls.close++;},...changes,
 };
 const run=options=>runPaymentReconciliationService({mode:'run',signal:controller.signal,
  createRuntime:async()=>{calls.created++;return runtime;},report:async event=>{events.push(event);},
  wait:async ms=>{pauses.push(ms);},...options});
 return{controller,calls,runtime,events,pauses,run};
}

test('check is read-only orchestration: preflight and close without any claim; missing/invalid mode refuses before creating a runtime',async()=>{
 const f=fixture();assert.equal(await f.run({mode:'check'}),0);
 assert.deepEqual(f.calls,{created:1,preflight:1,tick:0,close:1});
 assert.equal(f.events.at(-1).status,'checked');
 for(const mode of [undefined,'live','RUN']){
  const invalid=fixture();assert.equal(await invalid.run({mode}),1);assert.equal(invalid.calls.created,0);
  assert.equal(invalid.events.at(-1).failureStage,'configuration');
 }
 const entry=fixture();assert.equal(await entry.run({entryPoint:'synthetic-private-entry'}),1);
 assert.equal(entry.calls.created,0);assert.equal(JSON.stringify(entry.events).includes('synthetic-private-entry'),false);
});

test('service awaits preflight and each task, applies fixed pacing, and emits only bounded result fields',async()=>{
 const f=fixture(),outcomes=[{state:'idle'},{state:'deferred',code:'provider_pending',secret:'private'},
  {state:'blocked',code:'publication_blocked'},{state:'lost'},{state:'completed'}];
 let active=0,maxActive=0;
 f.runtime.worker.tick=async()=>{
  active++;maxActive=Math.max(maxActive,active);f.calls.tick++;
  await Promise.resolve();active--;const result=outcomes.shift();if(!outcomes.length)f.controller.abort();return result;
 };
 assert.equal(await f.run({entryPoint:'service'}),0);assert.equal(maxActive,1);
 assert.deepEqual(f.pauses,[5000,250,250,250]);assert.equal(f.calls.tick,5);assert.equal(f.calls.close,1);
 const ticks=f.events.filter(event=>event.status==='tick');
 assert.deepEqual(ticks.map(event=>event.state),['idle','deferred','blocked','lost','completed']);
 assert.equal(new Set(f.events.map(event=>event.runId)).size,1);
 assert.equal(f.events.every(event=>event.entryPoint==='service'&&Number.isFinite(event.durationMs)),true);
 assert.equal(JSON.stringify(f.events).includes('private'),false);
 assert.deepEqual(f.events.at(-1).outcomes,{idle:1,deferred:1,blocked:1,lost:1,completed:1});
});

test('stop before startup does not acquire resources; stop during startup still closes without claiming',async()=>{
 const before=fixture();before.controller.abort();assert.equal(await before.run(),0);assert.equal(before.calls.created,0);
 const during=fixture();during.runtime.preflight=async()=>{during.calls.preflight++;during.controller.abort();};
 assert.equal(await during.run(),0);assert.equal(during.calls.tick,0);assert.equal(during.calls.close,1);
 assert.equal(during.events.at(-1).status,'stopped');
});

test('abort drains an in-flight task and closes exactly once without interrupting or acknowledging it itself',async()=>{
 const f=fixture();let release,entered;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.runtime.worker.tick=async()=>{f.calls.tick++;entered();await gate;return{state:'deferred',code:'capture_required'};};
 const running=f.run();await started;f.controller.abort();await Promise.resolve();
 assert.equal(f.calls.close,0);assert.equal(f.calls.tick,1);release();
 assert.equal(await running,0);assert.equal(f.calls.close,1);assert.equal(f.calls.tick,1);
 assert.deepEqual(f.events.at(-1).outcomes,{deferred:1});
});

test('unknown tick COMMIT stops the process loop: no internal retry; startup, preflight, wait and close errors are generic',async()=>{
 const privateError=new Error('synthetic-password recipient@example.invalid provider-private-id');
 for(const stage of ['configuration','preflight','delivery','wait','shutdown']){
  const f=fixture();
  if(stage==='preflight')f.runtime.preflight=async()=>{throw privateError;};
  if(stage==='delivery')f.runtime.worker.tick=async()=>{f.calls.tick++;throw privateError;};
  if(stage==='wait')f.runtime.worker.tick=async()=>{f.calls.tick++;return{state:'idle'};};
  if(stage==='shutdown')f.runtime.close=async()=>{f.calls.close++;throw privateError;};
  assert.equal(await f.run({...(stage==='configuration'?{createRuntime:async()=>{throw privateError;}}:{}),
   ...(stage==='wait'?{wait:async()=>{throw privateError;}}:{})}),1);
  assert.equal(f.events.at(-1).failureStage,stage);assert.equal(f.events.at(-1).status,'unavailable');
  assert.equal(f.calls.tick,stage==='configuration'||stage==='preflight'?0:1);
  assert.equal(f.calls.close,stage==='configuration'?0:1);
  assert.equal(JSON.stringify(f.events).includes(privateError.message),false);
 }
});

test('malformed tick outcomes fail closed and cannot leak arbitrary status or code into telemetry',async()=>{
 for(const result of [null,{state:'private-state'},{state:'blocked',code:'private-code'},{state:'deferred'},{state:'completed',code:'private-code'}]){
  const f=fixture();f.runtime.worker.tick=async()=>{f.calls.tick++;return result;};
  assert.equal(await f.run(),1);assert.equal(f.calls.tick,1);assert.equal(f.calls.close,1);
  assert.equal(f.events.at(-1).failureStage,'delivery');assert.equal(JSON.stringify(f.events).includes('private-'),false);
 }
});

test('telemetry backpressure is awaited before claiming and a broken sink stops safely without retrying its failed write',async()=>{
 const f=fixture();let release,entered,writes=0;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const running=f.run({report:async event=>{writes++;if(event.status==='ready'){entered();await gate;throw Error('private-log-error');}}});
 await started;assert.equal(f.calls.tick,0);release();assert.equal(await running,1);
 assert.equal(f.calls.close,1);assert.equal(f.calls.tick,0);assert.equal(writes,1);
});

test('a real abortable idle timer stops promptly and does not leave a pool or active timer behind',async()=>{
 const f=fixture();f.runtime.worker.tick=async()=>{f.calls.tick++;setTimeout(()=>f.controller.abort(),10);return{state:'idle'};};
 const started=performance.now();assert.equal(await f.run({wait:undefined}),0);
 assert.ok(performance.now()-started<1000);assert.equal(f.calls.tick,1);assert.equal(f.calls.close,1);
});

test('startup cannot race the first claim; cancellation during factory or preflight closes its acquired runtime',async()=>{
 const factory=fixture();assert.equal(await factory.run({createRuntime:async()=>{factory.controller.abort();return factory.runtime;}}),0);
 assert.equal(factory.calls.preflight,0);assert.equal(factory.calls.tick,0);assert.equal(factory.calls.close,1);
 const f=fixture();let release,entered;
 const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.runtime.preflight=async()=>{entered();await gate;};
 const running=f.run();await started;assert.equal(f.calls.tick,0);f.controller.abort();release();
 assert.equal(await running,0);assert.equal(f.calls.tick,0);assert.equal(f.calls.close,1);
 assert.equal(f.events.some(event=>event.status==='ready'),false);
});

test('invalid dependencies or incomplete runtimes fail before work; process adapter removes all listeners on success and failure',async()=>{
 for(const options of [{signal:{}},{wait:null},{createRuntime:null},{report:null}]){
  const f=fixture();assert.equal(await f.run(options),1);assert.equal(f.calls.created,0);
 }
 const malformed=fixture({preflight:null});assert.equal(await malformed.run(),1);
 assert.equal(malformed.calls.tick,0);assert.equal(malformed.calls.close,1);
 const count=()=>[process.listenerCount('SIGTERM'),process.listenerCount('SIGINT'),process.stdout.listenerCount('error')];
 const before=count();
 for(const failed of [false,true]){
  let closed=0;
  assert.equal(await runPaymentReconciliationProcess({mode:'check',report:async()=>{},createRuntime:async()=>({
   preflight:async()=>{if(failed)throw Error('synthetic-private-preflight');},worker:{tick:async()=>assert.fail('Read-only check cannot claim')},
   close:async()=>{closed++;},
  })}),failed?1:0);
  assert.equal(closed,1);assert.deepEqual(count(),before);
 }
});
