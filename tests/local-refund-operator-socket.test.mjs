import assert from 'node:assert/strict';
import {test} from 'node:test';
import {request} from 'node:http';
import {chmod,lstat} from 'node:fs/promises';
import {startLocalRefundOperatorServer} from '../scripts/local-refund-operator-server.mjs';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {createAdminRefundCommands}=load('admin-refund-commands'),{callLocalRefundOperator}=load('local-refund-operator-client');
const token='a'.repeat(64),actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const command={action:'approve',expectedAdminId:actor,input:{id,paymentIntentId:id,reason:'Возврат по обращению.'}};
function runtime(){const calls=[];return{calls,listForAdmin:async(...args)=>{calls.push(['list',...args]);return{items:[],nextAfter:null};},
 approve:async(...args)=>{calls.push(['approve',...args]);return{...args[2],amount:'199.00',approvedAt:'2026-11-12T10:00:00.123456Z',requestBody:'must-not-leak',approvedBy:actor};},
 readForAdmin:async()=>{throw Error('private read error');},recover:async()=>{throw Error('private provider error');},close:async()=>{calls.push(['close']);}};}
function raw(socketPath,{method='POST',path='/command',headers={},body='{}'}={}){return new Promise((resolve,reject)=>{
 const req=request({socketPath,hostname:'refund-operator.invalid',method,path,headers:{'content-type':'application/json',...headers},agent:false},res=>{
  const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString(),headers:res.headers}));res.on('error',reject);
 });req.on('error',reject);req.end(body);
});}
test('private operator socket uses owned restrictive files and exposes only bounded projected commands',async()=>{
 const state=runtime(),service=await startLocalRefundOperatorServer(state,{createCommands:createAdminRefundCommands});
 try{
  const socket=await lstat(service.socketPath),parent=await lstat(new URL('.', 'file://'+service.socketPath));
  assert.equal(socket.isSocket(),true);assert.equal(socket.mode&0o777,0o600);assert.equal(parent.mode&0o777,0o700);assert.equal(socket.uid,process.getuid());assert.equal(state.calls.length,0);
  const result=await callLocalRefundOperator(service.socketPath,token,command);assert.equal(result.id,id);assert.equal(Object.hasOwn(result,'requestBody'),false);assert.equal(Object.hasOwn(result,'approvedBy'),false);
  assert.equal(state.calls.filter(c=>c[0]==='approve').length,1);assert.equal(state.calls[0][1],token);
  await chmod(service.socketPath,0o660);await assert.rejects(callLocalRefundOperator(service.socketPath,token,command));await chmod(service.socketPath,0o600);
  const directory=new URL('.', 'file://'+service.socketPath);await chmod(directory,0o750);await assert.rejects(callLocalRefundOperator(service.socketPath,token,command));await chmod(directory,0o700);assert.equal(state.calls.filter(c=>c[0]==='approve').length,1);
  assert.deepEqual(await callLocalRefundOperator(service.socketPath,token,{action:'list',expectedAdminId:actor,input:null}),{items:[],nextAfter:null});
  const error=await raw(service.socketPath,{body:JSON.stringify({token,command:{action:'read',expectedAdminId:actor,input:id}})});assert.equal(error.status,503);assert.equal(error.text.includes('private'),false);assert.equal(error.headers['cache-control'],'no-store');
 }finally{await service.close();await service.close();}
 assert.equal(state.calls.filter(c=>c[0]==='close').length,1);await assert.rejects(lstat(service.socketPath));
});
test('socket rejects unsupported routes, browser origins, malformed/oversize envelopes and sender commands without work',async()=>{
 const state=runtime(),service=await startLocalRefundOperatorServer(state,{createCommands:createAdminRefundCommands});
 try{
  for(const options of [{method:'GET'},{path:'/command?sql=1'},{headers:{origin:'https://foreign.invalid'}},{headers:{'content-type':'text/plain'}},{body:'{invalid'},
   {body:'x'.repeat(4097)},{body:JSON.stringify({token,command:{...command,action:'send'}})},{body:JSON.stringify({token,command,sql:'select 1'})}]){
   const result=await raw(service.socketPath,options);assert.ok(result.status>=400);assert.equal(result.text.includes(token),false);
  }
  assert.equal(state.calls.length,0);
  await assert.rejects(callLocalRefundOperator('/tmp/foreign.sock',token,command));
  const aborted=new AbortController();aborted.abort();await assert.rejects(callLocalRefundOperator(service.socketPath,token,command,aborted.signal));assert.equal(state.calls.length,0);
 }finally{await service.close();}
});
test('socket shutdown drains a running command, never retries and redacts driver close errors',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),state=runtime(),original=state.approve;
 state.approve=async(...args)=>{enter();await gate;return original(...args);};state.close=async()=>{state.calls.push(['close']);throw Error('private shutdown error');};
 const service=await startLocalRefundOperatorServer(state,{createCommands:createAdminRefundCommands});
 const work=callLocalRefundOperator(service.socketPath,token,command);await entered;const closing=service.close();assert.equal(state.calls.length,0);release();
 assert.equal((await work).id,id);await assert.rejects(closing,{message:'Local refund operator unavailable'});await assert.rejects(service.close());
 assert.equal(state.calls.filter(c=>c[0]==='approve').length,1);assert.equal(state.calls.filter(c=>c[0]==='close').length,1);await assert.rejects(lstat(service.socketPath));
});
test('a definite approval rejection crosses private IPC without exposing SQL or treating readback as failed',async()=>{
 const state=runtime();state.approve=async()=>{throw Object.assign(Error('private SQL detail'),{code:'REFUND_NOT_LATEST'});};state.readForAdmin=state.approve;
 const service=await startLocalRefundOperatorServer(state,{createCommands:createAdminRefundCommands});
 try{
  await assert.rejects(callLocalRefundOperator(service.socketPath,token,command),error=>error.name==='AdminRefundRejectedError'&&!error.message.includes('private'));
  const result=await raw(service.socketPath,{body:JSON.stringify({token,command})});assert.equal(result.status,409);assert.equal(result.text,'{"error":{"code":"REFUND_NOT_LATEST"}}');
  await assert.rejects(callLocalRefundOperator(service.socketPath,token,{action:'read',expectedAdminId:actor,input:id}),{message:'Local refund operator unavailable'});
 }finally{await service.close();}
});
