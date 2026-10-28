import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePhotoOrder,resolvePhotoOrder} from '../src/lib/photo-order.ts';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
test('mixed saved/new photos preserve an explicitly chosen cover and replacement position',()=>{
 const order=parsePhotoOrder(JSON.stringify([{uploadIndex:1},{savedId:a},{uploadIndex:0},{savedId:b}]),[a,b],2);
 assert.deepEqual(resolvePhotoOrder(order,['new-first','new-second']),['new-second',a,'new-first',b]);
 assert.deepEqual(resolvePhotoOrder(parsePhotoOrder(null,[a,b],1),['new']),[a,b,'new']);
});
test('photo order cannot inject foreign media, duplicate or omit a saved photo/upload',()=>{
 for(const order of [[{savedId:c}],[{savedId:a},{savedId:a}],[{uploadIndex:0},{uploadIndex:0}],[{savedId:a},{uploadIndex:-1}],[{savedId:a},{uploadIndex:2}],[{savedId:a,uploadIndex:0}],[],'invalid']){
  assert.throws(()=>parsePhotoOrder(order,[a],1));
 }
});
test('an empty editor emits a valid complete empty permutation',()=>{
 assert.deepEqual(parsePhotoOrder('[]',[],0),[]);
});
