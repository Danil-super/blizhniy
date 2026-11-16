import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkPublicationSave} from '../src/lib/work-publication-save.ts';
import {createServicePublicationSave} from '../src/lib/service-publication-save.ts';
import {createListingFormSave} from '../src/lib/listing-form-save.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',media='44444444-4444-4444-8444-444444444444';
function fixture(family,files=[]){
 const parse=input=>family==='listing'?parseListingFormDraft({kind:'prodam',...input}):family==='work'?parseWorkPublicationForm('workRequest',{kind:'workRequest',...input}):parseServicePublicationForm('fair',{kind:'fair',...input});
 const initial={id,revision:'1',kind:family==='work'?'workRequest':'fair',form:parse({title:'Исходная карточка'}),photos:[]},form=parse({title:'Сохранённые изменения'}),calls=[];
 let remote,uploadRelease;
 const write=async(...args)=>{const offset=family==='listing'?0:1;calls.push({id:args[1+offset],revision:args[2+offset]});return{id:args[1+offset],revision:'2',kind:initial.kind,form:args[3+offset],photos:[]};};
 const dependencies={upload:async()=>{await new Promise(resolve=>{uploadRelease=resolve;});return{id:media,mimeType:'image/webp',width:2,height:2,size:12};},update:write,write,read:async(...args)=>{calls.push({read:args[family==='listing'?1:2]});return remote;}};
 const make=()=>family==='listing'?createListingFormSave(owner,form,files,dependencies,initial):family==='work'?createWorkPublicationSave(owner,'workRequest',form,files,dependencies,initial):createServicePublicationSave(owner,'fair',form,files,dependencies,initial);
 return{initial,form,calls,dependencies,make,release:()=>uploadRelease(),remote:value=>{remote=value;},snapshot:(revision,title)=>({...initial,id,revision,form:parse({title})})};
}
for(const family of ['listing','work','service']){
 test(`${family} edit target and revision are captured before waiting for an upload`,async()=>{
  const f=fixture(family,[new Blob(['synthetic'],{type:'image/png'})]),attempt=f.make(),saving=attempt.save();
  f.initial.id=other;f.initial.revision='99';f.release();await saving;assert.deepEqual(f.calls,[{id,revision:'1'}]);
 });
 test(`${family} readback keeps the original edit target after the caller changes its snapshot`,async()=>{
  const f=fixture(family),attempt=f.make();f.dependencies.update=f.dependencies.write=async()=>{throw Error('Synthetic unknown reply');};
  await assert.rejects(attempt.save(),/Synthetic unknown reply/);f.initial.id=other;f.initial.revision='99';f.remote(f.snapshot('2','Сохранённые изменения'));
  await attempt.readback();assert.deepEqual(f.calls,[{read:id}]);
 });
 test(`${family} accepting a conflict captures its revision without retaining the returned mutable object`,async()=>{
  const f=fixture(family),attempt=f.make(),write=f.dependencies.update;let first=true;
  f.dependencies.update=f.dependencies.write=async(...args)=>{if(first){first=false;throw Error('Synthetic lost reply');}return write(...args);};
  await assert.rejects(attempt.save());f.remote(f.snapshot('2','Другая сохранённая версия'));const shown=await attempt.readback();attempt.acceptRemoteRevision();shown.id=other;shown.revision='99';
  await attempt.save();assert.deepEqual(f.calls,[{read:id},{id,revision:'2'}]);
 });
}
