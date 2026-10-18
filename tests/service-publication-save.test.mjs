import assert from 'node:assert/strict';import {test} from 'node:test';
import {createServicePublicationSave,readServicePublicationFormData} from '../src/lib/service-publication-save.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {ServiceClientError} from '../src/lib/client-service-publications.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',file='10000000-0000-4000-8000-000000000003',stamp='2026-10-18T00:00:00.123456Z';
const saved=(kind,form,revision='1')=>({id,kind,form:parseServicePublicationForm(kind,form),revision,photos:[],status:'draft',paid:false,createdAt:stamp,updatedAt:stamp,publishedAt:null,expiresAt:null});
test('service form data preserves every domain field, exact money and selected coordinates without browser storage',()=>{
 const data=new FormData();for(const [name,value] of Object.entries({title:'Мастер',city:'Краснодар, Краснодарский край',profession:'Сантехник',price:'1 250,50',skills:'Ремонт',experience:'5 лет',description:'Описание мастера',phone:'+79990000000',email:'synthetic@example.invalid',videoUrl:'https://example.invalid/video',placementRightConfirmed:'1',locationMode:'exact',mapPointSelected:'1',lat:'45,1',lng:'39,1',address:'Технический адрес'}))data.set(name,value);
 const form=readServicePublicationFormData('specialist',data);assert.equal(form.price,'1250.50');assert.equal(form.skills,'Ремонт');assert.equal(form.experience,'5 лет');assert.equal(form.latitude,45.1);assert.equal(form.cityName,'Краснодар');assert.equal(form.placementRightConfirmed,true);
 data.set('category','Посуда');data.set('comment','Приватное пожелание');assert.equal(readServicePublicationFormData('fair',data).comment,'Приватное пожелание');
 const marquee=readServicePublicationFormData('marquee',data);assert.deepEqual(Object.keys(marquee).sort(),['href','kind','placementRightConfirmed','title']);
});
test('service intent uploads once before a complete create, captures input and recovers unknown commit only through read intent',async()=>{
 const input=parseServicePublicationForm('fair',{title:'Мастерская'}),calls=[];let row=null,lose=true;
 const deps={upload:async(...args)=>{calls.push(['upload',...args]);return{id:file,mimeType:'image/webp',width:2,height:2,size:12};},create:async(actor,kind,key,form)=>{calls.push(['create',actor,kind,key]);row=saved(kind,form);if(lose){lose=false;throw Error('Lost acknowledgement');}return row;},intent:async(actor,kind,key)=>{calls.push(['intent',actor,kind,key]);return row;},read:async()=>row,update:async()=>{throw Error('No update expected');}};
 const save=createServicePublicationSave(owner,'fair',input,[new Blob(['synthetic'],{type:'image/png'})],deps);input.title='Changed after capture';
 await assert.rejects(save.save());assert.equal(save.uncertain,true);await assert.rejects(save.save());assert.equal(calls.filter(call=>call[0]==='create').length,1);
 const result=await save.readback();assert.equal(result.form.title,'Мастерская');assert.deepEqual(result.form.photoIds,[file]);assert.equal(save.completed,result);assert.equal(save.uncertain,false);
 assert.equal(calls.filter(call=>call[0]==='upload').length,1);assert.equal(calls[1][3],calls[2][3]);
});
test('service edit conflicts require explicit acceptance of the remote exact revision, preserving the local full form',async()=>{
 const initial=saved('specialist',{title:'Исходный мастер'},'9007199254740993'),remote=saved('specialist',{title:'Другая вкладка'},'9007199254740994'),calls=[];
 const deps={upload:async()=>{throw Error('No upload');},create:async()=>{throw Error('No create');},intent:async()=>null,read:async()=>remote,
  update:async(actor,kind,id,revision,form)=>{calls.push(revision);if(calls.length===1)throw Error('Conflict');return saved(kind,form,'9007199254740995');}};
 const save=createServicePublicationSave(owner,'specialist',{...initial.form,title:'Мои изменения'},[],deps,initial);
 await assert.rejects(save.save());assert.equal((await save.readback()).form.title,'Другая вкладка');assert.equal(save.uncertain,true);await assert.rejects(save.save());
 save.acceptRemoteRevision();const result=await save.save();assert.equal(result.form.title,'Мои изменения');assert.deepEqual(calls,['9007199254740993','9007199254740994']);
});
test('service save refuses invalid file count/type or incompatible identity before external effects',()=>{
 const dependencies={};assert.throws(()=>createServicePublicationSave('bad','fair',{},[],dependencies));
 assert.throws(()=>createServicePublicationSave(owner,'marquee',{},[new Blob(['x'],{type:'image/png'})],dependencies));
 assert.throws(()=>createServicePublicationSave(owner,'fair',{},[new Blob(['x'],{type:'text/html'})],dependencies));
 assert.throws(()=>createServicePublicationSave(owner,'specialist',{},[],dependencies,saved('fair',{})));
});
test('an explicit validation refusal is not an unknown commit and permits a corrected form',async()=>{
 const dependencies={create:async()=>{throw new ServiceClientError('INVALID_INPUT');}};
 const save=createServicePublicationSave(owner,'marquee',{title:'Синтетический материал'},[],dependencies);
 await assert.rejects(save.save(),error=>error.code==='INVALID_INPUT');
 assert.equal(save.uncertain,false);assert.equal(save.completed,null);
});
