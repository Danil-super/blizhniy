import assert from 'node:assert/strict';import {test} from 'node:test';
import {createListingFormSave} from '../src/lib/listing-form-save.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',photo='33333333-3333-4333-8333-333333333333';
test('reopening the canonical form updates the original draft, keeps saved photos and never creates a copy',async()=>{
 const initial={id,revision:'9007199254740993',form:parseListingFormDraft({kind:'prodam',title:'Сохранённый текст',photoIds:[photo]}),photos:[{id:photo,mimeType:'image/webp',width:80,height:40,size:12}]};
 let writes=0;
 const save=createListingFormSave(owner,{...initial.form,title:'Исправленный текст'},[],{
  create:async()=>assert.fail('Editing must not create another draft'),upload:async()=>assert.fail('Saved photo must not be reuploaded'),read:async()=>assert.fail(),
  write:async(user,key,revision,form)=>{writes++;assert.equal(user,owner);assert.equal(key,id);assert.equal(revision,initial.revision);assert.deepEqual(form.photoIds,[photo]);return{...initial,revision:'9007199254740994',form};},
 },initial);
 assert.equal((await save.save()).form.title,'Исправленный текст');assert.equal(writes,1);
});
test('lost edit response is read back against the same id without another write or new draft',async()=>{
 const initial={id,revision:'6',form:parseListingFormDraft({kind:'prodam',title:'До правки',photoIds:[photo]}),photos:[{id:photo,mimeType:'image/webp',width:80,height:40,size:12}]};
 let stored,writes=0;const form={...initial.form,title:'После правки',photoIds:[]};
 const save=createListingFormSave(owner,form,[],{create:async()=>assert.fail(),upload:async()=>assert.fail(),
  read:async(user,key)=>{assert.equal(key,id);return stored;},write:async(user,key,revision,payload)=>{writes++;stored={id,revision:'7',form:payload,photos:[]};throw Error('Lost reply');}},initial);
 await assert.rejects(save.save());assert.equal(save.uncertain,true);await assert.rejects(save.save());
 await save.readback();assert.deepEqual(save.completed,stored);assert.equal(writes,1);
});
