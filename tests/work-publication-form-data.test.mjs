import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readWorkPublicationFormData} from '../src/lib/work-publication-form-data.ts';
const data=values=>{const form=new FormData();for(const [key,value] of Object.entries(values))form.set(key,value);return form;};
test('vacancy form mapping retains employer and all work details, exact salary and explicit consent',()=>{
 const form=readWorkPublicationFormData('vacancy',data({employerType:'ip',organization:'ИП Тест',inn:'123456789012',ogrnip:'123456789012345',
  title:'Мастер',profession:'Сантехник',location:'Краснодар, Центр',salary:'80 000,50',phone:'+79990000000',emailOrMessenger:'hr@example.invalid',
  requirements:'Опыт',responsibilities:'Ремонт',conditions:'Инструмент',schedule:'5/2',workFormat:'На месте',contactPerson:'Сотрудник',placementRightConfirmed:'1'}));
 assert.equal(form.kind,'vacancy');assert.equal(form.salary,'80000.50');assert.equal(form.email,'hr@example.invalid');assert.equal(form.messengerUrl,null);
 assert.equal(form.cityName,'Краснодар');assert.equal(form.professionName,'Сантехник');assert.equal(form.ogrnip,'123456789012345');assert.equal(form.contactPerson,'Сотрудник');
 for(const key of ['requirements','responsibilities','conditions','schedule','workFormat'])assert.ok(form[key]);assert.equal(form.placementRightConfirmed,true);
});
test('order mapping retains descriptions and Telegram but never fabricates an address or placement consent',()=>{
 const form=readWorkPublicationFormData('workRequest',data({title:'Заказ',description:'Сохранить\nпереносы',profession:'Сантехник',city:'Краснодар',budget:'1,50',messengerUrl:'@synthetic',
  address:'Частный адрес',lat:'45',lng:'38',locationMode:'exact',mapPointSelected:'0'}));
 assert.equal(form.kind,'workRequest');assert.equal(form.budget,'1.50');assert.equal(form.messengerUrl,'https://t.me/synthetic');assert.equal(form.description,'Сохранить\nпереносы');
 assert.equal(form.placementRightConfirmed,false);assert.equal(form.address,null);assert.equal(form.latitude,null);assert.equal(form.showExactAddress,false);
});
test('an explicitly selected vacancy map point is preserved and invalid coordinates cannot silently become zero',()=>{
 const point={title:'Мастер',location:'Краснодар',locationMode:'exact',mapPointSelected:'1',address:'Выбранный адрес',lat:'45,1',lng:'38,9'};
 const form=readWorkPublicationFormData('vacancy',data(point));assert.equal(form.showExactAddress,true);assert.equal(form.latitude,45.1);assert.equal(form.longitude,38.9);assert.equal(form.address,point.address);
 for(const lat of ['','bad','Infinity'])assert.throws(()=>readWorkPublicationFormData('vacancy',data({...point,lat})));
});
test('private employer and social website inputs normalize without losing form fields',()=>{
 const form=readWorkPublicationFormData('vacancy',data({employerType:'private',organization:'Мастер',messengerUrl:'@synthetic',website:'@synthetic'}));
 assert.equal(form.employerType,'person');assert.equal(form.messengerUrl,'https://t.me/synthetic');assert.equal(form.website,'https://t.me/synthetic');
 assert.equal(form.salary,null);assert.equal(form.placementRightConfirmed,false);
});
test('order city dropdown labels resolve to the canonical city name, not the city-plus-region display string',()=>{
 const form=readWorkPublicationFormData('workRequest',data({city:'Краснодар, Краснодарский край',title:'Заказ'}));assert.equal(form.cityName,'Краснодар');
});
