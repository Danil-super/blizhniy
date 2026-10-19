"use client";
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseListingFormDraft} from './listing-form-contract.ts';import {parseBookingRequest,type BookingRequestInput,type BookingQuote} from './booking-request-contract.ts';
import {addBookingDays,bookingNightsCount} from './booking-availability.ts';
import type {BookingInventory,BookingSnapshot,BookingSummary,BookingPage} from './postgres-bookings';
type Options={signal?:AbortSignal};type Mode='guest'|'host';
export class BookingClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':
  code==='BOOKING_NOT_FOUND'?'Бронирование недоступно. Обновите данные.':code==='BOOKING_UNAVAILABLE'?'Эти даты или места уже заняты. Выберите другой вариант.':
  code==='BOOKING_INVALID'?'Проверьте даты и количество гостей.':code==='BOOKING_CHANGED'?'Условия уже изменились. Проверьте актуальные данные.':
  code==='BOOKING_BUSY'?'Данные сейчас изменяются. Проверьте заявку перед повторным действием.':'Результат не подтверждён. Проверьте заявку перед повторной отправкой.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;
}
function title(value:unknown):string{if(typeof value!=='string'||!value.length||value.length>160||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value))throw Error();return value;}
const money=(value:unknown)=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/.test(value))throw Error();return value;};
const stamp=(id:string,value:unknown)=>parseListingDraftCursor({id,updatedAt:value})!.updatedAt;
function terms(value:unknown){const booking=parseListingFormDraft({kind:'arenda',booking:value}).booking;if(!booking)throw Error();return booking;}
function publicListing(value:unknown,revision=false){const row=exact(value,revision?['id','title','revision']:['id','title']);return{id:parseListingDraftId(row.id),title:title(row.title),...(revision?{revision:parseListingDraftRevision(row.revision)}:{})};}
function common(value:unknown,detail:boolean):BookingSummary|BookingSnapshot{
 const row=exact(value,['id','revision','view','listing','mode','startDate','endDate','guests','total','status','createdAt',...(detail?['booking','updatedAt','decidedAt']:[])]),id=parseListingDraftId(row.id),listing=publicListing(row.listing);
 const input=parseBookingRequest({listingId:listing.id,creationKey:id,expectedListingRevision:'1',mode:row.mode,startDate:row.startDate,endDate:row.endDate,guests:row.guests});
 const nights=input.mode==='stay'?bookingNightsCount(input.startDate,input.endDate!):0;
 if(input.mode==='stay'&&(!nights||nights<1||nights>30)||row.view!=='guest'&&row.view!=='host'||!['pending','accepted','declined'].includes(row.status as string))throw Error();
 const summary:BookingSummary={id,revision:parseListingDraftRevision(row.revision),view:row.view as Mode,listing,mode:input.mode,startDate:input.startDate,endDate:input.endDate,guests:input.guests,total:money(row.total),status:row.status as BookingSummary['status'],createdAt:stamp(id,row.createdAt)};
 if(!detail)return summary;
 if(row.status==='pending'?row.decidedAt!==null:row.decidedAt===null)throw Error();const booking=terms(row.booking);if(booking.mode!==input.mode)throw Error();
 return{...summary,booking,updatedAt:stamp(id,row.updatedAt),decidedAt:row.decidedAt===null?null:stamp(id,row.decidedAt)};
}
function detail(value:unknown,id?:string):BookingSnapshot{const result=common(value,true) as BookingSnapshot;if(id&&result.id!==id)throw Error();return result;}
export function createBookingsClient(transport:typeof fetch){
 async function send(path:string,body:Record<string,unknown>|null,writing:boolean,options:Options={}):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport(path,{method:body?(writing?'PUT':'POST'):'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    ...(body?{headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)}:{})});
   if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[],decoder=new TextDecoder('utf-8',{fatal:true});let size=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}size+=part.value.byteLength;if(size>262144||chunks.length>=1024)throw Error();chunks.push(part.value);}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const result=JSON.parse(decoder.decode(bytes));
   if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,INVALID_INPUT:422,BOOKING_INVALID:422,RATE_LIMITED:429,BOOKING_NOT_FOUND:404,BOOKING_CHANGED:409,BOOKING_BUSY:409,BOOKING_UNAVAILABLE:409},code=result?.error?.code;
    throw new BookingClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return result;
  }catch(error){if(error instanceof BookingClientError)throw error;throw new BookingClientError('UNKNOWN');}
 }
 const checked=async<T>(work:()=>Promise<T>):Promise<T>=>{try{return await work();}catch(error){if(error instanceof BookingClientError)throw error;throw new BookingClientError('UNKNOWN');}};
 const account=(owner:string,action:string,data:Record<string,unknown>,options?:Options)=>send('/api/account/bookings',{action,expectedOwnerId:parseListingDraftId(owner),...data},['create','decide'].includes(action),options);
 return{
  inventory:(value:string,options?:Options):Promise<BookingInventory>=>checked(async()=>{
   const id=parseListingDraftId(value),row=exact(await send(`/api/listings/${id}/bookings`,null,false,options),['listing','booking','today','occupiedDates','tourSeatsRemaining']),listing=publicListing(row.listing,true) as BookingInventory['listing'],booking=terms(row.booking);
   if(listing.id!==id||typeof row.today!=='string'||!addBookingDays(row.today,0)||!Array.isArray(row.occupiedDates)||row.occupiedDates.length>366)throw Error();
   const today=row.today,last=addBookingDays(today,365)!,occupiedDates:string[]=row.occupiedDates;let previous='';
   for(const day of occupiedDates){if(typeof day!=='string'||!addBookingDays(day,0)||day<today||day>last||day<=previous)throw Error();previous=day;}
   if(booking.mode==='stay'?row.tourSeatsRemaining!==null:occupiedDates.length!==0||!Number.isSafeInteger(row.tourSeatsRemaining)||Number(row.tourSeatsRemaining)<0||Number(row.tourSeatsRemaining)>Number(booking.maxGuests))throw Error();
   return{listing,booking,today,occupiedDates,tourSeatsRemaining:row.tourSeatsRemaining as number|null};
  }),
  preview:(owner:string,value:BookingRequestInput,options?:Options):Promise<{listing:BookingInventory['listing'];quote:BookingQuote}>=>checked(async()=>{
   const input=parseBookingRequest(value),row=exact(await account(owner,'preview',{input},options),['listing','quote']),listing=publicListing(row.listing,true) as BookingInventory['listing'],quote=exact(row.quote,['mode','startDate','endDate','guests','nights','total']);
   if(listing.id!==input.listingId||listing.revision!==input.expectedListingRevision||['mode','startDate','endDate','guests'].some(key=>quote[key]!==input[key as keyof BookingRequestInput])||quote.nights!==(input.mode==='tour'?0:bookingNightsCount(input.startDate,input.endDate!)))throw Error();
   return{listing,quote:{mode:input.mode,startDate:input.startDate,endDate:input.endDate,guests:input.guests,nights:quote.nights as number,total:money(quote.total)}};
  }),
  create:(owner:string,value:BookingRequestInput,options?:Options):Promise<BookingSnapshot>=>checked(async()=>{
   const input=parseBookingRequest(value),saved=detail(await account(owner,'create',{input},options));
   if(saved.view!=='guest'||saved.listing.id!==input.listingId||['mode','startDate','endDate','guests'].some(key=>saved[key as keyof BookingSnapshot]!==input[key as keyof BookingRequestInput]))throw Error();return saved;
  }),
  intent:(owner:string,key:string,options?:Options):Promise<BookingSnapshot|null>=>checked(async()=>{const result=await account(owner,'intent',{creationKey:parseListingDraftId(key)},options);if(result===null)return null;const saved=detail(result);if(saved.view!=='guest')throw Error();return saved;}),
  read:(owner:string,id:string,options?:Options):Promise<BookingSnapshot>=>checked(async()=>detail(await account(owner,'read',{bookingId:parseListingDraftId(id)},options),id)),
  decide:(owner:string,id:string,expected:string,state:'accepted'|'declined',options?:Options):Promise<BookingSnapshot>=>checked(async()=>{
   const revision=parseListingDraftRevision(expected);if(state!=='accepted'&&state!=='declined')throw Error();const saved=detail(await account(owner,'decide',{bookingId:parseListingDraftId(id),expectedRevision:revision,state},options),id);
   if(saved.view!=='host'||saved.status!==state||BigInt(saved.revision)!==BigInt(revision)+BigInt(1))throw Error();return saved;
  }),
  list:(owner:string,mode:Mode,after:ListingDraftCursor|null,options?:Options):Promise<BookingPage>=>checked(async()=>{
   if(mode!=='guest'&&mode!=='host')throw Error();const cursor=parseListingDraftCursor(after),row=exact(await account(owner,'list',{mode,after:cursor},options),['items','nextCursor']);
   if(!Array.isArray(row.items)||row.items.length>20)throw Error();const items=row.items.map(item=>common(item,false) as BookingSummary),next=parseListingDraftCursor(row.nextCursor);let previous=cursor;
   if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();for(const item of items){const current={id:item.id,updatedAt:item.createdAt};if(item.view!==mode||previous&&!(current.updatedAt<previous.updatedAt||current.updatedAt===previous.updatedAt&&current.id<previous.id))throw Error();previous=current;}
   if(next&&(items.length!==20||next.id!==previous?.id||next.updatedAt!==previous.updatedAt))throw Error();return{items,nextCursor:next};
  }),
 };
}
export const productionBookings=createBookingsClient((...args)=>fetch(...args));
