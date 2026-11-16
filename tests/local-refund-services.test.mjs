import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startLocalRefundServices} from '../scripts/local-refund-services.mjs';

const unavailable={message:'Local refund services unavailable'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(){
 const controller=new AbortController(),calls=[],entered=deferred(),release=deferred();
 const operator={preflight:async()=>calls.push('operator-check'),close:async()=>calls.push('operator-close')};
 const worker={preflight:async()=>calls.push('worker-check'),placement:{tick:async()=>{calls.push('tick');entered.resolve();await release.promise;return{state:'idle'};}},
  application:{sweep:async()=>{calls.push('sweep');return{processing:{state:'idle'}};}},close:async()=>calls.push('worker-close')};
 const server={socketPath:'/tmp/owned-test/operator.sock',close:async()=>{calls.push('socket-close');await operator.close();}};
 const options={signal:controller.signal,createOperator:async()=>{calls.push('operator-create');return operator;},
  createWorker:async()=>{calls.push('worker-create');return worker;},startOperatorServer:async()=>{calls.push('socket-start');return server;},
  report:async e=>calls.push('report-'+e.status)};
 return{controller,calls,entered,release,operator,worker,server,options};
}

test('local services open IPC after both admissions and drain a running tick on cached close',async()=>{
 const f=fixture(),service=await startLocalRefundServices(f.options);await f.entered.promise;
 assert.equal(service.socketPath,f.server.socketPath);
 assert.deepEqual(f.calls.slice(0,7),['operator-create','operator-check','worker-create','worker-check','socket-start','report-ready','tick']);
 const closing=service.close();assert.equal(service.close(),closing);await Promise.resolve();
 assert.ok(f.calls.includes('socket-close'));assert.equal(f.calls.includes('worker-close'),false);
 f.release.resolve();await closing;assert.equal(await service.done,0);
 for(const action of ['operator-close','worker-close','socket-close'])assert.equal(f.calls.filter(c=>c===action).length,1);
 assert.equal(f.calls.includes('sweep'),false);
});

test('startup errors close acquired resources and redact configuration, database and reporter details',async()=>{
 for(const stage of ['operator-create','operator-check','worker-create','worker-check','socket-start','report-ready']){
  const f=fixture(),fail=async()=>{throw Error('private driver credential');};
  if(stage==='operator-create')f.options.createOperator=fail;
  if(stage==='operator-check')f.operator.preflight=fail;
  if(stage==='worker-create')f.options.createWorker=fail;
  if(stage==='worker-check')f.worker.preflight=fail;
  if(stage==='socket-start')f.options.startOperatorServer=fail;
  if(stage==='report-ready')f.options.report=fail;
  await assert.rejects(startLocalRefundServices(f.options),unavailable);
  assert.equal(f.calls.includes('tick'),false);assert.equal(f.calls.includes('sweep'),false);
  assert.equal(f.calls.filter(c=>c==='operator-close').length,stage==='operator-create'?0:1);
  assert.equal(f.calls.filter(c=>c==='worker-close').length,['worker-check','socket-start','report-ready'].includes(stage)?1:0);
 }
});

test('cancellation before and during startup never advertises a socket or claims work',async()=>{
 const before=fixture();before.controller.abort();await assert.rejects(startLocalRefundServices(before.options),unavailable);assert.deepEqual(before.calls,[]);
 for(const stage of ['operator','worker','socket']){
  const f=fixture();
  if(stage==='operator')f.operator.preflight=async()=>f.controller.abort();
  if(stage==='worker')f.worker.preflight=async()=>f.controller.abort();
  if(stage==='socket')f.options.startOperatorServer=async()=>{f.controller.abort();return f.server;};
  await assert.rejects(startLocalRefundServices(f.options),unavailable);
  assert.equal(f.calls.includes('tick'),false);assert.equal(f.calls.filter(c=>c==='operator-close').length,1);
 }
});

test('worker uncertainty closes IPC and both runtimes without retrying a claim',async()=>{
 const f=fixture();f.worker.placement.tick=async()=>{f.calls.push('tick');return{state:'deferred',code:'processing_unavailable'};};
 const service=await startLocalRefundServices(f.options);assert.equal(await service.done,1);
 await assert.rejects(service.close(),unavailable);await assert.rejects(service.close(),unavailable);
 for(const action of ['tick','worker-close','socket-close','operator-close'])assert.equal(f.calls.filter(c=>c===action).length,1);
 assert.equal(f.calls.includes('sweep'),false);
});

test('external cancellation closes IPC immediately and shutdown errors are redacted',async()=>{
 const f=fixture();f.operator.close=async()=>{f.calls.push('operator-close');throw Error('private shutdown credential');};
 const service=await startLocalRefundServices(f.options);await f.entered.promise;f.controller.abort();await Promise.resolve();
 assert.ok(f.calls.includes('socket-close'));f.release.resolve();assert.equal(await service.done,1);await assert.rejects(service.close(),unavailable);
 assert.equal(f.calls.filter(c=>c==='operator-close').length,1);
});

test('cancellation awaits late operator, worker and socket handles before completing cleanup',async()=>{
 for(const stage of ['operator','worker','socket']){
  const f=fixture(),entered=deferred(),release=deferred();let settled=false;
  const key={operator:'createOperator',worker:'createWorker',socket:'startOperatorServer'}[stage],original=f.options[key];
  f.options[key]=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
  const starting=startLocalRefundServices(f.options);starting.then(()=>{settled=true;},()=>{settled=true;});
  await entered.promise;f.controller.abort();await Promise.resolve();assert.equal(settled,false);
  release.resolve();await assert.rejects(starting,unavailable);
  assert.equal(f.calls.filter(c=>c==='operator-close').length,1);assert.equal(f.calls.includes('tick'),false);
  assert.equal(f.calls.filter(c=>c==='worker-close').length,stage==='operator'?0:1);
  assert.equal(f.calls.filter(c=>c==='socket-close').length,stage==='socket'?1:0);
 }
});

test('cancellation while the ready report is pending never returns an already closed socket',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();f.options.report=async event=>{if(event.status==='ready'){entered.resolve();await release.promise;}};
 const starting=startLocalRefundServices(f.options);await entered.promise;f.controller.abort();release.resolve();
 await assert.rejects(starting,unavailable);assert.equal(f.calls.includes('tick'),false);
 for(const action of ['operator-close','worker-close','socket-close'])assert.equal(f.calls.filter(c=>c===action).length,1);
});
