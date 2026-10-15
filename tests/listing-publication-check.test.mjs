import assert from 'node:assert/strict';import {test} from 'node:test';
import {publicationCheck} from './listing-publication-check-module.mjs';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
const {checkListingPublication}=publicationCheck;
const listingId='11111111-1111-4111-8111-111111111111',snapshot={id:listingId,revision:'9007199254740993',form:parseListingFormDraft({kind:'prodam',title:'Название',description:'Описание',categorySlug:'otdyh',cityName:'Краснодар',contactPhone:'+7-(999)-000-00-00'}),photos:[]};
const tariff={id:'listing-standard',action:'listing_publication',name:'Объявление',amount:'199.99',durationDays:30,active:true};
test('publication check reads exact price/revision and exposes no private form fields or mutable billing state',()=>{
 const report=checkListingPublication(snapshot,true,tariff);assert.equal(report.checksPassed,true);assert.deepEqual(report.issues,[]);
 assert.deepEqual(report.tariff,{id:tariff.id,name:tariff.name,amount:'199.99',currency:'RUB',durationDays:30});assert.equal(report.revision,snapshot.revision);
 assert.deepEqual(Object.keys(report).sort(),['checksPassed','issues','listingId','revision','tariff']);assert.equal(JSON.stringify(report).includes('7999'),false);
});
test('partial drafts stay saved but cannot pass publication content/category/contact checks',()=>{
 const form=parseListingFormDraft({kind:'prodam'}),result=checkListingPublication({...snapshot,form},false,tariff);
 for(const field of ['title','description','category','city','contact'])assert.ok(result.issues.some(issue=>issue.field===field));assert.equal(result.checksPassed,false);
 for(const contactPhone of ['abc','+123','+19990000000'])assert.ok(checkListingPublication({...snapshot,form:{...snapshot.form,contactPhone}},true,tariff).issues.some(issue=>issue.field==='contact'));
 assert.equal(checkListingPublication({...snapshot,form:{...snapshot.form,contactPhone:null,messengerUrl:'https://t.me/example_user'}},true,tariff).checksPassed,true);
});
test('publication uses existing complete booking rules without changing a partial rental draft',()=>{
 const form=parseListingFormDraft({...snapshot.form,kind:'arenda',booking:{mode:'stay',priceWeekday:1200}}),before=structuredClone(form);
 const report=checkListingPublication({...snapshot,form},true,tariff);assert.ok(report.issues.some(issue=>issue.field==='booking'));assert.deepEqual(form,before);
 const booking={mode:'stay',priceWeekday:1200,priceWeekend:1500,minNights:2,includedGuests:2,maxGuests:4};assert.equal(checkListingPublication({...snapshot,form:{...form,booking}},true,tariff).checksPassed,true);
});
test('missing/inactive/wrong-action or invalid tariff cannot masquerade as an available publication offer',()=>{
 for(const value of [null,{...tariff,active:false},{...tariff,action:'vacancy_publication'},{...tariff,amount:199.99},{...tariff,amount:'NaN'},{...tariff,durationDays:null},{...tariff,durationDays:0}]){
  const report=checkListingPublication(snapshot,true,value);assert.equal(report.checksPassed,false);assert.equal(report.tariff,null);assert.ok(report.issues.some(issue=>issue.field==='tariff'));
 }
});
