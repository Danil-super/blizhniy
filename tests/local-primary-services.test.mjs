import assert from 'node:assert/strict';import {test} from 'node:test';
import {startLocalPrimaryServices} from '../scripts/local-primary-services.mjs';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(){
 const calls=[],controller=new AbortController(),refundDone=defer(),appDone=defer();
 const handle=name=>({close:async()=>calls.push('close-'+name)});
 const refund={...handle('refund'),socketPath:'/tmp/private.sock',done:refundDone.promise},proxy=handle('proxy'),app={...handle('app'),done:appDone.promise},expiry=handle('expiry');
 const options={signal:controller.signal,createRefunds:async()=>{calls.push('refund');return refund;},createProxy:async socket=>{calls.push('proxy');assert.equal(socket,refund.socketPath);return proxy;},
  startApplication:async()=>{calls.push('app');return app;},startExpiry:async()=>{calls.push('expiry');return expiry;},onReady:async()=>calls.push('ready')};
 return{calls,controller,refundDone,appDone,refund,proxy,app,expiry,options};
}
test('local startup wires the socket before the app and caches ordered complete shutdown',async()=>{
 const f=fixture(),service=await startLocalPrimaryServices(f.options);assert.deepEqual(f.calls,['refund','proxy','app','expiry','ready']);
 const closing=service.close();assert.equal(service.close(),closing);await closing;assert.equal(await service.done,0);
 assert.deepEqual(f.calls.slice(5),['close-refund','close-app','close-expiry','close-proxy']);
});
test('late resources after cancellation are closed and no later startup step runs',async()=>{
 for(const key of ['createRefunds','createProxy','startApplication','startExpiry','onReady']){
  const f=fixture(),entered=defer(),release=defer(),original=f.options[key];
  f.options[key]=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
  const starting=startLocalPrimaryServices(f.options);await entered.promise;f.controller.abort();release.resolve();
  await assert.rejects(starting,{message:'Local primary services unavailable'});
  assert.equal(f.calls.filter(c=>c==='close-refund').length,1);
  if(key==='createProxy')assert.equal(f.calls.includes('app'),false);
 }
});
test('refund failure during pending proxy startup cannot resume into starting Next',async()=>{
 const f=fixture(),entered=defer(),release=defer();f.options.createProxy=async()=>{entered.resolve();await release.promise;return f.proxy;};
 const starting=startLocalPrimaryServices(f.options);await entered.promise;f.refundDone.resolve(1);await Promise.resolve();release.resolve();
 await assert.rejects(starting,{message:'Local primary services unavailable'});assert.equal(f.calls.includes('app'),false);assert.ok(f.calls.includes('close-proxy'));
});
test('every acquired resource closes even when startup or an earlier close fails',async()=>{
 const f=fixture();f.options.onReady=async()=>{throw Error('private configuration');};f.refund.close=async()=>{f.calls.push('close-refund');throw Error('private driver');};
 await assert.rejects(startLocalPrimaryServices(f.options),{message:'Local primary services unavailable'});
 assert.deepEqual(f.calls.slice(-4),['close-refund','close-app','close-expiry','close-proxy']);
});
test('unexpected app or worker exit closes ingress, while base startup needs no refund configuration',async()=>{
 for(const name of ['refundDone','appDone']){const f=fixture(),service=await startLocalPrimaryServices(f.options);f[name].resolve(1);assert.equal(await service.done,1);await assert.rejects(service.close());assert.ok(f.calls.includes('close-proxy'));}
 const f=fixture();delete f.options.createRefunds;f.options.createProxy=async socket=>{assert.equal(socket,undefined);return f.proxy;};const service=await startLocalPrimaryServices(f.options);await service.close();assert.equal(f.calls.includes('refund'),false);
});
