import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {PostgresPublicSearchStore}=load('postgres-public-search');

test('the search store forwards the original absolute deadline instead of starting a new budget',async()=>{
 const deadline=performance.now()+1000;let received;
 const store=new PostgresPublicSearchStore({readTransaction:async(_,options)=>{received=options;return{items:[],hasMore:false};}});
 assert.deepEqual(await store.search({query:'ремонт',page:1},{timeoutMs:1000,deadline}),{items:[],hasMore:false});
 assert.equal(received.deadline,deadline);assert.equal(received.timeoutMs,1000);
});

test('an invalid or expired search deadline releases admission once without delegating to the database',async()=>{
 for(const deadline of [null,-1,'100',NaN,Infinity,performance.now()-1]){
  let complete=0,reads=0;
  const store=new PostgresPublicSearchStore({readTransaction:()=>{reads++;throw Error('Unexpected DB delegation');}});
  await assert.rejects(store.search({query:'ремонт',page:1},{timeoutMs:1000,deadline,onComplete:()=>complete++}));
  assert.equal(complete,1);assert.equal(reads,0);
 }
});
