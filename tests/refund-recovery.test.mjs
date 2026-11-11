import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const input={id:'11111111-1111-4111-8111-111111111111',operationId:'22222222-2222-4222-8222-222222222222',providerRefundId:'33333333-3333-4333-8333-333333333333',reason:'Сверка спорного возврата'};
test('refund recovery accepts only exact identifiers and a bounded plain-text operator reason',()=>{
 const {parseRefundRecovery}=load('primary-refund-recovery');
 assert.deepEqual(parseRefundRecovery({...input,reason:'  '+input.reason+'  '}),input);
 for(const invalid of [null,[],{...input,extra:true},{...input,id:input.id+'\n'},{...input,operationId:1},{...input,providerRefundId:'not-a-refund'},{...input,reason:''},{...input,reason:'x'.repeat(501)},{...input,reason:'😀'.repeat(251)},{...input,reason:'<script>bad</script>'},{...input,reason:'a\u202eb'}])assert.throws(()=>parseRefundRecovery(invalid));
});
test('invalid recovery configuration and input fail before SQL or HTTP',async()=>{
 const {createPrimaryRefundRecovery}=load('primary-refund-recovery');
 let sql=0,http=0;
 const db={transaction:async()=>{sql++;throw Error('Unexpected SQL');}},fetcher=async()=>{http++;throw Error('Unexpected HTTP');};
 for(const merchant of [{shopId:'shop',isTest:false,secretKey:'live_invalid'},{shopId:'shop',isTest:true,secretKey:''}])assert.throws(()=>createPrimaryRefundRecovery(db,merchant,fetcher));
 const recovery=createPrimaryRefundRecovery(db,{shopId:'fixture',isTest:true,secretKey:'test_synthetic_recovery'},fetcher);
 await assert.rejects(recovery.recover('invalid-token',input.id,{...input,reason:''}));
 assert.equal(sql,0);assert.equal(http,0);
});
