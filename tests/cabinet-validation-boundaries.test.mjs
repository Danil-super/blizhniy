import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadProfileModule} from './production-profile-module.mjs';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
import {parseWorkPublicationForm} from '../src/lib/work-publication-contract.ts';
import {parseServicePublicationForm} from '../src/lib/service-publication-contract.ts';
import {parseApplicationCreate} from '../src/lib/application-contract.ts';
import {parseBookingRequest} from '../src/lib/booking-request-contract.ts';

const {parseProductionProfile}=loadProfileModule('postgres-profile');
const id='10000000-0000-4000-8000-000000000001';
const application={kind:'vacancy',targetId:id,creationKey:id,specialistId:id,expectedTargetRevision:'1',expectedSpecialistRevision:'1'};
const textParsers=[
 ['listing',value=>parseListingFormDraft({kind:'prodam',description:value}).description],
 ['vacancy',value=>parseWorkPublicationForm('vacancy',{description:value}).description],
 ['order',value=>parseWorkPublicationForm('workRequest',{description:value}).description],
 ['specialist',value=>parseServicePublicationForm('specialist',{description:value}).description],
 ['fair',value=>parseServicePublicationForm('fair',{comment:value}).comment],
 ['marquee',value=>parseServicePublicationForm('marquee',{title:value}).title],
 ['application',value=>parseApplicationCreate({...application,message:value}).message],
 ['organization',value=>parseProductionProfile({organizationDescription:value}).organizationDescription],
];

test('profile name is human text, not digits or markup, without excluding compound or international names',()=>{
 for(const name of ['Иван123','12345','<script>alert(1)</script>','Анна @ example'])assert.throws(()=>parseProductionProfile({name}),`reject invalid name ${JSON.stringify(name)}`);
 for(const name of ['Анна-Мария','О\'Коннор','Д’Артаньян','Jean Luc','José'])assert.equal(parseProductionProfile({name}).name,name);
});

for(const [kind,parse] of textParsers){
 test(`${kind} free text rejects HTML elements instead of persisting markup`,()=>{
  for(const value of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','Текст <b>с разметкой</b>'])assert.throws(()=>parse(value));
 });
 test(`${kind} free text rejects C1 controls and bidi override characters`,()=>{
  for(const value of ['Текст\u0085скрытый','Текст\u202eскрытый'])assert.throws(()=>parse(value));
 });
 test(`${kind} free text preserves normal punctuation, numbers, apostrophes and SQL words as literal content`,()=>{
  const value="Ремонт 2 комнат — 50%, O'Connor; SELECT нужен в учебном примере. 5 < 10 и 10 > 5.";
  assert.equal(parse(value),value);
 });
}

const contactParsers=[
 ['profile',value=>parseProductionProfile({phone:value})],
 ['listing',value=>parseListingFormDraft({kind:'prodam',contactPhone:value})],
 ['vacancy',value=>parseWorkPublicationForm('vacancy',{contactPhone:value})],
 ['order',value=>parseWorkPublicationForm('workRequest',{contactPhone:value})],
 ['specialist',value=>parseServicePublicationForm('specialist',{contactPhone:value})],
 ['fair',value=>parseServicePublicationForm('fair',{contactPhone:value})],
];
for(const [kind,parse] of contactParsers)test(`${kind} phone rejects letters, markup and impossible lengths before draft storage`,()=>{
 for(const phone of ['abcdefghij','+7abc9000000000','12345','+7999000000012345','<b>+79990000000</b>'])assert.throws(()=>parse(phone));
 for(const phone of ['', '+7 (900) 000-00-00','8 900 000 00 00'])assert.doesNotThrow(()=>parse(phone));
});

for(const kind of ['vacancy','specialist','fair'])test(`${kind} optional contact email is empty or a bounded address, never malformed content`,()=>{
 const parse=email=>kind==='vacancy'?parseWorkPublicationForm(kind,{email}):parseServicePublicationForm(kind,{email});
 for(const email of ['not-an-email','a@@example.invalid','a b@example.invalid','<b>a</b>@example.invalid'])assert.throws(()=>parse(email));
 assert.doesNotThrow(()=>parse(''));assert.doesNotThrow(()=>parse('owner+tag@example.invalid'));
});

test('organization website is empty or an HTTP(S) URL without credentials',()=>{
 for(const organizationWebsite of ['javascript:alert(1)','data:text/html,test','not a url','https://user:pass@example.invalid'])assert.throws(()=>parseProductionProfile({organizationWebsite}));
 for(const organizationWebsite of ['', 'https://example.invalid/path?q=2'])assert.equal(parseProductionProfile({organizationWebsite}).organizationWebsite,organizationWebsite);
});

test('rental draft monetary fields reject excessive fractional precision before persistence',()=>{
 for(const field of ['priceWeekday','priceWeekend','pricePerPerson','extraGuestPrice']){
  assert.throws(()=>parseListingFormDraft({kind:'arenda',booking:{mode:'stay',[field]:1.001}}),`${field} rejects fractions smaller than a kopeck`);
  assert.doesNotThrow(()=>parseListingFormDraft({kind:'arenda',booking:{mode:'stay',[field]:1200.5}}));
 }
});

test('all publication prices retain exact unsigned bounded decimal contracts',()=>{
 const parsers=[price=>parseListingFormDraft({kind:'prodam',price}),salary=>parseWorkPublicationForm('vacancy',{salary}),budget=>parseWorkPublicationForm('workRequest',{budget}),price=>parseServicePublicationForm('specialist',{price})];
 for(const parse of parsers){
  for(const value of ['1e3','-1','+1','1.001','10000000000','NaN','Infinity',NaN,Infinity,123])assert.throws(()=>parse(value));
  for(const value of ['0','3576','3576.50','9999999999.99'])assert.doesNotThrow(()=>parse(value));
 }
});

test('booking quantity is an integer in server bounds, not coerced numeric text',()=>{
 const input={listingId:id,creationKey:id,expectedListingRevision:'1',mode:'stay',startDate:'2026-11-01',endDate:'2026-11-02',guests:2};
 for(const guests of ['2','1e3',NaN,Infinity,-1,0,1.5,1001])assert.throws(()=>parseBookingRequest({...input,guests}));
 assert.equal(parseBookingRequest(input).guests,2);
});

test('work and service draft descriptions enforce their visible 3000-character limit on the server',()=>{
 for(const kind of ['vacancy','workRequest'])assert.throws(()=>parseWorkPublicationForm(kind,{description:'Я'.repeat(3001)}));
 for(const kind of ['specialist','fair'])assert.throws(()=>parseServicePublicationForm(kind,{description:'Я'.repeat(3001)}));
 assert.doesNotThrow(()=>parseListingFormDraft({kind:'prodam',description:'Я'.repeat(10000)}));
});
