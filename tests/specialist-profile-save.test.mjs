import assert from 'node:assert/strict';import {test} from 'node:test';
import {createServicePublicationSave} from '../src/lib/service-publication-save.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
test('profile name changed in another tab is not mistaken for loss of editable specialist data on save/readback',async()=>{
 let saved,writes=0;
 const input=parseServicePublicationForm('specialist',{title:'Анна',skills:'Ремонт'});
 const deps={create:async(_owner,kind,_key,form)=>{writes++;saved={id,kind,form:{...form,title:'Анна-Мария'},photos:[],revision:'1'};throw Error('Lost acknowledgement');},intent:async()=>saved};
 const attempt=createServicePublicationSave(owner,'specialist',input,[],deps,undefined,undefined,'profile');
 await assert.rejects(attempt.save());assert.equal(attempt.uncertain,true);await attempt.readback();assert.equal(attempt.completed,saved);assert.equal(writes,1);
});
test('profile-bound matching still detects changed editable specialist fields',async()=>{
 const input=parseServicePublicationForm('specialist',{title:'Анна',skills:'Ремонт'});
 const deps={create:async(_owner,kind,_key,form)=>({id,kind,form:{...form,title:'Анна-Мария',skills:'Чужая версия'},photos:[],revision:'1'})};
 const attempt=createServicePublicationSave(owner,'specialist',input,[],deps,undefined,undefined,'profile');
 await assert.rejects(attempt.save());assert.equal(attempt.completed,null);assert.equal(attempt.uncertain,true);
});
