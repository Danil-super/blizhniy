import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
const {checkVacancyCheckoutForm,checkVacancyEmployer}=loadLocalPrimaryModule('vacancy-checkout-validation');
const base={kind:'vacancy',title:'Мастер по ремонту',description:'Работа в мастерской с удобным графиком.',cityName:'Краснодар',professionName:'Сантехник',placementRightConfirmed:true,
 contactPhone:'+79990000000',messengerUrl:null,employerType:'organization',organization:'Мастерская',inn:'7707083893',ogrn:'1027700132195',ogrnip:'',contactPerson:'Иван Иванов',email:'hr@example.invalid',website:'https://example.invalid',salary:'45000.00'};
test('complete employer variants can proceed; no arbitrary checksum-shaped requisites',()=>{
 assert.deepEqual(checkVacancyCheckoutForm(base),[]);
 assert.deepEqual(checkVacancyEmployer({...base,employerType:'ip',organization:'Иванов Иван Иванович',inn:'500100732259',ogrn:'',ogrnip:''}),[]);
 assert.deepEqual(checkVacancyCheckoutForm({...base,employerType:'person',organization:'Иван',inn:'',ogrn:'',contactPerson:null,email:null}),[]);
 for(const patch of [{inn:'7707083894'},{ogrn:'1027700132194'},{contactPhone:'123'},{contactPerson:''},{email:'not-an-email'},{website:'javascript:alert(1)'}])assert.ok(checkVacancyCheckoutForm({...base,...patch}).length);
});
test('private person has no company requisites and needs a real name; salary is optional but positive when given',()=>{
 const person={...base,employerType:'person',organization:'Иван',inn:'',ogrn:'',contactPerson:null,email:null};
 assert.ok(checkVacancyCheckoutForm({...person,organization:'123'}).length);
 assert.ok(checkVacancyCheckoutForm({...person,inn:'7707083893'}).length);
 assert.deepEqual(checkVacancyCheckoutForm({...person,salary:null}),[]);
 assert.ok(checkVacancyCheckoutForm({...person,salary:'0.00'}).length);
 assert.ok(checkVacancyCheckoutForm({...person,messengerUrl:'javascript:bad'}).length);
});
