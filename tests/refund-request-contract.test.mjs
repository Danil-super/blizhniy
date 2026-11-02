import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPlacementRefundRequest,RefundRequestError} from '../src/lib/refund-request-contract.ts';

const input={operationId:'10000000-0000-4000-8000-000000000001',paymentIntentId:'10000000-0000-4000-8000-000000000002',providerPaymentId:'216749f7-0016-50be-b000-078d43a63ae4',amount:'199.00'};
test('full refund request has stable exact bytes, original provider ID and a separate idempotence namespace',()=>{
 const prepared=buildPlacementRefundRequest(input);
 assert.deepEqual(prepared,{idempotenceKey:'refund-'+input.operationId,requestBody:`{"payment_id":"${input.providerPaymentId}","amount":{"value":"199.00","currency":"RUB"},"metadata":{"localRefundId":"${input.operationId}","localPaymentId":"${input.paymentIntentId}"}}`});
 assert.ok(prepared.idempotenceKey.length<=64);assert.notEqual(prepared.idempotenceKey,input.operationId);
 assert.deepEqual(buildPlacementRefundRequest({...input}),prepared);
 assert.notEqual(buildPlacementRefundRequest({...input,operationId:input.paymentIntentId}).idempotenceKey,prepared.idempotenceKey);
});
test('refund preparation never copies contact/receipt/description/secret data into the request',()=>{
 const prepared=buildPlacementRefundRequest({...input,receipt:{customer:{email:'private@example.invalid'}},secretKey:'private-fixture-secret',description:'private reason'});
 assert.deepEqual(prepared,buildPlacementRefundRequest(input));assert.ok(!JSON.stringify(prepared).includes('private'));
 assert.deepEqual(Object.keys(JSON.parse(prepared.requestBody)).sort(),['amount','metadata','payment_id']);
});
test('refund identifiers must be bounded canonical UUID strings',()=>{
 for(const key of ['operationId','paymentIntentId','providerPaymentId'])for(const value of [undefined,null,{},[],1,'','../../refunds',input[key]+'\n','a'.repeat(10000)])assert.throws(()=>buildPlacementRefundRequest({...input,[key]:value}),RefundRequestError);
 for(const value of [undefined,null,[],1])assert.throws(()=>buildPlacementRefundRequest(value),RefundRequestError);
});
test('amount preserves integer kopecks and refuses noncanonical or unbounded values',()=>{
 for(const amount of ['0.01','199.99','9999999999.99'])assert.equal(JSON.parse(buildPlacementRefundRequest({...input,amount}).requestBody).amount.value,amount);
 for(const amount of [undefined,null,1,199.00,'0.00','-1.00','01.00','199','199.0','199.000','1e2','Infinity','NaN','99999999999.99','199.00\n'])assert.throws(()=>buildPlacementRefundRequest({...input,amount}),RefundRequestError);
});
