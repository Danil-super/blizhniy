import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ReadOnlyInitialization,DependencyNotReadyError} from '../src/lib/read-only-initialization.ts';

test('temporary startup failures recover after bounded backoff and coalesce concurrent initialization',async()=>{
 let now=0,calls=0;
 const init=new ReadOnlyInitialization(async()=>{if(++calls===1)throw Object.assign(new Error('Synthetic connection failure'),{code:'ECONNREFUSED'});return 'ready';},()=>now);
 const first=init.get();assert.equal(init.get(),first);
 await assert.rejects(first,{code:'ECONNREFUSED'});now=4999;
 await assert.rejects(init.get(),{code:'ECONNREFUSED'});assert.equal(calls,1);
 now=5000;assert.deepEqual(await Promise.all(Array.from({length:20},()=>init.get())),Array(20).fill('ready'));
 assert.equal(calls,2);now=999999;assert.equal(await init.get(),'ready');assert.equal(calls,2);
});
test('temporary retries back off exponentially with a one-minute ceiling',async()=>{
 let now=0,calls=0;
 const init=new ReadOnlyInitialization(async()=>{calls++;throw new DependencyNotReadyError();},()=>now);
 for(const delay of [5000,10000,20000,40000,60000,60000]){
  await assert.rejects(init.get());const attempts=calls;
  now+=delay-1;await assert.rejects(init.get());assert.equal(calls,attempts);
  now++;
 }
 await assert.rejects(init.get());assert.equal(calls,7);
});
test('wrong privileges, schema, TLS and unclassified failures remain latched even after time passes',async()=>{
 for(const code of ['42501','42P01','23514','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','EACCES',undefined]){
  let now=0,calls=0;
  const init=new ReadOnlyInitialization(async()=>{calls++;throw Object.assign(new Error('Synthetic permanent failure'),{code});},()=>now);
  await assert.rejects(init.get());now=999999;await assert.rejects(init.get());assert.equal(calls,1,code);
 }
});
test('connection failures and explicitly missing dependencies are the only retryable initialization failures',async()=>{
 for(const error of [new DependencyNotReadyError(),...['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','08006','57P03','53300'].map(code=>Object.assign(new Error('Synthetic unavailable dependency'),{code}))]){
  let now=0,calls=0;
  const init=new ReadOnlyInitialization(async()=>{if(++calls===1)throw error;return 'ready';},()=>now);
  await assert.rejects(init.get());now=5000;assert.equal(await init.get(),'ready');assert.equal(calls,2);
 }
});
