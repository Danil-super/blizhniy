"use client";
import Link from 'next/link';import {useEffect,useRef,useState} from 'react';import type {BookingSnapshot,BookingSummary} from '@/lib/postgres-bookings';
export const bookingButton='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:text-slate-500';
export const bookingLabels={pending:'Ожидает ответа',accepted:'Подтверждено',declined:'Отклонено'};
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
export const bookingPeriod=(value:Pick<BookingSummary,'startDate'|'endDate'>)=>value.endDate?`${date(value.startDate)} — ${date(value.endDate)}`:date(value.startDate);
export function BookingDetail({value,busy,unknown,onDecision,onRefresh,onClose}:{value:BookingSnapshot;busy:boolean;unknown:boolean;onDecision:(state:'accepted'|'declined')=>void;onRefresh:()=>void;onClose:()=>void}){
 const [confirm,setConfirm]=useState<'accepted'|'declined'|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[value.id]);useEffect(()=>setConfirm(null),[value.id,value.revision,unknown]);const actionable=value.view==='host'&&value.status==='pending';
 return <section className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="booking-details-title">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="booking-details-title" ref={heading} tabIndex={-1} className="text-xl font-bold text-slate-950">Детали бронирования</h2>
   <button type="button" className={bookingButton} disabled={busy} onClick={onClose}>Закрыть детали</button></div>
  <p className="mt-4 text-sm font-semibold text-slate-700">{bookingLabels[value.status]}</p>
  <Link href={`/obyavlenie/${value.listing.id}`} className="mt-2 inline-block min-h-11 break-words py-2 font-semibold text-blue-800 underline">{value.listing.title}</Link>
  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[['Даты',bookingPeriod(value)],['Гости',String(value.guests)],['Сумма заявки',`${value.total} ₽`],['Тип',value.mode==='stay'?'Проживание':'Поход / экскурсия']].map(([label,text])=>
   <div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{text}</dd></div>)}</dl>
  {value.booking.included&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Включено</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.booking.included}</p></div>}
  {value.booking.rules&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Условия</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.booking.rules}</p></div>}
  {value.booking.tourMeetingPoint&&<p className="mt-4 break-words text-sm text-slate-700">Место встречи: {value.booking.tourMeetingPoint}</p>}
  <p className="mt-4 text-sm text-slate-600">Это заявка владельцу, а не оплата. Сумма и условия зафиксированы при отправке. {value.status==='pending'?'Дождитесь подтверждения владельца.':''}</p>
  <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={bookingButton} disabled={busy} onClick={onRefresh}>Проверить заявку</button>
   {actionable&&<><button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>setConfirm('accepted')}>Принять заявку</button>
    <button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>setConfirm('declined')}>Отклонить заявку</button></>}</div>
  {unknown&&<p className="mt-3 text-sm text-slate-700">Ответ сервера не получен. Сначала нажмите «Проверить заявку», чтобы не повторить действие.</p>}
  {confirm&&!unknown&&<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4" role="group" aria-label="Подтверждение решения">
   <p className="text-sm text-slate-800">{confirm==='accepted'?'Подтвердить указанные даты и сумму заявки?':'Отклонить заявку и освободить даты?'} Заявитель получит уведомление. Отменить решение здесь нельзя.</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={bookingButton} disabled={busy} onClick={()=>onDecision(confirm)}>{confirm==='accepted'?'Подтвердить бронирование':'Подтвердить отказ'}</button>
    <button type="button" className={bookingButton} disabled={busy} onClick={()=>setConfirm(null)}>Отмена</button></div></div>}
 </section>;
}
