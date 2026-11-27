import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalPrimaryModule} from '../scripts/local-primary-modules.cjs';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {vacancyEmployerPrefill} from '../src/lib/vacancy-employer-defaults.ts';
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

test('profile defaults do not convert incompatible tax identifiers or foreign numbers into employer data',()=>{
 const profile=createDefaultCabinetProfile({name:'Анна Тестовая',email:'fixture@example.invalid'});
 const partial=vacancyEmployerPrefill({...profile,organizationName:'Мастерская',organizationOgrn:'1000000000000',phone:'8 (999) 000-12-34'});
 assert.equal(partial.organization.ogrn,'1000000000000');
 assert.equal(partial.organization.inn,undefined);
 assert.equal(partial.organization.phone,'+79990001234');
 assert.equal(partial.ip.organization,undefined);
 assert.deepEqual(partial.person,{organization:'Анна Тестовая',phone:'+79990001234'});
 const ambiguous=vacancyEmployerPrefill({...profile,organizationName:'Мастерская',organizationInn:'1234567890',
  organizationOgrn:'123456789012345',organizationWebsite:'javascript:void(0)',phone:'+45990001234'});
 for(const kind of ['organization','ip']){
  assert.equal(ambiguous[kind].organization,undefined);
  assert.equal(ambiguous[kind].inn,undefined);
  assert.equal(ambiguous[kind].ogrn,undefined);
  assert.equal(ambiguous[kind].ogrnip,undefined);
  assert.equal(ambiguous[kind].website,undefined);
  assert.equal(ambiguous[kind].phone,undefined);
 }
});

test('old requisites with invalid check digits are excluded from vacancy defaults',()=>{
 const profile=createDefaultCabinetProfile({name:'Анна Тестовая',email:'fixture@example.invalid'});
 const defaults=vacancyEmployerPrefill({...profile,organizationName:'Мастерская',organizationInn:'1000000003',organizationOgrn:'1000000000002'});
 assert.equal(defaults.organization.inn,undefined);
 assert.equal(defaults.organization.ogrn,undefined);
 assert.equal(defaults.organization.organization,'Мастерская');
});
