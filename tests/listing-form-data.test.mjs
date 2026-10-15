import assert from 'node:assert/strict';import {test} from 'node:test';
import {readListingFormData} from '../src/lib/listing-form-data.ts';
test('existing placement form maps category, chosen city, contacts, exact decimal and private map fields',()=>{
 const data=new FormData();for(const [key,value] of Object.entries({kind:'prodam',title:'Стол',description:'Описание',price:'1 234',category:'dlya-doma-i-dachi',subcategoryName:'Мебель для дома и дачи',location:'Краснодар, Краснодарский край',phone:'+79990000000',messengerUrl:'@example_user'}))data.set(key,value);
 const form=readListingFormData(data);assert.equal(form.price,'1234.00');assert.equal(form.subcategoryName,'Мебель для дома и дачи');assert.equal(form.cityName,'Краснодар');assert.equal(form.contactPhone,'+79990000000');assert.equal(form.latitude,null);
 data.set('locationMode','exact');data.set('mapPointSelected','1');data.set('address','Сочи, улица 1');data.set('lat','43.6');data.set('lng','39.7');data.delete('location');
 const exact=readListingFormData(data);assert.equal(exact.showExactAddress,true);assert.equal(exact.cityName,'Сочи');assert.equal(exact.address,'Сочи, улица 1');assert.equal(exact.latitude,43.6);
});
