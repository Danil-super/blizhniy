import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const id='10000000-0000-4000-8000-000000000001',paymentId='10000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000003';
const merchant={shopId:'refund-approval-fixture',isTest:true};
function intent(receipt=false,patch={}){
 const source={id:paymentId,ownerId:owner,targetType:'listing',targetId:id,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,...merchant,...patch};
 return{...source,requestBody:JSON.stringify({amount:{value:source.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:source.id,targetId:source.targetId,targetType:source.targetType,tariffId:source.tariffId},...(receipt?{receipt:{customer:{email:'fixture@example.invalid'},internet:true,items:[{description:'Размещение',quantity:1,amount:{value:source.amount,currency:'RUB'},vat_code:1,payment_mode:'full_payment',payment_subject:'service'}]}}:{})})};
}
test('full-placement refund proposal accepts only case, original purchase and a bounded reason',()=>{
 const {parsePlacementRefundApproval,RefundApprovalInputError}=load('placement-refund-approval');
 assert.deepEqual(parsePlacementRefundApproval({id,paymentIntentId:paymentId,reason:'  Ошибочное размещение.  '}),{id,paymentIntentId:paymentId,reason:'Ошибочное размещение.'});
 for(const bad of [{id,paymentIntentId:paymentId,reason:''},{id,paymentIntentId:paymentId,reason:'x'.repeat(501)},{id,paymentIntentId:paymentId,reason:'<script>x</script>'},{id,paymentIntentId:paymentId,reason:'Причина\u202e'},{id,paymentIntentId:paymentId,reason:'Ошибка.',amount:'1.00'},{id,paymentIntentId:paymentId,reason:'Ошибка.',approvedBy:owner},{id,paymentIntentId:paymentId,reason:'Ошибка.',fiscalMode:'none'},{id:'foreign',paymentIntentId:paymentId,reason:'Ошибка.'}])assert.throws(()=>parsePlacementRefundApproval(bad),RefundApprovalInputError);
});
test('full-placement fiscal policy uses only the immutable original receipt and never admits LIVE, responses or a different merchant',()=>{
 const {describeFullPlacementRefund,RefundApprovalInputError}=load('placement-refund-approval');
 assert.deepEqual(describeFullPlacementRefund(intent(),merchant),{policyVersion:'placement-full-admin-v1',fiscalMode:'test-without-receipt',amount:'199.00'});
 assert.deepEqual(describeFullPlacementRefund(intent(true),merchant),{policyVersion:'placement-full-admin-v1',fiscalMode:'provider-automatic-full',amount:'199.00'});
 for(const targetType of ['application','specialist','fair_application','ad_marquee'])assert.throws(()=>describeFullPlacementRefund(intent(false,{targetType}),merchant),RefundApprovalInputError);
 for(const bad of [intent(false,{isTest:false}),intent(false,{shopId:'other'}),intent(false,{durationDays:null}),{...intent(),requestBody:intent().requestBody.replace('199.00','1.00')}])assert.throws(()=>describeFullPlacementRefund(bad,merchant),RefundApprovalInputError);
 assert.throws(()=>describeFullPlacementRefund(intent(),{...merchant,isTest:false}),RefundApprovalInputError);
 const fiscal=intent(true);fiscal.requestBody=fiscal.requestBody.replace('full_payment','invalid');assert.throws(()=>describeFullPlacementRefund(fiscal,merchant),RefundApprovalInputError);
 for(const url of ['javascript:invalid','http://fixture.example.invalid/return','https:fixture.example.invalid/return','https://user:password@fixture.example.invalid/return','https://fixture.example.invalid:8443/return','https://fixture.example.invalid:/return','https://127.0.0.1/return','https://fixture.example.invalid/white space']){
  const original=intent(),body=JSON.parse(original.requestBody);body.confirmation.return_url=url;
  assert.throws(()=>describeFullPlacementRefund({...original,requestBody:JSON.stringify(body)},merchant),RefundApprovalInputError);
 }
});
