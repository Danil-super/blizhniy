import assert from 'node:assert/strict';import{test}from'node:test';
import{parseBasicErasure,eraseBasicAccount}from'../scripts/basic-account-erasure.mjs';
const id='11111111-1111-4111-8111-111111111111';
const input={requestId:id,expectedRevision:'1',expectedOwnerId:id,expectedAuthVersion:'0',operationId:id};
test('basic erasure binds request, subject, versions and operation without coercing values',()=>{
 assert.deepEqual(parseBasicErasure(input),input);
 for(const value of [null,{}, {...input,extra:true},{...input,expectedRevision:'0'},{...input,expectedAuthVersion:'01'},{...input,expectedAuthVersion:'9223372036854775808'},{...input,expectedOwnerId:'contact@example.invalid'},{...input,operationId:id+'\n'}])assert.throws(()=>parseBasicErasure(value));
});
test('basic erasure rejects malformed inputs and non-test execution before opening a transaction',async()=>{
 let touched=false;const db={transaction:async()=>{touched=true;throw Error('Should not connect');}};
 await assert.rejects(eraseBasicAccount(db,'invalid',id,{}));assert.equal(touched,false);
 const before=process.env.NODE_ENV;process.env.NODE_ENV='production';try{await assert.rejects(eraseBasicAccount(db,'a'.repeat(64),id,input));assert.equal(touched,false);}finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;}
});
