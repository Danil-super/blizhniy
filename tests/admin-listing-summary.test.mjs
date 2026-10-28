import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as contract from '../src/lib/listing-block-contract.ts';
const id='11111111-1111-4111-8111-111111111111';
const item={id,revision:'3',title:'Комод',status:'published',paid:true,blocked:false,blockReason:null,blockedAt:null};
const card={kind:'prodam',price:'3500.00',city:'Сочи',district:'Центральный',coverPhotoId:id};
test('admin list summary carries bounded cover, kind, price and location without changing the detail contract',()=>{
 assert.deepEqual(contract.parseListingManagementSummary({...item,card}),{...item,card});
 assert.deepEqual(contract.parseListingManagementItem(item),item);
 assert.deepEqual(contract.parseListingManagementSummary(item),item);
});
test('admin list summary rejects invalid photo IDs, noncanonical prices, unknown kinds and leaked fields',()=>{
 for(const invalid of [{...card,coverPhotoId:'https://evil.invalid/image'}, {...card,price:'-1'}, {...card,price:'1.2'}, {...card,kind:'other'}, {...card,city:'x'.repeat(161)}, {...card,owner:'secret'}]){
  assert.throws(()=>contract.parseListingManagementSummary({...item,card:invalid}));
 }
 assert.deepEqual(contract.parseListingManagementSummary({...item,card:{...card,price:null,city:null,district:null,coverPhotoId:null}}).card,{...card,price:null,city:null,district:null,coverPhotoId:null});
});
