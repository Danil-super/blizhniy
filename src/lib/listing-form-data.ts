import {parseListingFormDraft} from './listing-form-contract.ts';
import {parseListingBookingFormData} from './listing-rental.ts';
import {cities} from './data.ts';
export function readListingFormData(data:FormData){
 const read=(name:string)=>String(data.get(name)??'').trim();
 const exact=read('locationMode')==='exact'&&read('mapPointSelected')==='1',address=read('address');
 const point=exact||read('privateMapPoint')==='1';
 const selectedCity=read('location').split(',')[0].trim(),cityFromAddress=cities.find(city=>{
  const name=city.name.toLocaleLowerCase('ru').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(^|[^\\p{L}])${name}($|[^\\p{L}])`,'u').test(address.toLocaleLowerCase('ru'));
 })?.name;
 const cityName=(exact?cityFromAddress||selectedCity:selectedCity||cityFromAddress)||null;
 const rawPrice=read('price').replace(/\s/g,'').replace(',','.');
 const form=parseListingFormDraft({kind:read('kind')||'prodam',title:read('title'),description:String(data.get('description')??''),price:rawPrice||null,
  categorySlug:read('category')||null,subcategoryName:read('subcategoryName')||null,cityName,district:read('district')||null,address:point?address:null,
  latitude:point&&read('lat')?Number(read('lat').replace(',','.')):null,longitude:point&&read('lng')?Number(read('lng').replace(',','.')):null,
  showExactAddress:exact,contactPhone:read('phone')||null,messengerUrl:read('messengerUrl')||null,contactMethod:read('contactMethod')||'phone',photoIds:data.getAll('savedPhotoIds').map(String)});
 const booking=parseListingBookingFormData(data,form.categorySlug??'',form.kind,{draft:true});
 return parseListingFormDraft({...form,booking:booking?JSON.parse(JSON.stringify(booking)):null});
}
