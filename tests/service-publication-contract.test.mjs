import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseServicePublicationForm,checkServicePublicationForm,publicServicePublicationForm} from '../src/lib/service-publication-contract.ts';
const photo='11111111-1111-4111-8111-111111111111';
test('specialist, fair and marquee have distinct strict forms, never financial or account authority',()=>{
 const specialist=parseServicePublicationForm('specialist',{title:'Мастер',price:'1250.50',skills:'Ремонт',experience:'5 лет'});
 assert.equal(specialist.price,'1250.50');assert.equal(specialist.experience,'5 лет');
 const fair=parseServicePublicationForm('fair',{title:'Мастерская',category:'Посуда',comment:'Электричество',videoUrl:'https://example.invalid/video',photoIds:[photo]});
 assert.equal(fair.comment,'Электричество');assert.deepEqual(fair.photoIds,[photo]);
 assert.equal(parseServicePublicationForm('marquee',{title:'Короткое объявление',href:'https://example.invalid/'}).href,'https://example.invalid/');
 for(const kind of ['specialist','fair','marquee'])for(const key of ['authorId','owner','isPaid','status','revision','approved','startsAt','endsAt','priceAuthority'])assert.throws(()=>parseServicePublicationForm(kind,{[key]:true}));
 assert.throws(()=>parseServicePublicationForm('specialist',{category:'Посуда'}));assert.throws(()=>parseServicePublicationForm('fair',{skills:'Поле другой формы'}));
 assert.throws(()=>parseServicePublicationForm('marquee',{photoIds:[photo]}));
});
test('service drafts may be incomplete, but review requires meaningful content, real contacts and explicit placement permission',()=>{
 for(const kind of ['specialist','fair','marquee']){assert.equal(parseServicePublicationForm(kind,{}).placementRightConfirmed,false);assert.ok(checkServicePublicationForm(parseServicePublicationForm(kind,{})).length);}
 const common={title:'Синтетический мастер',description:'Описание работы мастера длиной больше двадцати символов.',cityName:'Краснодар',contactPhone:'+79990000000',email:'synthetic@example.invalid',placementRightConfirmed:true};
 assert.deepEqual(checkServicePublicationForm(parseServicePublicationForm('specialist',{...common,professionName:'Сантехник',skills:'Ремонт',price:'1200.50'})),[]);
 assert.deepEqual(checkServicePublicationForm(parseServicePublicationForm('fair',{...common,category:'Посуда'})),[]);
 assert.deepEqual(checkServicePublicationForm(parseServicePublicationForm('marquee',{title:'Проверенный текст рекламы',placementRightConfirmed:true})),[]);
 for(const invalid of ['true',1,null])assert.throws(()=>parseServicePublicationForm('fair',{placementRightConfirmed:invalid}));
});
test('service validation rejects malformed text, URLs, money, coordinates and foreign file paths without truncation or coercion',()=>{
 for(const title of ['\ud800','bad\u0000text','x'.repeat(141)])assert.throws(()=>parseServicePublicationForm('marquee',{title}));
 for(const href of ['javascript:alert(1)','data:text/html,bad','https://user:password@example.invalid/'])assert.throws(()=>parseServicePublicationForm('marquee',{href}));
 for(const price of ['1e3','-1','1.001',Infinity,42])assert.throws(()=>parseServicePublicationForm('specialist',{price}));
 for(const input of [{photoIds:[photo,photo]},{photoIds:['/private/path']},{latitude:Infinity,longitude:1},{latitude:1},{showExactAddress:true}])assert.throws(()=>parseServicePublicationForm('specialist',input));
 assert.throws(()=>parseServicePublicationForm('fair',{photoIds:Array.from({length:11},(_,n)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`)}));
});
test('public service forms explicitly exclude contacts, private comments and unshared location',()=>{
 const common={title:'Технический',contactPhone:'+79990000000',email:'private@example.invalid',messengerUrl:'@private_fixture',address:'Частный адрес',latitude:45,longitude:39,showExactAddress:false};
 const specialist=publicServicePublicationForm(parseServicePublicationForm('specialist',common));
 const fair=publicServicePublicationForm(parseServicePublicationForm('fair',{...common,comment:'Скрытый комментарий'}));
 for(const form of [specialist,fair]){const wire=JSON.stringify(form);for(const secret of ['+79990000000','private@example.invalid','private_fixture','Частный адрес','Скрытый комментарий'])assert.equal(wire.includes(secret),false);assert.equal(Object.hasOwn(form,'contactPhone'),false);assert.equal(form.latitude,null);}
});
test('specialist review retains the existing minimum work price of 100 rubles using exact cents',()=>{
 const base={title:'Мастер',description:'Описание специалиста длиной больше двадцати символов.',cityName:'Краснодар',professionName:'Сантехник',skills:'Ремонт',email:'fixture@example.invalid',placementRightConfirmed:true};
 for(const price of ['0.01','99.99'])assert.ok(checkServicePublicationForm(parseServicePublicationForm('specialist',{...base,price})).some(message=>message.includes('100')));
 assert.deepEqual(checkServicePublicationForm(parseServicePublicationForm('specialist',{...base,price:'100.00'})),[]);
});
