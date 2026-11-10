import assert from 'node:assert/strict';
import {test} from 'node:test';

test('compensation execution imports in the supported Node runtime and rejects invalid inputs before SQL or HTTP',async()=>{
 const {createApplicationCompensationRefundProcessor}=await import('../src/lib/primary-application-compensation-refund.ts');
 const {PostgresApplicationCompensationRefundStore}=await import('../src/lib/postgres-application-compensation-refund.ts');
 let sql=0,http=0;
 const db={transaction(){sql++;throw Error('Unexpected SQL');}},fetcher=async()=>{http++;throw Error('Unexpected provider call');};
 const merchant={shopId:'native-compensation',isTest:true,secretKey:'test_synthetic_native'};
 for(const invalid of [{...merchant,isTest:false},{...merchant,shopId:'../shop'},{...merchant,secretKey:'live_synthetic'}])assert.throws(()=>createApplicationCompensationRefundProcessor(db,invalid,fetcher));
 const processor=createApplicationCompensationRefundProcessor(db,merchant,fetcher),store=new PostgresApplicationCompensationRefundStore(db,merchant);
 for(const invalid of [null,{},[],1,'','../payment','10000000-0000-4000-8000-000000000001\n']){
  await assert.rejects(processor.process(invalid));await assert.rejects(store.reserve(invalid));await assert.rejects(store.assertDispatch(invalid));await assert.rejects(store.apply(invalid));
 }
 assert.equal(sql,0);assert.equal(http,0);
});
