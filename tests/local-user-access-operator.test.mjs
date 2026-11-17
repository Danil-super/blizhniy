import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {lstat,chmod,mkdtemp,readdir,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {startLocalUserAccessOperator} from '../scripts/local-user-access-operator.mjs';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {callLocalUserAccessOperator}=load('local-user-access-operator-client'),{AdminUserAccessError}=load('admin-user-access-contract');
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
const command={action:'inspect',expectedAdminId:actor,targetId:target},result={user:{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'},receipt:null,history:[]};
test('private operator uses owned 0700/0600 Unix IPC, validates payloads, redacts errors and closes exactly once',async()=>{
  let calls=0,closed=0,failure;const server=await startLocalUserAccessOperator({execute:async(token,input)=>{
    calls++;assert.equal(token,'a'.repeat(64));assert.deepEqual(input,command);if(failure)throw failure;return result;
  },close:async()=>{closed++;}});
  try{
    assert.equal((await lstat(dirname(server.socketPath))).mode&0o777,0o700);assert.equal((await lstat(server.socketPath)).mode&0o777,0o600);
    assert.deepEqual(await callLocalUserAccessOperator(server.socketPath,'a'.repeat(64),command),result);assert.equal(calls,1);
    failure=new AdminUserAccessError('SELF_CHANGE');await assert.rejects(callLocalUserAccessOperator(server.socketPath,'a'.repeat(64),command),error=>error.code==='SELF_CHANGE');
    failure=Error('private-db-host');await assert.rejects(callLocalUserAccessOperator(server.socketPath,'a'.repeat(64),command),error=>error.code==='ACCESS_UNAVAILABLE'&&!error.message.includes('private'));
    const before=calls;await chmod(server.socketPath,0o666);
    await assert.rejects(callLocalUserAccessOperator(server.socketPath,'a'.repeat(64),command));assert.equal(calls,before);await chmod(server.socketPath,0o600);
    await assert.rejects(callLocalUserAccessOperator(server.socketPath,'bad',command));assert.equal(calls,before);
  }finally{await server.close();await server.close();}
  assert.equal(closed,1);await assert.rejects(lstat(dirname(server.socketPath)),{code:'ENOENT'});
  assert.equal(await server.done,0);
});
test('client disconnect aborts the private runtime signal before deferred dispatch',async()=>{
  let enter,release,signalSeen;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});let closed=0;
  const server=await startLocalUserAccessOperator({execute:async(_token,_command,signal)=>{signalSeen=signal;enter();await gate;return result;},close:async()=>{closed++;}});
  try{
    const controller=new AbortController(),pending=callLocalUserAccessOperator(server.socketPath,'a'.repeat(64),command,controller.signal);
    const rejected=assert.rejects(pending);await entered;controller.abort();await rejected;
    await new Promise((resolve,reject)=>{if(signalSeen.aborted){resolve();return;}const timer=setTimeout(()=>reject(Error('Runtime abort not delivered')),3000);signalSeen.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
  }finally{release();await server.close();}assert.equal(closed,1);
});
test('failed startup closes its initialized runtime and removes its directory even if close throws',async()=>{
  const owned=await mkdtemp(join(tmpdir(),'blizhniy-user-access-long-'+'x'.repeat(80))),previous=process.env.TMPDIR;
  try{
    process.env.TMPDIR=owned;
    for(const fails of [false,true]){
      let closed=0;
      await assert.rejects(startLocalUserAccessOperator({execute:async()=>result,close:async()=>{closed++;if(fails)throw Error('private-connection-failure');}}),error=>error.message==='User access operator unavailable');
      assert.equal(closed,1);assert.deepEqual(await readdir(owned),[]);
    }
  }finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;await rm(owned,{recursive:true,force:true});}
});
