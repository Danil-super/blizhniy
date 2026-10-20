import assert from 'node:assert/strict';import {test} from 'node:test';
import {readListingFormData} from '../src/lib/listing-form-data.ts';
test('saving draft keeps past booking dates and zero money, without publication normalization',()=>{
 const data=new FormData();for(const [key,value] of Object.entries({kind:'arenda',category:'otdyh',subcategory:'turbazy',subcategoryName:'Турбазы',bookingMode:'stay',bookingPriceWeekday:'0',bookingExtraGuestPrice:'0',bookingAvailableFrom:'2020-01-01',bookingAvailableTo:'2020-02-01',bookingBlockedDates:'2020-01-05\n2030-01-05'}))data.set(key,value);
 const {booking}=readListingFormData(data);assert.equal(booking.priceWeekday,0);assert.equal(booking.extraGuestPrice,0);assert.equal(booking.availableFrom,'2020-01-01');assert.equal(booking.availableTo,'2020-02-01');assert.deepEqual(booking.blockedDates,['2020-01-05','2030-01-05']);
});
test('city-only display can retain an existing private map point without making the address public',()=>{
 const data=new FormData();for(const [key,value] of Object.entries({kind:'prodam',location:'Сочи',locationMode:'city',privateMapPoint:'1',address:'Сохранённый адрес',lat:'43.6',lng:'39.7',contactMethod:'messenger',messengerUrl:'@example_user'}))data.set(key,value);
 const form=readListingFormData(data);assert.equal(form.address,'Сохранённый адрес');assert.equal(form.latitude,43.6);assert.equal(form.longitude,39.7);assert.equal(form.showExactAddress,false);assert.equal(form.contactMethod,'messenger');
});
test('exact location retains saved city without a city in the address, but a new explicit city in the address wins',()=>{
 const data=new FormData();for(const [key,value] of Object.entries({kind:'prodam',location:'Сочи, Краснодарский край',locationMode:'exact',mapPointSelected:'1',address:'Улица 1',lat:'43.6',lng:'39.7'}))data.set(key,value);
 assert.equal(readListingFormData(data).cityName,'Сочи');
 data.set('address','Краснодар, улица 1');assert.equal(readListingFormData(data).cityName,'Краснодар');
 data.set('address','Краснодарская улица, 1');assert.equal(readListingFormData(data).cityName,'Сочи');
});
