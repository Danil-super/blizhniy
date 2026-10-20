import assert from 'node:assert/strict';import {test} from 'node:test';
import {listingPlacementDefaults} from '../src/lib/listing-placement-defaults.ts';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
test('canonical editing preserves content, exact decimal, private map point and empty draft fields',()=>{
 const form=parseListingFormDraft({kind:'prodam',title:'Стол',description:'Строка\nДругая',price:'199.99',categorySlug:'dlya-doma-i-dachi',subcategoryName:'Мебель',cityName:'Сочи',address:'Адрес',latitude:43.6,longitude:39.7,showExactAddress:false,contactPhone:'+79990000000',messengerUrl:'@example_user'});
 const result=listingPlacementDefaults({id:'unused',revision:'4',form,photos:[]});
 assert.equal(result.price,'199.99');assert.equal(result.description,form.description);assert.equal(result.lat,43.6);assert.equal(result.address,'Адрес');assert.equal(result.showExactAddress,false);assert.equal(result.subcategoryName,'Мебель');
 const empty=listingPlacementDefaults({id:'unused',revision:'1',form:parseListingFormDraft({kind:'kuplyu'}),photos:[]});
 assert.equal(empty.categorySlug,'');assert.equal(empty.city,'');assert.equal(empty.price,'');assert.equal(empty.phone,'');
});
