import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAdminRefundClient} from '../src/lib/client-admin-refunds.ts';
const actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const command={action:'approve',expectedAdminId:actor,input:{id,paymentIntentId:id,reason:'Возврат.'}},approval={id,paymentIntentId:id,reason:'Возврат.',amount:'199.00',approvedAt:'2026-11-12T10:00:00Z'};
test('browser refund client posts canonical same-origin session commands and validates bound replies',async()=>{
 let calls=0;const client=createAdminRefundClient(async(url,options)=>{calls++;assert.equal(url,'/api/admin/refunds');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.headers['X-Blizhniy-Request'],'1');assert.deepEqual(JSON.parse(options.body),command);return Response.json(approval);});
 assert.deepEqual(await client.call(command),approval);assert.equal(calls,1);await assert.rejects(client.call({...command,sql:'select 1'}));assert.equal(calls,1);
 for(const response of [{...approval,paymentIntentId:other},{...approval,requestBody:'private'},{...approval,amount:'x'}])await assert.rejects(createAdminRefundClient(async()=>Response.json(response)).call(command));
});
test('browser unknown outcomes are redacted and never automatically retried; aborted and oversize replies fail',async()=>{
 let calls=0;const client=createAdminRefundClient(async()=>{calls++;throw Error('private transport');});await assert.rejects(client.call(command),error=>!error.message.includes('private'));assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(client.call(command,controller.signal));assert.equal(calls,1);
 await assert.rejects(createAdminRefundClient(async()=>new Response('x'.repeat(262145))).call(command));
 const denied=createAdminRefundClient(async()=>Response.json({error:{code:'UNAUTHENTICATED'}},{status:401}));await assert.rejects(denied.call(command),error=>error.code==='UNAUTHENTICATED');
});
test('only a definite latest-purchase rejection is actionable; wrong status, shape and readback remain uncertain',async()=>{
 for(const [status,payload,expected] of [[409,{error:{code:'REFUND_NOT_LATEST'}},'REFUND_NOT_LATEST'],[503,{error:{code:'REFUND_NOT_LATEST'}},'UNKNOWN'],[409,{error:{code:'REFUND_NOT_LATEST',private:'detail'}},'UNKNOWN']]){
  const client=createAdminRefundClient(async()=>Response.json(payload,{status}));await assert.rejects(client.call(command),error=>error.code===expected);
 }
 const client=createAdminRefundClient(async()=>Response.json({error:{code:'REFUND_NOT_LATEST'}},{status:409}));
 await assert.rejects(client.call({action:'read',expectedAdminId:actor,input:id}),error=>error.code==='UNKNOWN');
});
