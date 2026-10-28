import assert from 'node:assert/strict';import {test} from 'node:test';
import {cabinetFieldIssue} from '../src/lib/cabinet-form-validation.ts';
for(const name of ['price','salary','budget','bookingPriceWeekday','bookingExtraGuestPrice'])test(`${name} money has bounded decimal format`,()=>{
 for(const value of ['123e4','-1','abc','10000000000','1.001'])assert.ok(cabinetFieldIssue(name,value));
 for(const value of ['','1500','1500,50','0.05'])assert.equal(cabinetFieldIssue(name,value),'');
});
test('field policy covers names, references, contacts, requisites, text and passwords without a global destructive sanitizer',()=>{
 for(const [name,value] of [['name','Иван123'],['contactPerson','<b>Иван</b>'],['phone','123abc'],['email','bad-email'],['website','javascript:alert(1)'],['inn','abc123'],['ogrn','123'],['profession','Неизвестная профессия'],['description','<script>x</script>'],['skills','Текст\u202e'],['bookingMaxGuests','2.5']])assert.ok(cabinetFieldIssue(name,value),name);
 for(const [name,value] of [['name',"О'Коннор"],['title','Комод 120 × 80'],['description','Ремонт №2: 50%, 3 < 5; x < y.'],['phone','+7 (900) 000-00-00'],['email','name+tag@example.ru'],['profession','Сантехник'],['password','<b>my complex p@ss</b>']])assert.equal(cabinetFieldIssue(name,value),'',name);
});
