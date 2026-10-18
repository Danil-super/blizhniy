import assert from 'node:assert/strict';import {test} from 'node:test';
import {mapPublicWorkPublication} from '../src/lib/public-work-publications.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
const id='11111111-1111-4111-8111-111111111111',photo='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-10-18T12:00:00Z'),createdAt='2026-10-18T10:00:00.000001Z',expiresAt='2026-10-19T12:00:00.000001Z';
const form=kind=>parseWorkPublicationForm(kind,{title:'Техническая публикация',description:'Подробное описание работы',professionName:'Сантехник',cityName:'Краснодар',contactPhone:'+79990000000',messengerUrl:'https://t.me/synthetic',placementRightConfirmed:true,
 address:'Скрытый адрес',latitude:45,longitude:38,showExactAddress:false,photoIds:[photo],...(kind==='vacancy'?{employerType:'person',organization:'Технический работодатель',salary:'80000.50',email:'synthetic@example.invalid',contactPerson:'Приватное имя'}:{budget:'1200.50'})});
const row=kind=>({id,kind,form:form(kind),mediaIds:[photo],status:'published',paid:true,createdAt,publishedAt:createdAt,expiresAt});
test('public work cards map only complete eligible metadata and exact decimal display values',()=>{
 const vacancy=mapPublicWorkPublication(row('vacancy'),now),order=mapPublicWorkPublication(row('workRequest'),now);
 assert.equal(vacancy.salary,'от 80 000,50 ₽');assert.equal(order.budget,'1 200,50 ₽');assert.equal(vacancy.organization,'Технический работодатель');assert.equal(order.city,'Краснодар');
 assert.deepEqual(vacancy.images,[`/api/work-publications/${id}/photos/${photo}`]);
 for(const item of [vacancy,order])for(const key of ['phone','messengerUrl','email','contactPerson','inn','ogrn','ogrnip','address','lat','lng'])assert.equal(Object.hasOwn(item,key),false);
 for(const item of [vacancy,order]){const json=JSON.stringify(item);for(const value of ['+79990000000','synthetic@example.invalid','Скрытый адрес','Приватное имя'])assert.equal(json.includes(value),false);}
});
test('public work projection rejects unpaid, expired, future, malformed, incomplete and mismatched-photo rows without synthesizing defaults',()=>{
 const base=row('workRequest');
 for(const bad of [{...base,paid:false},{...base,status:'draft'},{...base,expiresAt:null},{...base,expiresAt:'bad'},
  {...base,expiresAt:'2026-10-18T12:00:00.000001Z'},{...base,publishedAt:expiresAt},{...base,mediaIds:[]},
  {...base,form:{...base.form,placementRightConfirmed:false}},{...base,form:{...base.form,title:''}}])assert.equal(mapPublicWorkPublication(bad,now),null);
});
test('public exact location appears only after the author explicitly opts in',()=>{
 const base=row('vacancy'),visible=mapPublicWorkPublication({...base,form:{...base.form,showExactAddress:true}},now);
 assert.equal(visible.address,'Скрытый адрес');assert.equal(visible.lat,45);assert.equal(visible.lng,38);assert.equal(visible.showExactAddress,true);
 assert.equal(Object.hasOwn(visible,'email'),false);
});
