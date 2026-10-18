"use client";
import Link from 'next/link';import {useEffect,useRef,useState} from 'react';
import type {ApplicationSnapshot} from '@/lib/postgres-applications';import {normalizeMessengerHref} from '@/lib/messenger-url';
export const applicationButton='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:text-slate-500';
export const applicationLabels={pending_payment:'Ожидает оплаты',paid:'Оплата подтверждена',sent:'Отправлен',viewed:'Просмотрен',selected:'Исполнитель выбран',rejected:'Отклонён'};
export const applicationTargetHref=(kind:'vacancy'|'workRequest',id:string)=>kind==='vacancy'?`/vakansiya/${id}`:`/rabota/zakazy/${id}`;
type Decision='viewed'|'selected'|'rejected';
export function ApplicationDetail({value,busy,unknown,onDecision,onRefresh,onClose}:{value:ApplicationSnapshot;busy:boolean;unknown:boolean;onDecision:(state:Decision)=>void;onRefresh:()=>void;onClose:()=>void}){
 const [confirm,setConfirm]=useState<'selected'|'rejected'|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[value.id]);
 useEffect(()=>setConfirm(null),[value.id,value.revision,unknown]);
 const actionable=value.view==='recipient'&&['sent','viewed'].includes(value.status),messenger=normalizeMessengerHref(value.snapshot.messengerUrl??undefined);
 return <section className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="application-details-title">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="application-details-title" ref={heading} tabIndex={-1} className="text-xl font-bold text-slate-950">Детали отклика</h2>
   <button type="button" className={applicationButton} disabled={busy||unknown} onClick={onClose}>Закрыть детали</button></div>
  <p className="mt-4 text-sm font-semibold text-slate-700">{applicationLabels[value.status]}</p>
  <Link href={applicationTargetHref(value.target.kind,value.target.id)} className="mt-2 inline-block min-h-11 break-words py-2 font-semibold text-blue-800 underline">{value.target.title}</Link>
  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
   {([['Специалист',value.snapshot.name],['Профессия',value.snapshot.profession],['Стоимость работ',`${value.snapshot.price} ₽`],['Навыки',value.snapshot.skills],['Телефон',value.snapshot.phone],['Email',value.snapshot.email]] as const).map(([label,text])=>text&&<div key={label} className="min-w-0"><dt className="text-slate-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-medium text-slate-950">{text}</dd></div>)}
  </dl>
  {messenger&&<a href={messenger} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-800 underline">Связаться в мессенджере</a>}
  {value.message&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Сообщение</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.message}</p></div>}
  {value.view==='applicant'&&!value.sentAt&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800"><p>Отклик ещё не доставлен владельцу публикации.</p>
   <p className="mt-1">{value.paid?'Оплата подтверждена; отправку должен подтвердить сервер.':'Он ожидает оплаты. Платёжный сценарий в новом кабинете ещё не подключён.'}</p></div>}
  <p className="mt-4 text-sm text-slate-600">В отклике сохранена отдельная копия анкеты. Изменения в профиле не меняют уже отправленные данные.</p>
  <div className="mt-4 flex flex-wrap gap-2">
   <button type="button" className={applicationButton} disabled={busy} onClick={onRefresh}>Проверить отклик</button>
   {actionable&&<>{value.status==='sent'&&<button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>onDecision('viewed')}>Отметить просмотренным</button>}
    <button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>setConfirm('selected')}>Выбрать исполнителя</button>
    <button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>setConfirm('rejected')}>Отклонить отклик</button></>}
  </div>
  {unknown&&<p className="mt-3 text-sm text-slate-700">Результат действия не подтверждён. Сначала нажмите «Проверить отклик».</p>}
  {confirm&&!unknown&&<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4" role="group" aria-label="Подтверждение решения">
   <p className="text-sm text-slate-800">{confirm==='selected'?'Выбрать этого исполнителя?':'Отклонить этот отклик?'} Решение будет отправлено заявителю, отменить его здесь нельзя.</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={applicationButton} disabled={busy} onClick={()=>onDecision(confirm)}>{confirm==='selected'?'Подтвердить выбор':'Подтвердить отказ'}</button>
    <button type="button" className={applicationButton} disabled={busy} onClick={()=>setConfirm(null)}>Отмена</button></div>
  </div>}
 </section>;
}
