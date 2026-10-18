import assert from 'node:assert/strict';import {test} from 'node:test';
import {mapPublicServicePublication} from '../src/lib/public-service-publications.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
const id='10000000-0000-4000-8000-000000000001',photo='10000000-0000-4000-8000-000000000002',now=Date.parse('2026-10-18T00:00:00Z');
const row=kind=>({id,kind,form:parseServicePublicationForm(kind,{title:'Публичный синтетический материал',placementRightConfirmed:true,
 ...(kind==='marquee'?{href:'https://example.invalid/'}:{description:'Подробное описание синтетического материала.',cityName:'Краснодар',contactPhone:'+79990000000',email:'private@example.invalid',messengerUrl:'@private_fixture',address:'Приватная улица',latitude:45.123456,longitude:39.123456,showExactAddress:false,photoIds:[photo],
 ...(kind==='specialist'?{professionName:'Сантехник',price:'1250.50',skills:'Монтаж',experience:'5 лет'}:{category:'Посуда',comment:'Приватный комментарий'})})}),mediaIds:kind==='marquee'?[]:[photo],status:'published',paid:true,createdAt:'2026-10-01T00:00:00.000001Z',publishedAt:'2026-10-17T00:00:00.000001Z',expiresAt:'2026-10-19T00:00:00.000001Z'});
test('public service DTOs include exact domain fields and local photo routes, never private contacts or comments',()=>{
 const specialist=mapPublicServicePublication(row('specialist'),now),fair=mapPublicServicePublication(row('fair'),now),marquee=mapPublicServicePublication(row('marquee'),now);
 assert.equal(specialist.name,'Публичный синтетический материал');assert.equal(specialist.price,'от 1 250,50 ₽');assert.equal(specialist.skills,'Монтаж');
 assert.deepEqual(specialist.images,[`/api/service-publications/${id}/photos/${photo}`]);assert.deepEqual(fair.productPhotos,specialist.images);
 assert.equal(fair.category,'Посуда');assert.equal(fair.phone,'');assert.equal(fair.email,'');assert.deepEqual(marquee,{id,text:'Публичный синтетический материал',href:'https://example.invalid/'});
 for(const value of [specialist,fair,marquee])for(const secret of ['+79990000000','private@example.invalid','@private_fixture','Приватная улица','Приватный комментарий','45.123456'])assert.equal(JSON.stringify(value).includes(secret),false);
 for(const key of ['phone','email','messengerUrl','authorId','comment','address','lat','lng'])assert.equal(Object.hasOwn(specialist,key),false);
});
test('all public service kinds fail closed for unpaid, incomplete, malformed, expired, future and mismatched photo rows',()=>{
 for(const kind of ['specialist','fair','marquee']){const base=row(kind);
  for(const bad of [{...base,paid:false},{...base,status:'draft'},{...base,expiresAt:null},{...base,expiresAt:'bad'},
   {...base,expiresAt:'2026-10-18T00:00:00.000001Z'},{...base,publishedAt:'2026-10-19T00:00:00Z'},
   {...base,form:{...base.form,placementRightConfirmed:false}},{...base,form:{...base.form,title:''}},{...base,mediaIds:[photo,photo]}])assert.equal(mapPublicServicePublication(bad,now),null);
 }
});
test('public service exact location requires explicit opt-in and never exposes private contacts alongside it',()=>{
 const base=row('fair'),visible=mapPublicServicePublication({...base,form:{...base.form,showExactAddress:true}},now);
 assert.equal(visible.address,'Приватная улица');assert.equal(visible.lat,45.123456);assert.equal(visible.lng,39.123456);assert.equal(visible.phone,'');assert.equal(visible.email,'');assert.equal(Object.hasOwn(visible,'comment'),false);
});
