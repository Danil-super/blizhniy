import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-access-services-'));
 try{
  await copyFile(new URL('../docs/review/user-access61/local-primary-services.mjs.candidate',import.meta.url),join(directory,'services.mjs'));
  const {startLocalPrimaryServices:start}=await import(pathToFileURL(join(directory,'services.mjs')));
  const calls=[],controller=new AbortController(),userDone=defer(),otherDone=defer();
  const resource=name=>({close:async()=>calls.push('close-'+name)});
  const user={...resource('user'),socketPath:'/tmp/private-user.sock',done:userDone.promise},refund={...resource('refund'),socketPath:'/tmp/private-refund.sock',done:otherDone.promise};
  const options={signal:controller.signal,createRefunds:async()=>{calls.push('refund');return refund;},createUserAccess:async()=>{calls.push('user');return user;},
   createProxy:async(refundSocket,signal,userSocket)=>{assert.equal(refundSocket,refund.socketPath);assert.equal(userSocket,user.socketPath);assert.ok(signal instanceof AbortSignal);calls.push('proxy');return resource('proxy');},
   startApplication:async(_signal,socket)=>{assert.equal(socket,user.socketPath);calls.push('app');return{...resource('app'),done:otherDone.promise};},
   startExpiry:async()=>{calls.push('expiry');return resource('expiry');},onReady:async()=>calls.push('ready')};
  await run({start,options,calls,controller,userDone,user});
 }finally{await rm(directory,{recursive:true,force:true});}
}
test('candidate orchestration starts the isolated operator before ingress and closes it exactly once first',async()=>fixture(async f=>{
 const service=await f.start(f.options);assert.deepEqual(f.calls,['refund','user','proxy','app','expiry','ready']);
 const closing=service.close();assert.equal(service.close(),closing);await closing;assert.equal(await service.done,0);
 assert.deepEqual(f.calls.slice(6),['close-user','close-refund','close-app','close-expiry','close-proxy']);
}));
test('candidate orchestration closes a late operator after startup cancellation without starting ingress',async()=>fixture(async f=>{
 const entered=defer(),release=defer();f.options.createUserAccess=async()=>{entered.resolve();await release.promise;return f.user;};
 const starting=f.start(f.options);await entered.promise;f.controller.abort();release.resolve();await assert.rejects(starting,{message:'Local primary services unavailable'});
 assert.deepEqual(f.calls,['refund','close-user','close-refund']);
}));
test('candidate orchestration treats even a clean unexpected operator exit as a service failure',async()=>fixture(async f=>{
 const service=await f.start(f.options);f.userDone.resolve(0);assert.equal(await service.done,1);await assert.rejects(service.close());
 assert.deepEqual(f.calls.slice(6),['close-user','close-refund','close-app','close-expiry','close-proxy']);
}));
