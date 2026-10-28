import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseListingCabinetPage} from '../src/lib/listing-cabinet-contract.ts';
const id='10000000-0000-4000-8000-000000000001';
const item={id,revision:'9007199254740993',kind:'prodam',title:'Комод',price:'3500.00',card:{city:'Сочи',district:null,coverPhotoId:null,status:'draft',blockReason:null}};
test('cabinet accepts all explicit lifecycle states without rounding revisions',()=>{
 for(const status of ['draft','pending_payment','paid','published','sold','archived','expired','blocked']){
  const value={items:[{...item,card:{...item.card,status,blockReason:status==='blocked'?'Нарушение правил':null}}],nextCursor:null,workflow:'postmoderation'};
  assert.deepEqual(parseListingCabinetPage(value),value);
 }
});
test('cabinet denies unknown status, unsafe shape, noncanonical values and foreign cursor',()=>{
 const page=patch=>({items:[{...item,...patch}],nextCursor:null,workflow:'postmoderation'});
 for(const patch of [{revision:1},{title:' Комод'},{price:3500},{id:'bad'},{card:{...item.card,status:'active'}},{card:{...item.card,status:'blocked'}},{card:{...item.card,coverPhotoId:'https://external.invalid/x'}},{paid:true}])assert.throws(()=>parseListingCabinetPage(page(patch)));
 assert.throws(()=>parseListingCabinetPage({...page({}),nextCursor:{id,updatedAt:'2026-10-20T00:00:00.000000Z'}}));
 assert.throws(()=>parseListingCabinetPage({...page({}),items:[item,item]}));
});
