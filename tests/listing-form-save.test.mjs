import assert from 'node:assert/strict';import {test} from 'node:test';
import {createListingFormSave} from '../src/lib/listing-form-save.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
test('a valid-shaped but different write reply remains unknown, never silently reports captured data saved',async()=>{
 const save=createListingFormSave(owner,{kind:'prodam',title:'Не потерять'},[],{create:async()=>({id,revision:'1'}),upload:async()=>assert.fail(),
  write:async()=>({id,revision:'2',form:parseListingFormDraft({kind:'prodam',title:'Другой текст'}),photos:[]}),read:async()=>assert.fail()});
 await assert.rejects(save.save());assert.equal(save.completed,null);assert.equal(save.uncertain,true);
});
test('full form retains stable create/upload intents across lost replies and never repeats an unknown full write',async()=>{
 let creates=0,uploads=0,writes=0,creation,intent,stored;const file=new Blob(['synthetic'],{type:'image/png'}),form=parseListingFormDraft({kind:'prodam',title:'Тест'});
 const save=createListingFormSave(owner,form,[file],{create:async(user,key)=>{assert.equal(user,owner);if(creation)assert.equal(key,creation);creation=key;if(++creates===1)throw Error('Lost create');return{id,revision:'1'};},
  upload:async(user,key)=>{if(intent)assert.equal(key,intent);intent=key;if(++uploads===1)throw Error('Lost upload');return{id,mimeType:'image/webp',width:1,height:1,size:12};},
  write:async(user,key,revision,payload)=>{writes++;assert.equal(revision,'1');stored={id,revision:'2',form:payload,photos:[{id,mimeType:'image/webp',width:1,height:1,size:12}]};throw Error('Lost write');},read:async()=>stored});
 await assert.rejects(save.save());await assert.rejects(save.save());await assert.rejects(save.save());assert.equal(save.uncertain,true);
 await assert.rejects(save.save());assert.equal(writes,1);await save.readback();assert.equal(save.completed.revision,'2');assert.equal(writes,1);assert.equal(uploads,2);
});
test('different readback requires an explicit choice, then uses exact new CAS without discarding captured form',async()=>{
 let writes=0;const form=parseListingFormDraft({kind:'prodam',title:'Мой текст'}),save=createListingFormSave(owner,form,[],{
  create:async()=>({id,revision:'1'}),upload:async()=>assert.fail(),read:async()=>({id,revision:'9007199254740993',form:parseListingFormDraft({kind:'prodam',title:'Другой текст'}),photos:[]}),
  write:async(user,key,revision,payload)=>{if(++writes===1)throw Error('Conflict');assert.equal(revision,'9007199254740993');assert.equal(payload.title,'Мой текст');return{id,revision:'9007199254740994',form:payload,photos:[]};}});
 await assert.rejects(save.save());await save.readback();await assert.rejects(save.save());save.acceptRemoteRevision();assert.equal((await save.save()).revision,'9007199254740994');
});
