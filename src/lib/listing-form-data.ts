import {parseListingFormDraft} from './listing-form-contract.ts';
import {parseListingBookingFormData} from './listing-rental.ts';
import {cities} from './data.ts';
export function readListingFormData(data:FormData){
 const read=(name:string)=>String(data.get(name)??'').trim();
 const exact=read('locationMode')==='exact'&&read('mapPointSelected')==='1',address=read('address');
 const cityName=read('location').split(',')[0].trim()||cities.find(city=>address.toLocaleLowerCase('ru').includes(city.name.toLocaleLowerCase('ru')))?.name||null;
 const rawPrice=read('price').replace(/\s/g,'').replace(',','.');
 const form=parseListingFormDraft({kind:read('kind')||'prodam',title:read('title'),description:String(data.get('description')??''),price:rawPrice||null,
  categorySlug:read('category')||null,subcategoryName:read('subcategoryName')||null,cityName,address:exact?address:null,
  latitude:exact?Number(read('lat').replace(',','.')):null,longitude:exact?Number(read('lng').replace(',','.')):null,
  showExactAddress:exact,contactPhone:read('phone')||null,messengerUrl:read('messengerUrl')||null});
 const booking=parseListingBookingFormData(data,form.categorySlug??'',form.kind);
 return parseListingFormDraft({...form,booking:booking?JSON.parse(JSON.stringify(booking)):null});
}
