import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listingExtraFields,replaceListingExtraFields} from '../src/lib/listing-form-edit.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const original=parseListingFormDraft({kind:'arenda',title:'Дом',description:'Описание',price:'1200',categorySlug:'otdyh',subcategoryName:'Турбазы',cityName:'Краснодар',
 district:'Центр',address:'Адрес',latitude:45,longitude:39,showExactAddress:true,contactPhone:'+79990000000',messengerUrl:'@example_user',
 booking:{mode:'stay',priceWeekday:0,priceWeekend:1500,minNights:2,blockedDates:['2026-12-01'],rules:'Без шума',tourDuration:'Сохранить также'},photoIds:['33333333-3333-4333-8333-333333333333']});
test('additional editor round-trips every saved field without dropping core, photos, zero prices or mixed booking fields',()=>{
 assert.deepEqual(replaceListingExtraFields(original,listingExtraFields(original)),original);
 const empty=parseListingFormDraft({...original,booking:{mode:'stay',rules:'',included:'',blockedDates:[]}});
 assert.deepEqual(replaceListingExtraFields(empty,listingExtraFields(empty)),empty);
});
test('additional editor replaces nullable contacts/location and normalizes messenger without changing other saved fields',()=>{
 const fields=listingExtraFields(original);Object.assign(fields,{cityName:'Сочи',contactPhone:'',messengerUrl:'@new_user',latitude:'',longitude:'',showExactAddress:false});
 const result=replaceListingExtraFields(original,fields);
 assert.equal(result.cityName,'Сочи');assert.equal(result.contactPhone,null);assert.equal(result.messengerUrl,'https://t.me/new_user');assert.equal(result.latitude,null);
 for(const key of ['title','description','kind','price','photoIds','booking'])assert.deepEqual(result[key],original[key]);
});
test('additional editor rejects malformed, unpaired or out-of-range coordinates and malformed booking rather than silently erasing them',()=>{
 for(const patch of [{latitude:' '},{latitude:'0x10'},{latitude:'Infinity'},{latitude:'91'},{longitude:''},{latitude:'',longitude:''}]){
  assert.throws(()=>replaceListingExtraFields(original,{...listingExtraFields(original),...patch}));
 }
 for(const [key,value] of [['minNights','1.5'],['priceWeekday','abc'],['availableFrom','2026-02-30'],['checkInTime','25:00'],['blockedDates','2026-12-01,wrong']]){
  const fields=listingExtraFields(original);fields.booking[key]=value;assert.throws(()=>replaceListingExtraFields(original,fields));
 }
});
test('booking removal is explicit and editing accepts partial draft dates/numbers without applying publication rules',()=>{
 const fields=listingExtraFields(original);fields.bookingMode='';assert.equal(replaceListingExtraFields(original,fields).booking,null);
 fields.bookingMode='tour';fields.booking.priceWeekday='';fields.booking.minNights='';fields.booking.tourDate='2026-12-10';
 const result=replaceListingExtraFields(original,fields);assert.equal(result.booking.mode,'tour');assert.equal(result.booking.tourDate,'2026-12-10');assert.equal(result.booking.minNights,undefined);
});
