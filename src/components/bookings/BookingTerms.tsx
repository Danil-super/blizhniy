"use client";
import type {BookingDetails} from '@/lib/types';import {bookingPeriod} from './BookingDetail';
const money=(value:number|undefined)=>value===undefined?undefined:new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value)+' ₽';
const date=(value:string|undefined)=>value?bookingPeriod({startDate:value,endDate:null}):undefined;
/** Public conditions from the approved ad or refreshed anonymous inventory, never an account profile. */
export function BookingTerms({booking}:{booking:BookingDetails}){
 const rows:Array<[string,string|number|undefined]>=booking.mode==='tour'?[
  ['Дата похода',date(booking.tourDate)],['Время',booking.tourTime],['За участника',money(booking.pricePerPerson)],['Всего мест',booking.maxGuests],
  ['Продолжительность',booking.tourDuration],['Сложность',booking.tourDifficulty],['Место встречи',booking.tourMeetingPoint],
 ]:[
  ['Сутки в будни',money(booking.priceWeekday)],['Сутки в выходные',money(booking.priceWeekend)],['Минимум ночей',booking.minNights],['Гостей в цене',booking.includedGuests],
  ['Максимум гостей',booking.maxGuests],['Доп. гость / ночь',money(booking.extraGuestPrice)],['Заезд',booking.checkInTime],['Выезд',booking.checkOutTime],['С первой ночи',date(booking.availableFrom)],['До последней ночи',date(booking.availableTo)],
 ];
 return <div className="mt-3 grid min-w-0 gap-3"><dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">{rows.filter(([,value])=>value!==undefined&&value!=='').map(([label,value])=><div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-950">{value}</dd></div>)}</dl>
  {booking.included&&<p className="whitespace-pre-wrap break-words text-sm text-slate-700">Включено: {booking.included}</p>}
  {booking.rules&&<p className="whitespace-pre-wrap break-words text-sm text-slate-700">Условия: {booking.rules}</p>}
 </div>;
}
