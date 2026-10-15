import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const id='11111111-1111-4111-8111-111111111111';
test('full listing draft keeps existing form fields and exact money; empty drafts remain valid',()=>{
 const form=parseListingFormDraft({kind:'prodam',title:'  Стол  ',description:'Описание\n',price:'12.3',categorySlug:'dlya-doma-i-dachi',subcategoryName:'Мебель',cityName:'Краснодар',
  address:'  Улица 1  ',district:'Центр',latitude:45,longitude:39,showExactAddress:true,contactPhone:'+79990000000',messengerUrl:'@example_user',photoIds:[id]});
 assert.equal(form.title,'Стол');assert.equal(form.price,'12.30');assert.equal(form.address,'Улица 1');assert.equal(form.messengerUrl,'https://t.me/example_user');
 assert.equal(form.cityName,'Краснодар');assert.deepEqual(form.photoIds,[id]);assert.equal(form.booking,null);
 assert.equal(parseListingFormDraft({kind:'prodam'}).contactPhone,null);
});
test('form boundary rejects privileged fields, arbitrary references, URLs, malformed coordinates and duplicate media',()=>{
 for(const fields of [{status:'published'},{isPaid:true},{authorId:id},{role:'admin'},{categoryId:id},{photoIds:[id,id]},
  {categorySlug:'../../private'},{subcategoryName:'x'},{cityName:'x'.repeat(161)},
  {latitude:91,longitude:0},{latitude:45},{latitude:'45',longitude:39},{showExactAddress:true},
  {messengerUrl:'javascript:alert(1)'},{messengerUrl:'https://user:pass@example.invalid/'},{contactPhone:'x'.repeat(41)},
  {title:'\u0000'},{booking:{mode:'stay',evil:true}},{booking:{mode:'tour',pricePerPerson:-1}},
  {booking:{mode:'stay',availableFrom:'2026-02-30'}},{booking:{mode:'stay',minNights:1.5}}])
  assert.throws(()=>parseListingFormDraft({kind:'prodam',...fields}));
});
test('partial rental booking preserves legitimate draft fields but rejects invalid or unbounded structures',()=>{
 const booking={mode:'stay',priceWeekday:1200.50,minNights:2,availableFrom:'2026-10-20',blockedDates:['2026-10-25'],rules:'Правила'};
 assert.deepEqual(parseListingFormDraft({kind:'arenda',booking}).booking,booking);
 for(const booking of [{mode:'unknown'},{mode:'stay',blockedDates:Array(731).fill('2026-10-25')},{mode:'stay',rules:'x'.repeat(501)},['stay']])
  assert.throws(()=>parseListingFormDraft({kind:'arenda',booking}));
});
