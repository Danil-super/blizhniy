"use client";
import Link from 'next/link';import {useEffect,useRef,useState} from 'react';import type {BookingSnapshot,BookingSummary} from '@/lib/postgres-bookings';
export const bookingButton='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:text-slate-500';
export const bookingLabels={pending:'Ожидает ответа',accepted:'Подтверждено',declined:'Отклонено',cancelled:'Отменено',expired:'Срок ожидания истёк'};
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
export const bookingPeriod=(value:Pick<BookingSummary,'startDate'|'endDate'>)=>value.endDate?`${date(value.startDate)} — ${date(value.endDate)}`:date(value.startDate);
export function BookingDetail({value,busy,unknown,onDecision,onCancel,onRefresh,onClose}:{value:BookingSnapshot;busy:boolean;unknown:boolean;onDecision:(state:'accepted'|'declined')=>void;onCancel?:(reason:string)=>void;onRefresh:()=>void;onClose:()=>void}){
 const [confirm,setConfirm]=useState<'accepted'|'declined'|'cancelled'|null>(null),[reason,setReason]=useState(''),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[value.id]);useEffect(()=>setConfirm(null),[value.id,value.revision,unknown]);const actionable=value.view==='host'&&value.status==='pending';
 return <section className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="booking-details-title">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="booking-details-title" ref={heading} tabIndex={-1} className="text-xl font-bold text-slate-950">Детали бронирования</h2>
   <button type="button" className={bookingButton} disabled={busy} onClick={onClose}>Закрыть детали</button></div>
  <p className="mt-4 text-sm font-semibold text-slate-700">{bookingLabels[value.status]}</p>
  {value.lifecycle&&value.status==='pending'&&<p className="mt-2 text-sm text-slate-600">Ответ владельца ожидается до {new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(value.lifecycle.expiresAt))} мск. Затем даты освободятся автоматически.</p>}
  {value.lifecycle?.cancellationReason&&<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{value.lifecycle.cancelledBy==='guest'?'Гость отменил бронирование':'Владелец отменил бронирование'}</p><p className="mt-1 break-words">{value.lifecycle.cancellationReason}</p></div>}
  <Link href={`/obyavlenie/${value.listing.id}`} className="mt-2 inline-block min-h-11 break-words py-2 font-semibold text-blue-800 underline">{value.listing.title}</Link>
  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[['Даты',bookingPeriod(value)],['Гости',String(value.guests)],['Сумма заявки',`${value.total} ₽`],['Тип',value.mode==='stay'?'Проживание':'Поход / экскурсия']].map(([label,text])=>
   <div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{text}</dd></div>)}</dl>
  {value.booking.included&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Включено</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.booking.included}</p></div>}
  {value.booking.rules&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Условия</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.booking.rules}</p></div>}
  {value.booking.tourMeetingPoint&&<p className="mt-4 break-words text-sm text-slate-700">Место встречи: {value.booking.tourMeetingPoint}</p>}
  <p className="mt-4 text-sm text-slate-600">Это заявка владельцу, а не оплата. Сумма и условия зафиксированы при отправке. {value.status==='pending'?'Дождитесь подтверждения владельца.':''}</p>
  <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={bookingButton} disabled={busy} onClick={onRefresh}>Проверить заявку</button>
   {actionable&&<><button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>setConfirm('accepted')}>Принять заявку</button>
    <button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>setConfirm('declined')}>Отклонить заявку</button></>}
   {value.lifecycle?.canCancel&&onCancel&&<button type="button" className={bookingButton} disabled={busy||unknown} onClick={()=>{setReason('');setConfirm('cancelled');}}>Отменить бронирование</button>}</div>
  {unknown&&<p className="mt-3 text-sm text-slate-700">Ответ сервера не получен. Сначала нажмите «Проверить заявку», чтобы не повторить действие.</p>}
  {confirm&&!unknown&&<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4" role="group" aria-label="Подтверждение решения">
   <p className="text-sm text-slate-800">{confirm==='cancelled'?'Отменить бронирование и освободить даты? Вторая сторона получит причину отмены.':confirm==='accepted'?'Подтвердить указанные даты и сумму заявки? Гость получит уведомление.':'Отклонить заявку и освободить даты? Гость получит уведомление.'}</p>
   {confirm==='cancelled'&&<div className="mt-3"><label htmlFor="booking-cancellation-reason" className="text-sm font-semibold text-slate-800">Причина отмены</label><textarea id="booking-cancellation-reason" maxLength={500} rows={3} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950" aria-describedby="booking-reason-count"/><p id="booking-reason-count" className="mt-1 text-right text-xs text-slate-600">{reason.length}/500</p></div>}
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={bookingButton} disabled={busy||confirm==='cancelled'&&!reason.trim()} onClick={()=>confirm==='cancelled'?onCancel?.(reason):onDecision(confirm)}>{confirm==='cancelled'?'Подтвердить отмену':confirm==='accepted'?'Подтвердить бронирование':'Подтвердить отказ'}</button>
    <button type="button" className={bookingButton} disabled={busy} onClick={()=>setConfirm(null)}>Отмена</button></div></div>}
 </section>;
}
