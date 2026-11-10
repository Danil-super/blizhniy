import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresApplicationCompensationDiscovery} from '../src/lib/postgres-application-compensation-discovery.ts';
const merchant={shopId:'native-discovery',isTest:true},id='10000000-0000-4000-8000-000000000001';

test('discovery validates TEST scope and raw batch limits before SQL',async()=>{
 let calls=0;const db={transaction(){calls++;throw Error('Unexpected SQL');}};
 for(const scope of [{...merchant,isTest:false},{...merchant,isTest:'true'},{...merchant,shopId:'../shop'}])assert.throws(()=>new PostgresApplicationCompensationDiscovery(db,scope));
 const discovery=new PostgresApplicationCompensationDiscovery(db,merchant);
 for(const limit of [null,'10',0,26,1.5,Infinity])await assert.rejects(discovery.scan(limit));assert.equal(calls,0);
});
test('a malformed or over-budget discovery page cannot reach intake',async()=>{
 for(const page of [null,{},[],{visited:26,ids:[]},{visited:2,ids:[id,id]},{visited:1,ids:['../payment']},{visited:0,ids:[id]},{visited:1,ids:[],extra:true}]){
  let queries=0;const db={transaction:async work=>work({query:async sql=>{queries++;assert.match(sql,/^select app.next_application_compensation_candidates/);return{rows:[{page}]};}})};
  await assert.rejects(new PostgresApplicationCompensationDiscovery(db,merchant).scan());assert.equal(queries,1);
 }
});
