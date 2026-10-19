import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateYooKassaPaymentObject,validatePrimaryYooKassaPayment,YooKassaBoundaryError} from '../src/lib/yookassa-payment-contract.ts';
const expected={id:'10000000-0000-4000-8000-000000000001',targetId:'10000000-0000-4000-8000-000000000002',targetType:'listing',tariffId:'listing-publication',amount:'199.99',isTest:true,shopId:'fixture-shop',providerPaymentId:'2b3f5e11-000f-5000-8000-123456789abc',requireMetadata:true};
const now=Date.parse('2026-10-19T12:00:00.000Z');
const response=()=>({id:expected.providerPaymentId,amount:{value:'199.99',currency:'RUB'},status:'succeeded',paid:true,test:true,captured_at:'2026-10-19T11:59:00.123456789Z',recipient:{account_id:expected.shopId},
 metadata:{localPaymentId:expected.id,targetId:expected.targetId,targetType:expected.targetType,tariffId:expected.tariffId},payment_method:{card:{last4:'0000'}},description:'not retained'});
test('primary payment response validates exact RUB and merchant bindings without retaining unrelated PII',()=>{
 const result=validateYooKassaPaymentObject(response(),expected,now);
 assert.equal(result.capturedAt,'2026-10-19T11:59:00.123456789Z');assert.equal(result.amount.value,'199.99');assert.equal(result.status,'succeeded');
 assert.equal(Object.hasOwn(result,'payment_method'),false);assert.equal(Object.hasOwn(result,'recipient'),false);assert.equal(Object.hasOwn(result,'description'),false);
});
test('primary response refuses wrong provider, amount, shop, mode and missing or swapped metadata',()=>{
 for(const patch of [{id:expected.targetId},{amount:{value:'200.00',currency:'RUB'}},{amount:{value:'199.99',currency:'USD'}},{test:false},{paid:false},{recipient:{account_id:'other'}},{recipient:null},
  {metadata:undefined},{metadata:{}},{metadata:{...response().metadata,localPaymentId:null}},{metadata:{...response().metadata,targetId:expected.id}}])
  assert.throws(()=>validateYooKassaPaymentObject({...response(),...patch},expected,now),YooKassaBoundaryError);
});
test('authorization is not captured settlement, optional capture is not invented, and bad timestamp/redirect is rejected',()=>{
 const held={...response(),status:'waiting_for_capture'};delete held.captured_at;
 assert.equal(validateYooKassaPaymentObject(held,expected,now).status,'waiting_for_capture');
 const missing=response();delete missing.captured_at;assert.equal(validateYooKassaPaymentObject(missing,expected,now).capturedAt,undefined);
 for(const patch of [{captured_at:'2026-02-30T00:00:00Z'},{captured_at:'2026-10-19T12:05:00.000000001Z'},{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru.foreign.invalid/checkout'}},
  {confirmation:{type:'redirect',confirmation_url:'http://yoomoney.ru/checkout'}}])assert.throws(()=>validateYooKassaPaymentObject({...response(),...patch},expected,now),YooKassaBoundaryError);
});
test('primary entry point cannot opt out of the original merchant and complete metadata checks',()=>{
 const {requireMetadata,...binding}=expected;assert.equal(requireMetadata,true);
 assert.equal(validatePrimaryYooKassaPayment(response(),binding,now).status,'succeeded');
 for(const patch of [{shopId:undefined},{targetId:undefined},{id:'wrong'},{amount:199.99},{isTest:'true'},{tariffId:'invalid/id'},{targetType:'unknown'}])
  assert.throws(()=>validatePrimaryYooKassaPayment(response(),{...binding,...patch},now),YooKassaBoundaryError);
 assert.throws(()=>validatePrimaryYooKassaPayment({...response(),metadata:{}},{...binding,requireMetadata:false},now),YooKassaBoundaryError);
 assert.throws(()=>validatePrimaryYooKassaPayment(response(),binding,NaN),YooKassaBoundaryError);
});
test('primary verified response retains only the four known metadata bindings',()=>{
 const raw=response();raw.metadata.extraContact='synthetic-private@example.invalid';
 const verified=validatePrimaryYooKassaPayment(raw,expected,now);
 assert.deepEqual(Object.keys(verified.metadata).sort(),['localPaymentId','targetId','targetType','tariffId'].sort());
 assert.equal(JSON.stringify(verified).includes('extraContact'),false);
});
