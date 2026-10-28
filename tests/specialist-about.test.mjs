import assert from 'node:assert/strict';import {test} from 'node:test';
import {specialistAbout,checkSpecialistApplicationForm} from '../src/lib/specialist-application-profile.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
test('one about field preserves distinct existing description, skills and experience without duplicating text',()=>{
 assert.equal(specialistAbout({description:'Работаю аккуратно.',skills:'Монтаж труб',experience:'5 лет'}),'Работаю аккуратно.\n\nНавыки: Монтаж труб\n\nОпыт и квалификация: 5 лет');
 assert.equal(specialistAbout({description:'Монтаж труб, опыт 5 лет.',skills:'Монтаж труб',experience:'5 лет'}),'Монтаж труб, опыт 5 лет.');
 assert.equal(specialistAbout({description:'А'.repeat(3000),skills:'Б'.repeat(500),experience:'В'.repeat(500)}).includes('В'.repeat(500)),true);
});
test('complete application profile needs one about field, not legacy skills or moderation/payment fields',()=>{
 const form=parseServicePublicationForm('specialist',{title:'Анна',description:'Работаю сантехником, выполняю монтаж и ремонт.',professionName:'Сантехник',cityName:'Краснодар',price:'1500',contactPhone:'+79991234567',placementRightConfirmed:true});
 assert.deepEqual(checkSpecialistApplicationForm(form),[]);
 for(const patch of [{description:'Мало'},{placementRightConfirmed:false},{contactPhone:null},{price:'99.99'},{professionName:null}])assert.ok(checkSpecialistApplicationForm({...form,...patch}).length);
});
