import {ListingDraftInputError,parseListingDraft} from './listing-draft-contract.ts';
import {parseListingPhotoIds,type ListingDraftPhoto} from './listing-photo-contract.ts';
import {normalizeMessengerHref} from './messenger-url.ts';
import type {BookingDetails} from './types';
export type ListingFormDraft={kind:ReturnType<typeof parseListingDraft>['kind'];title:string;description:string;price:string|null;
 categorySlug:string|null;subcategoryName:string|null;cityName:string|null;district:string|null;address:string|null;
 latitude:number|null;longitude:number|null;showExactAddress:boolean;contactPhone:string|null;messengerUrl:string|null;contactMethod?:'messenger';booking:BookingDetails|null;photoIds:string[]};
export type ListingFormSnapshot={id:string;revision:string;form:ListingFormDraft;photos:ListingDraftPhoto[]};
const invalid=()=>{throw new ListingDraftInputError();};
function plain(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid();
 return value as Record<string,unknown>;
}
function text(value:unknown,limit:number):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>limit||!value.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value))return invalid();
 return value.trim()||null;
}
function booking(value:unknown):BookingDetails|null{
 if(value===undefined||value===null)return null;
 const row=plain(value),out:Record<string,unknown>={mode:row.mode};
 if(!['stay','tour'].includes(row.mode as string)||JSON.stringify(row).length>18000)return invalid();
 const money=['priceWeekday','priceWeekend','pricePerPerson','extraGuestPrice'],integers=['minNights','includedGuests','maxGuests'];
 const dates=['availableFrom','availableTo','tourDate'],times=['checkInTime','checkOutTime','tourTime'];
 const strings=['included','rules','tourDuration','tourDifficulty','tourMeetingPoint'];
 const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000-')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 for(const key of Reflect.ownKeys(row)){
  if(typeof key!=='string')return invalid();const v=row[key];if(key==='mode')continue;
  if(money.includes(key)||integers.includes(key)){
   if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>9999999999.99||(integers.includes(key)&&(!Number.isSafeInteger(v)||v<1)))return invalid();out[key]=v;
  }else if(dates.includes(key)){if(v==='')continue;if(!date(v))return invalid();out[key]=v;}
  else if(times.includes(key)){if(v==='')continue;if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return invalid();out[key]=v;}
  else if(strings.includes(key)){
   if(typeof v!=='string'||v.length>500||!v.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))return invalid();out[key]=v.trim();
  }else if(key==='blockedDates'){if(!Array.isArray(v)||v.length>730||v.some(item=>!date(item)))return invalid();out[key]=v;}
  else return invalid();
 }
 return out as BookingDetails;
}
/** Full private draft only. References resolve against PostgreSQL inside the owner transaction. */
export function parseListingFormDraft(value:unknown):ListingFormDraft{
 const row=plain(value),allowed=['kind','title','description','price','categorySlug','subcategoryName','cityName','district','address','latitude','longitude','showExactAddress','contactPhone','messengerUrl','contactMethod','booking','photoIds'];
 if(Reflect.ownKeys(row).some(key=>typeof key!=='string'||!allowed.includes(key)))return invalid();
 const core=parseListingDraft({kind:row.kind,...(Object.hasOwn(row,'title')?{title:row.title}:{}),...(Object.hasOwn(row,'description')?{description:row.description}:{}),...(Object.hasOwn(row,'price')?{price:row.price}:{})});
 const categorySlug=text(row.categorySlug,150),subcategoryName=text(row.subcategoryName,160);
 if((categorySlug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug))||(!categorySlug&&subcategoryName))return invalid();
 const coordinate=(field:string,max:number)=>{const v=row[field];if(v===undefined||v===null)return null;
  if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>max)return invalid();return v;};
 const latitude=coordinate('latitude',90),longitude=coordinate('longitude',180),showExactAddress=row.showExactAddress??false;
 if(typeof showExactAddress!=='boolean'||(latitude===null)!==(longitude===null)||(showExactAddress&&latitude===null))return invalid();
 const messenger=text(row.messengerUrl,500),messengerUrl=messenger?normalizeMessengerHref(messenger):null;if(messenger&&!messengerUrl)return invalid();
 if(row.contactMethod!==undefined&&row.contactMethod!=='phone'&&row.contactMethod!=='messenger')return invalid();
 return{kind:core.kind,title:core.title,description:core.description,price:core.price,categorySlug,subcategoryName,cityName:text(row.cityName,160),
  district:text(row.district,160),address:text(row.address,300),latitude,longitude,showExactAddress,contactPhone:text(row.contactPhone,40),messengerUrl:messengerUrl??null,
  ...(row.contactMethod==='messenger'?{contactMethod:'messenger' as const}:{}),booking:booking(row.booking),photoIds:parseListingPhotoIds(row.photoIds??[])};
}
