import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWorkPublicationForm,checkWorkPublicationForm,publicWorkPublicationForm} from '../src/lib/work-publication-contract.ts';

test('orders and vacancies retain complete distinct fields without accepting identity or publication authority',()=>{
 const order=parseWorkPublicationForm('workRequest',{title:'  Ремонт комнаты  ',description:'Нужен мастер',budget:'1250.50',cityName:'Краснодар',professionName:'Ремонт квартир'});
 assert.equal(order.title,'Ремонт комнаты');assert.equal(order.budget,'1250.50');assert.equal(order.kind,'workRequest');
 const vacancy=parseWorkPublicationForm('vacancy',{title:'Мастер',organization:'Мастерская',employerType:'person',salary:'45000',requirements:'Опыт',conditions:'Полный день'});
 assert.equal(vacancy.salary,'45000.00');assert.equal(vacancy.requirements,'Опыт');
 for(const field of ['authorId','ownerId','status','paid','isPaid','revision','publishedAt','expiresAt','moderation'])assert.throws(()=>parseWorkPublicationForm('vacancy',{[field]:'forged'}));
 assert.throws(()=>parseWorkPublicationForm('workRequest',{organization:'Неизвестное поле заказа'}));
 assert.throws(()=>parseWorkPublicationForm('vacancy',{budget:'1.00'}));
});
test('drafts may be incomplete; moderation requires meaningful title, description, place, profession and contact',()=>{
 const draft=parseWorkPublicationForm('workRequest',{});assert.equal(draft.title,'');assert.ok(checkWorkPublicationForm(draft).length>=5);
 const ready=parseWorkPublicationForm('workRequest',{title:'Ремонт комнаты',description:'Нужен мастер',cityName:'Краснодар',professionName:'Ремонт квартир',messengerUrl:'@example_user',placementRightConfirmed:true});
 assert.deepEqual(checkWorkPublicationForm(ready),[]);assert.equal(ready.messengerUrl,'https://t.me/example_user');
});
test('exact money, malformed unicode, control characters and oversized input fail before storage',()=>{
 for(const budget of ['1e3','-1','1.001',Infinity,100.5])assert.throws(()=>parseWorkPublicationForm('workRequest',{budget}));
 for(const title of ['\ud800','bad\u0000title','x'.repeat(121)])assert.throws(()=>parseWorkPublicationForm('workRequest',{title}));
 assert.throws(()=>parseWorkPublicationForm('workRequest',{description:'x'.repeat(10001)}));
 assert.equal(parseWorkPublicationForm('workRequest',{description:'Строка\nНовая строка'}).description,'Строка\nНовая строка');
});
test('coordinates are finite and paired, exact location cannot be declared without a selected point',()=>{
 for(const input of [{latitude:1},{latitude:Infinity,longitude:1},{latitude:91,longitude:1},{showExactAddress:true}])assert.throws(()=>parseWorkPublicationForm('workRequest',input));
 assert.equal(parseWorkPublicationForm('workRequest',{latitude:45,longitude:39,showExactAddress:true}).latitude,45);
});
test('photo references are distinct bounded UUIDs, never client paths or readiness assertions',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.deepEqual(parseWorkPublicationForm('vacancy',{photoIds:[id]}).photoIds,[id]);
 for(const photoIds of [['/private/file.webp'],[id,id]])assert.throws(()=>parseWorkPublicationForm('vacancy',{photoIds}));
});
test('vacancy employer requisites are checked before moderation without inventing validity for partial drafts',()=>{
 const common={title:'Мастер',description:'Работа в мастерской',organization:'Мастерская',cityName:'Краснодар',professionName:'Ремонт квартир',contactPhone:'+79990000000',placementRightConfirmed:true};
 assert.ok(checkWorkPublicationForm(parseWorkPublicationForm('vacancy',{...common,employerType:'organization'})).some(message=>message.includes('ИНН')));
 assert.ok(checkWorkPublicationForm(parseWorkPublicationForm('vacancy',{...common,employerType:'organization',inn:'123456789012'})).some(message=>message.includes('ИНН')));
 assert.deepEqual(checkWorkPublicationForm(parseWorkPublicationForm('vacancy',{...common,employerType:'person'})),[]);
 assert.throws(()=>parseWorkPublicationForm('vacancy',{employerType:'admin'}));
});
test('public DTO excludes contacts, personal requisites and a non-public exact address even when provided in the stored form',()=>{
 const form=parseWorkPublicationForm('vacancy',{contactPhone:'+79990000000',email:'fixture@example.invalid',messengerUrl:'@example_user',contactPerson:'Контактное лицо',inn:'1234567890',address:'Частный адрес',latitude:45,longitude:39,showExactAddress:false});
 const dto=publicWorkPublicationForm(form),wire=JSON.stringify(dto);
 for(const secret of ['+79990000000','fixture@example.invalid','example_user','Контактное лицо','1234567890','Частный адрес'])assert.equal(wire.includes(secret),false);
 assert.equal(dto.latitude,null);assert.equal(dto.longitude,null);
 assert.equal(Object.hasOwn(dto,'contactPhone'),false);assert.equal(Object.hasOwn(dto,'email'),false);
});
test('placement consent remains an explicit boolean attestation, not an implicit draft/default publication permission',()=>{
 const draft=parseWorkPublicationForm('workRequest',{});
 assert.equal(draft.placementRightConfirmed,false);
 assert.ok(checkWorkPublicationForm(draft).some(message=>message.includes('право')));
 assert.equal(parseWorkPublicationForm('workRequest',{placementRightConfirmed:true}).placementRightConfirmed,true);
 for(const value of ['true',1,{},null])assert.throws(()=>parseWorkPublicationForm('workRequest',{placementRightConfirmed:value}));
});
