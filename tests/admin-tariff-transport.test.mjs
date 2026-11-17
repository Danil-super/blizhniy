import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {startLocalAdminOperator} from '../scripts/local-admin-operator.mjs';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const actor='11111111-1111-4111-8111-111111111111',token='a'.repeat(64),command={resource:'tariffs',action:'list',expectedAdminId:actor},result={tariffs:[],receipt:null,history:[]};
test('shared private operator carries tariff commands without accepting mismatched shapes or exposing raw failures',async()=>{
 const {callLocalTariffOperator}=load('local-user-access-operator-client'),{AdminTariffError}=load('admin-tariff-contract');let calls=0,failure;
 const server=await startLocalAdminOperator({execute:async(t,input)=>{calls++;assert.equal(t,token);assert.deepEqual(input,command);if(failure)throw failure;return result;},close:async()=>{}});
 try{
  assert.deepEqual(await callLocalTariffOperator(server.socketPath,token,command),result);
  failure=new AdminTariffError('STALE_TARIFF');await assert.rejects(callLocalTariffOperator(server.socketPath,token,command),error=>error.code==='STALE_TARIFF');
  failure=Error('private-host');await assert.rejects(callLocalTariffOperator(server.socketPath,token,command),error=>error.code==='TARIFF_UNAVAILABLE'&&!error.message.includes('private'));
  const before=calls;await assert.rejects(callLocalTariffOperator(server.socketPath,token,{...command,targetId:actor}));assert.equal(calls,before);
 }finally{await server.close();}
});
