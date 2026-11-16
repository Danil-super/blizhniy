import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAdminRefundCommand,parseAdminRefundPage,parseAdminRefundApproval,parseAdminRefundRecovery} from '../src/lib/admin-refund-contract.ts';
const id='33333333-3333-4333-8333-333333333333',actor='22222222-2222-4222-8222-222222222222';
test('refund commands admit only the four exact canonical operations and bounded plain-text reasons',()=>{
 for(const [action,input] of [['list',null],['read',id],['approve',{id,paymentIntentId:id,reason:'По обращению владельца.'}],['recover',{id,operationId:id,providerRefundId:id,reason:'Сверка результата.'}]])
  assert.equal(parseAdminRefundCommand({action,expectedAdminId:actor,input}).action,action);
 for(const value of [null,{action:'close',expectedAdminId:actor,input:null},{action:'list',expectedAdminId:actor,input:null,sql:'select 1'},
  {action:'approve',expectedAdminId:actor,input:{id,paymentIntentId:id,reason:'<script>x</script>'}},
  {action:'approve',expectedAdminId:actor,input:{id,paymentIntentId:id,reason:'а'.repeat(501)}},
  {action:'recover',expectedAdminId:actor,input:{id,operationId:id,providerRefundId:'foreign',reason:'Сверка.'}}])assert.throws(()=>parseAdminRefundCommand(value));
});
test('operator replies are bounded, coherent projections, never opaque source/receipt objects',()=>{
 const approval={id,paymentIntentId:id,reason:'Возврат.',amount:'199.00',approvedAt:'2026-11-12T10:00:00.123456Z'};
 assert.deepEqual(parseAdminRefundApproval(approval),approval);assert.throws(()=>parseAdminRefundApproval({...approval,requestBody:'private'}));
 const row={id,targetType:'listing',targetId:id,amount:'199.00',createdAt:approval.approvedAt,status:'succeeded',capturedAt:approval.approvedAt,operationId:null,attempted:false,approvalId:null,reason:null,approvedAt:null,providerRefundId:null,refundStatus:null,appliedAt:null};
 assert.deepEqual(parseAdminRefundPage({items:[row],nextAfter:null}),{items:[row],nextAfter:null});
 for(const value of [{items:[{...row,email:'private'}],nextAfter:null},{items:[row],nextAfter:id},{items:[row,row],nextAfter:null},{items:[{...row,reason:'orphan'}],nextAfter:null},{items:[{...row,createdAt:'2026-02-30T10:00:00Z'}],nextAfter:null},{items:[{...row,refundStatus:['pending']}],nextAfter:null}])assert.throws(()=>parseAdminRefundPage(value));
 const recovery={actionId:id,operationId:id,providerRefundId:id,status:'succeeded',state:'applied'};
 assert.deepEqual(parseAdminRefundRecovery(recovery),recovery);assert.throws(()=>parseAdminRefundRecovery({...recovery,state:'pending'}));
});
