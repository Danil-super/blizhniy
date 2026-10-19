import assert from 'node:assert/strict';import {test} from 'node:test';import {formModule} from './listing-form-module.mjs';
import {bookingDetails} from './listing-publication-check-module.mjs';import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const {mapPublicListing}=formModule('public-listings',{'./booking-details':bookingDetails});
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',photo='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-10-19T12:00:00Z'),createdAt='2026-10-18T10:00:00.000001Z',expiresAt='2026-10-20T12:00:00.000001Z';
const form=kind=>parseListingFormDraft({kind,title:'Синтетическое объявление',description:'Подробное описание предложения',price:'1234.50',categorySlug:'sad-i-rasteniya',subcategoryName:'Саженцы',cityName:'Краснодар',contactPhone:'+79990000000',messengerUrl:'https://t.me/synthetic_user',
 address:'Скрытый адрес автора',latitude:45,longitude:38,showExactAddress:false,photoIds:[photo],...(kind==='arenda'?{booking:{mode:'stay',priceWeekday:100,priceWeekend:150,minNights:1,includedGuests:2,maxGuests:4}}:{})});
const row=(kind='prodam')=>({id,ownerId:owner,revision:'9007199254740993',approvedRevision:'9007199254740993',authorName:'Технический продавец',form:form(kind),mediaIds:[photo],isSubcategory:true,status:'published',paid:true,viewCount:2,createdAt,publishedAt:createdAt,expiresAt});
test('public listing projection preserves all four kinds, exact displayed price, category relation, seller name and ordered local photos',()=>{
 for(const kind of ['prodam','kuplyu','otdam-darom','arenda']){
  const result=mapPublicListing(row(kind),now);assert.ok(result);assert.equal(result.kind,kind);assert.equal(result.author,'Технический продавец');assert.equal(result.ownerKey,owner);assert.equal(result.subcategory,'Саженцы');assert.equal(result.isSubcategory,true);
  assert.equal(result.price,kind==='arenda'?'от 100 ₽/сутки':'1 234,50 ₽');assert.deepEqual(result.images,[`/api/listings/${id}/photos/${photo}`]);assert.equal(result.phone,'+79990000000');assert.equal(result.messengerUrl,'https://t.me/synthetic_user');
 }
});
test('public listing projection does not serialize a hidden address, coordinates, private form, identity credentials or contact fields from the account',()=>{
 const result=mapPublicListing({...row(),email:'private@example.invalid',password_hash:'private-credential',profile:{organizationAddress:'Private organization address'}},now);assert.ok(result);
 for(const key of ['address','lat','lng','email','profile','form','revision','approvedRevision','password_hash'])assert.equal(Object.hasOwn(result,key),false);
 for(const secret of ['Скрытый адрес автора','private@example.invalid','private-credential','Private organization address'])assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal(result.hasMapPoint,false);assert.equal(result.showExactAddress,false);
 const visible=mapPublicListing({...row(),form:{...form('prodam'),showExactAddress:true}},now);assert.equal(visible.address,'Скрытый адрес автора');assert.equal(visible.lat,45);assert.equal(visible.lng,38);
});
test('unpaid, unapproved, stale, expired, future, malformed or incomplete public rows fail closed without invented references or replacement photos',()=>{
 const base=row();for(const bad of [{...base,status:'draft'},{...base,paid:false},{...base,approvedRevision:null},{...base,approvedRevision:'1'},{...base,revision:1},{...base,expiresAt:null},{...base,publishedAt:expiresAt},
  {...base,expiresAt:'2026-10-19T12:00:00.000001Z'},{...base,createdAt:'invalid'},{...base,mediaIds:[]},{...base,viewCount:-1},{...base,viewCount:1.5},{...base,isSubcategory:'yes'},{...base,authorName:'x'.repeat(121)},
  {...base,form:{...base.form,title:''}},{...base,form:{...base.form,cityName:null}},{...base,form:{...base.form,categorySlug:null,subcategoryName:null}},{...base,form:{...base.form,contactPhone:null,messengerUrl:null}},
  {...row('arenda'),form:{...form('arenda'),booking:{mode:'stay',priceWeekday:100}}}])assert.equal(mapPublicListing(bad,now),null);
 assert.equal(mapPublicListing(base,NaN),null);assert.equal(mapPublicListing({...base,form:{...base.form,photoIds:[photo,photo]}},now),null);
});
test('root categories stay roots, seller placeholder is not an invented identity, optional contacts and no-price values remain honest',()=>{
 const base=row(),root=mapPublicListing({...base,isSubcategory:false,authorName:null,form:{...base.form,subcategoryName:null,price:null,contactPhone:null}},now);assert.ok(root);assert.equal(root.isSubcategory,false);assert.equal(root.subcategory,'');assert.equal(root.author,'Автор объявления');assert.equal(root.price,'по договоренности');assert.equal(Object.hasOwn(root,'phone'),false);
});
test('explicitly public zero coordinates remain valid and anonymous booking fields never replace the declared listing kind',()=>{
 const base=row(),point=mapPublicListing({...base,form:{...base.form,showExactAddress:true,latitude:0,longitude:0}},now);assert.equal(point.hasMapPoint,true);assert.equal(point.lat,0);assert.equal(point.lng,0);
 assert.equal(mapPublicListing({...base,form:{...base.form,booking:form('arenda').booking}},now),null);
});
