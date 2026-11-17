import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {parseAdminUserAccessCommand,parseAdminUserAccessResult} from '../src/lib/admin-user-access-contract.ts';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const command={action:'change',expectedAdminId:actor,input:{id,targetId:target,expectedVersion:'0',role:'user',isBlocked:true,reason:'Нарушение правил'}};
const receipt={id,actorId:actor,targetId:target,expectedVersion:'0',previousRole:'user',role:'user',previousBlocked:false,isBlocked:true,resultingVersion:'1',reason:command.input.reason,changed:true,createdAt:'2026-11-17T12:00:00.123456Z'};
const result={user:{id:target,role:'user',isBlocked:true,emailVerified:true,authVersion:'1'},receipt,history:[receipt]};
test('access commands are exact, preserve zero versions and bound reasons without accepting client authority',()=>{
  assert.deepEqual(parseAdminUserAccessCommand(command),command);
  const inspect={action:'inspect',expectedAdminId:actor,targetId:target};assert.deepEqual(parseAdminUserAccessCommand(inspect),inspect);
  for(const value of [{...inspect,role:'admin'},{...command,token:'secret'},{...command,input:{...command.input,role:'specialist'}},
    {...command,input:{...command.input,expectedVersion:'00'}},{...command,input:{...command.input,expectedVersion:'9223372036854775808'}},
    ...['ab','x'.repeat(501),'bad\nreason','<script>bad</script>'].map(reason=>({...command,input:{...command.input,reason}}))])assert.throws(()=>parseAdminUserAccessCommand(value));
  assert.equal(parseAdminUserAccessCommand({...command,input:{...command.input,reason:'  Причина  '}}).input.reason,'Причина');
});
test('access results bind the receipt to the intent, reject private data and permit historical replay with current state',()=>{
  assert.deepEqual(parseAdminUserAccessResult(command,result),result);
  assert.deepEqual(parseAdminUserAccessResult(command,{...result,user:{...result.user,isBlocked:false,authVersion:'2'}}).receipt,receipt);
  for(const patch of [{actorId:target},{targetId:actor},{expectedVersion:'1'},{role:'admin'},{reason:'Иная причина'},{changed:false},{resultingVersion:'2'}])
    assert.throws(()=>parseAdminUserAccessResult(command,{...result,receipt:{...receipt,...patch}}));
  for(const value of [{...result,password_hash:'private'},{...result,user:{...result.user,token_hash:'private'}},{...result,history:[receipt,receipt]},
    {...result,user:{...result.user,id:actor}},{...result,user:{...result.user,authVersion:'0'}}])assert.throws(()=>parseAdminUserAccessResult(command,value));
});
test('operator adapter hashes the cookie, performs one statement and maps only known SQLSTATE without raw details',async()=>{
  const {PostgresAdminUserAccess}=load('postgres-admin-user-access'),calls=[];let failure;
  const store=new PostgresAdminUserAccess({query:async(...args)=>{calls.push(args);if(failure)throw failure;return {rows:[{result}]};}});
  assert.deepEqual(await store.execute('a'.repeat(64),command),result);assert.equal(calls.length,1);assert.equal(calls[0][1][0].length,64);assert.notEqual(calls[0][1][0],'a'.repeat(64));
  assert.deepEqual(calls[0][1].slice(1),[actor,'change',target,id,'0','user',true,command.input.reason]);
  await assert.rejects(store.execute('bad',command),error=>error.code==='ADMIN_REQUIRED');assert.equal(calls.length,1);
  for(const [sql,code] of [['PUA01','ADMIN_REQUIRED'],['PUA02','OPERATION_CONFLICT'],['PUA03','STALE_ACCESS'],['PUA04','LAST_ADMIN'],['PUA05','SELF_CHANGE'],['PUA06','USER_UNAVAILABLE'],['PUA07','USER_NOT_READY'],['55P03','ACCESS_BUSY'],['private-code','ACCESS_UNAVAILABLE']]){
    failure={code:sql,message:'private-database-host'};const before=calls.length;
    await assert.rejects(store.execute('a'.repeat(64),command),error=>error.code===code&&!error.message.includes('private'));assert.equal(calls.length,before+1);
  }
});
test('recovery accepts an absent receipt and binds found receipts without resending a change',()=>{
  const recover={action:'recover',expectedAdminId:actor,targetId:target,id};
  assert.deepEqual(parseAdminUserAccessCommand(recover),recover);
  assert.equal(parseAdminUserAccessResult(recover,{...result,receipt:null}).receipt,null);
  assert.deepEqual(parseAdminUserAccessResult(recover,result).receipt,receipt);
  assert.throws(()=>parseAdminUserAccessResult({...recover,id:target},result));
  assert.throws(()=>parseAdminUserAccessCommand({...recover,role:'admin'}));
});
