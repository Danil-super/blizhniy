import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicationCheck} from './listing-publication-check-module.mjs';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';

test('non-rental booking data stays editable but cannot pass moderation, checkout or paid publication content checks',()=>{
 for(const kind of ['prodam','kuplyu','otdam-darom']){
  const form=parseListingFormDraft({kind,title:'Синтетическое объявление',description:'Описание',categorySlug:'otdyh',cityName:'Краснодар',contactPhone:'+79990000000',booking:{mode:'stay'}});
  const before=structuredClone(form);
  assert.ok(publicationCheck.checkListingFormContent(form,true).some(issue=>issue.field==='booking'));
  assert.equal(publicationCheck.checkListingPublication({id:'11111111-1111-4111-8111-111111111111',revision:'1',form,photos:[]},true,{id:'listing-publication',action:'listing_publication',name:'Объявление',amount:'199.99',durationDays:30,active:true}).checksPassed,false);
  assert.deepEqual(form,before);
 }
});
