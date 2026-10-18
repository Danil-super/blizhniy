import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingFormDraft} from './listing-form-contract.ts';
import {parseBookingDate,addBookingDays,bookingNightsCount,MAX_BOOKING_NIGHTS,MAX_BOOKING_LEAD_DAYS} from './booking-availability.ts';
import type {BookingDetails} from './types';
export type BookingRequestInput={listingId:string;creationKey:string;expectedListingRevision:string;mode:'stay'|'tour';startDate:string;endDate:string|null;guests:number};
export type BookingQuote=Pick<BookingRequestInput,'mode'|'startDate'|'endDate'|'guests'>&{nights:number;total:string};
export class BookingRequestInputError extends Error{constructor(){super('Invalid booking request');this.name='BookingRequestInputError';}}
export class BookingQuoteError extends Error{constructor(){super('Booking quote unavailable');this.name='BookingQuoteError';}}
const date=(value:unknown):string=>{if(typeof value!=='string'||value.startsWith('0000-')||!parseBookingDate(value))throw Error();return value;};
/** Price, guest identity, snapshot and acceptance never come from this envelope. */
export function parseBookingRequest(value:unknown):BookingRequestInput{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
  const row=value as Record<string,unknown>,keys=['listingId','creationKey','expectedListingRevision','mode','startDate','endDate','guests'];
  if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||row.mode!=='stay'&&row.mode!=='tour'||!Number.isSafeInteger(row.guests)||Number(row.guests)<1||Number(row.guests)>1000)throw Error();
  if(row.mode==='tour'&&row.endDate!==null)throw Error();const endDate=row.mode==='tour'?null:date(row.endDate);
  return{listingId:parseListingDraftId(row.listingId),creationKey:parseListingDraftId(row.creationKey),expectedListingRevision:parseListingDraftRevision(row.expectedListingRevision),mode:row.mode,startDate:date(row.startDate),endDate,guests:row.guests as number};
 }catch{throw new BookingRequestInputError();}
}
function cents(value:number|undefined,positive=true):bigint{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>9999999999.99)throw Error();
 const rendered=String(value);if(!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(rendered))throw Error();
 const [whole,fraction='']=rendered.split('.'),result=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));if(positive&&result===BigInt(0))throw Error();return result;
}
const integer=(value:number|undefined):number=>{if(!Number.isSafeInteger(value)||value===undefined||value<1)throw Error();return value;};
const rubles=(value:bigint)=>`${value/BigInt(100)}.${String(value%BigInt(100)).padStart(2,'0')}`;
/** Pure quote only. Caller supplies the server's Moscow calendar day and must lock/recheck actual availability separately. */
export function quoteBookingRequest(details:BookingDetails,input:BookingRequestInput,today:string):BookingQuote{
 try{
  const request=parseBookingRequest(input),booking=parseListingFormDraft({kind:'arenda',booking:details}).booking;
  const first=date(today),last=date(addBookingDays(first,MAX_BOOKING_LEAD_DAYS)),{startDate,endDate,guests,mode}=request;
  if(!booking||booking.mode!==mode||startDate<first||startDate>last||guests>integer(booking.maxGuests))throw Error();
  if(mode==='tour'){
   if(startDate!==date(booking.tourDate))throw Error();return{mode,startDate,endDate:null,guests,nights:0,total:rubles(cents(booking.pricePerPerson)*BigInt(guests))};
  }
  const nights=bookingNightsCount(startDate,endDate??undefined),minimum=integer(booking.minNights),included=integer(booking.includedGuests);
  if(!endDate||!nights||nights<minimum||nights>MAX_BOOKING_NIGHTS||endDate>date(addBookingDays(last,1))||included>integer(booking.maxGuests)||
   booking.availableFrom&&startDate<date(booking.availableFrom)||booking.availableTo&&endDate>date(addBookingDays(date(booking.availableTo),1)))throw Error();
  const weekday=cents(booking.priceWeekday),weekend=cents(booking.priceWeekend),extra=cents(booking.extraGuestPrice??0,false),blocked=new Set(booking.blockedDates??[]);let total=BigInt(0);
  for(let n=0;n<nights;n++){const night=addBookingDays(startDate,n)!;if(blocked.has(night))throw Error();const day=parseBookingDate(night)!.getUTCDay();total+=day===0||day===6?weekend:weekday;}
  total+=BigInt(Math.max(0,guests-included))*BigInt(nights)*extra;return{mode,startDate,endDate,guests,nights,total:rubles(total)};
 }catch{throw new BookingQuoteError();}
}
