import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresPlacementRefundReservationStore,PlacementRefundReservationError} from '../src/lib/postgres-placement-refund-reservations.ts';

const merchant={shopId:'fixture-shop',isTest:true},id='10000000-0000-4000-8000-000000000001';
test('placement refund preparation requires a valid TEST merchant before database access',()=>{
 let calls=0;const db={transaction(){calls++;throw Error('Unexpected SQL');}};
 for(const value of [null,{}, {...merchant,isTest:false},{...merchant,isTest:'true'},{...merchant,shopId:'../shop'},{...merchant,shopId:'a'.repeat(65)}])assert.throws(()=>new PostgresPlacementRefundReservationStore(db,value),PlacementRefundReservationError);
 assert.equal(calls,0);
});
test('invalid payment and proposed refund identifiers never reach the database',async()=>{
 let calls=0;const store=new PostgresPlacementRefundReservationStore({transaction(){calls++;throw Error('Unexpected SQL');}},merchant);
 for(const invalid of [undefined,null,{},[],1,'','../payments','10000000-0000-4000-8000-000000000001\n','a'.repeat(10000)]){
  await assert.rejects(store.reserve(invalid,id),PlacementRefundReservationError);
  await assert.rejects(store.reserve(id,invalid),PlacementRefundReservationError);
 }
 assert.equal(calls,0);
});
