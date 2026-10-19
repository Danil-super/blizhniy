import {parseBookingRequest,quoteBookingRequest,type BookingRequestInput} from './booking-request-contract.ts';
import {addBookingDays,bookingNightsCount,parseBookingDate} from './booking-availability.ts';
import type {BookingInventory,BookingSnapshot} from './postgres-bookings';
export type BookingSelection={startDate:string;endDate:string;guests:string};
export type BookingSelectionIssues=Partial<Record<keyof BookingSelection|'general',string>>;
/** Field feedback only; the server preview/create always rechecks price, dates and actual inventory. */
export function validateBookingSelection(inventory:BookingInventory,selection:BookingSelection,creationKey:string):{input:BookingRequestInput|null;issues:BookingSelectionIssues}{
 const {booking,today,occupiedDates}=inventory,{startDate,endDate}=selection,issues:BookingSelectionIssues={},last=addBookingDays(today,365)!,guests=Number(selection.guests);
 if(!/^[1-9]\d{0,3}$/.test(selection.guests)||!Number.isSafeInteger(guests)||guests>Math.min(booking.maxGuests??0,1000))issues.guests='Укажите целое число гостей в пределах вместимости.';
 if(!parseBookingDate(startDate)||startDate<today||startDate>last)issues.startDate='Выберите доступную дату не раньше сегодняшней.';
 if(booking.mode==='tour'){
  if(startDate!==booking.tourDate)issues.startDate='Дата похода указана в объявлении и не может быть изменена.';
  if(guests>(inventory.tourSeatsRemaining??0))issues.guests='На поход осталось меньше свободных мест. Уменьшите число участников.';
 }else{
  const occupied=new Set([...occupiedDates,...booking.blockedDates??[]]),nights=bookingNightsCount(startDate,endDate);
  if(booking.availableFrom&&startDate<booking.availableFrom||booking.availableTo&&startDate>booking.availableTo||occupied.has(startDate))issues.startDate='Эта дата заезда недоступна. Выберите другую.';
  if(!parseBookingDate(endDate)||!nights||nights<(booking.minNights??1)||nights>30||endDate>addBookingDays(last,1)!||booking.availableTo&&endDate>addBookingDays(booking.availableTo,1)!)issues.endDate=`Выберите дату выезда: от ${booking.minNights??1} до 30 ночей в доступном периоде.`;
  if(!issues.startDate&&!issues.endDate)for(let offset=0;offset<nights!;offset++)if(occupied.has(addBookingDays(startDate,offset)!)){issues.endDate='В выбранном периоде есть занятые ночи. Измените даты.';break;}
 }
 if(Object.keys(issues).length)return{input:null,issues};
 try{const input=parseBookingRequest({listingId:inventory.listing.id,creationKey,expectedListingRevision:inventory.listing.revision,mode:booking.mode,startDate,endDate:booking.mode==='tour'?null:endDate,guests});
  quoteBookingRequest(booking,input,today);return{input,issues};
 }catch{return{input:null,issues:{general:'Условия бронирования недоступны. Обновите доступность и повторите расчёт.'}};}
}
/** A successful readback is not proof of this submission unless its immutable selection matches. */
export function bookingMatchesSelection(saved:Pick<BookingSnapshot,'view'|'listing'|'mode'|'startDate'|'endDate'|'guests'>,input:BookingRequestInput):boolean{
 return saved.view==='guest'&&saved.listing.id===input.listingId&&saved.mode===input.mode&&saved.startDate===input.startDate&&saved.endDate===input.endDate&&saved.guests===input.guests;
}
