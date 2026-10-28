"use client";
import Link from 'next/link';import {useEffect,useRef,useState} from 'react';
import type {ApplicationSnapshot} from '@/lib/postgres-applications';import {normalizeMessengerHref} from '@/lib/messenger-url';
export const applicationButton='inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:text-slate-500';
export const applicationLabels={pending_payment:'Ожидает оплаты',paid:'Оплата подтверждена',sent:'Отправлен',viewed:'Просмотрен',selected:'Исполнитель выбран',rejected:'Отклонён'};
export const applicationTargetHref=(kind:'vacancy'|'workRequest',id:string)=>kind==='vacancy'?`/vakansiya/${id}`:`/rabota/zakazy/${id}`;
type Decision='viewed'|'selected'|'rejected';
export function ApplicationDetail({value,busy,unknown,onDecision,onRefresh,onClose,onEdit,onWithdraw,local=false}:{value:ApplicationSnapshot;busy:boolean;unknown:boolean;onDecision:(state:Decision)=>void;onRefresh:()=>void;onClose:()=>void;onEdit?:()=>void;onWithdraw?:()=>void;local?:boolean}){
 const [confirm,setConfirm]=useState<'selected'|'rejected'|null>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[value.id]);
 useEffect(()=>setConfirm(null),[value.id,value.revision,unknown]);
 const actionable=value.view==='recipient'&&['sent','viewed'].includes(value.status),messenger=normalizeMessengerHref(value.snapshot.messengerUrl??undefined);
  const digits=value.snapshot.phone?.replace(/\D/g,'')??'';
  const phone=/^[78]\d{10}$/.test(digits)?`+7${digits.slice(1)}`:/^\d{10}$/.test(digits)?`+7${digits}`:null;
  return <section className="mx-auto mt-5 w-full min-w-0 max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="application-details-title">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="application-details-title" ref={heading} tabIndex={-1} className="text-xl font-bold text-slate-950">Детали отклика</h2>
   <button type="button" className={applicationButton} disabled={busy||unknown} onClick={onClose}>Закрыть детали</button></div>
  <p className="mt-4 text-sm font-semibold text-slate-700">{value.withdrawn?'Отозван':value.targetClosed&&!value.sentAt?'Заказ закрыт':applicationLabels[value.status]}</p>
  <Link href={applicationTargetHref(value.target.kind,value.target.id)} className="mt-2 inline-block min-h-11 break-words py-2 font-semibold text-blue-800 underline">{value.target.title}</Link>
   <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5">
    <div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-bold text-blue-800">{value.snapshot.name.slice(0,1)}</span>
     <div className="min-w-0"><h3 className="break-words text-xl font-bold text-slate-950">{value.snapshot.name}</h3><p className="mt-1 break-words text-sm text-slate-700">{value.snapshot.profession}</p></div></div>
    <p className="mt-4 font-semibold text-slate-950">Стоимость работ: {new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value.snapshot.price))} ₽</p>
    {(value.snapshot.about??value.snapshot.skills)&&<div className="mt-4"><h4 className="text-sm font-semibold text-slate-950">О себе</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{value.snapshot.about??value.snapshot.skills}</p></div>}
    <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
     {phone&&<a href={`tel:${phone}`} className={`${applicationButton} min-w-0 break-all`}>{value.snapshot.phone}</a>}
     {value.snapshot.email&&<a href={`mailto:${encodeURIComponent(value.snapshot.email)}`} className={`${applicationButton} min-w-0 break-all`}>{value.snapshot.email}</a>}
    </div>
   </div>
  {messenger&&<a href={messenger} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-800 underline">Связаться в мессенджере</a>}
  {value.message&&<div className="mt-4"><h3 className="font-semibold text-slate-950">Сообщение</h3><p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{value.message}</p></div>}
  {value.view==='applicant'&&!value.sentAt&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800"><p>{value.withdrawn?'Отклик отозван и не будет доставлен.':'Отклик ещё не доставлен владельцу публикации.'}</p>
   {!value.withdrawn&&<p className="mt-1">{value.targetClosed?'Заказчик уже выбрал исполнителя. Новая оплата и доставка отклика недоступны. История платежа, если он был начат, сохранена.':value.paid?'Оплата подтверждена; отправку должен подтвердить сервер.':local?'Продолжите локальную TEST-оплату. Если платёж уже начат, правки и отзыв недоступны до подтверждённой отмены.':'Он ожидает оплаты. Платёжный сценарий в новом кабинете ещё не подключён.'}</p>}</div>}
  <p className="mt-4 text-sm text-slate-600">В отклике сохранена отдельная копия анкеты. Изменения в профиле не меняют уже отправленные данные.</p>
  <div className="mt-4 flex flex-wrap gap-2">
    {unknown&&<button type="button" className={applicationButton} disabled={busy} onClick={onRefresh}>Проверить отклик</button>}
   {onEdit&&!value.targetClosed&&!value.withdrawn&&value.view==='applicant'&&value.status==='pending_payment'&&!value.paid&&!value.sentAt&&<button type="button" className={applicationButton} disabled={busy||unknown} onClick={onEdit}>Редактировать</button>}
   {onWithdraw&&!value.withdrawn&&value.view==='applicant'&&value.status==='pending_payment'&&!value.paid&&!value.sentAt&&<button type="button" className={applicationButton} disabled={busy||unknown} onClick={onWithdraw}>Отозвать отклик</button>}
   {actionable&&<>{value.status==='sent'&&<button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>onDecision('viewed')}>Отметить просмотренным</button>}
    <button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>setConfirm('selected')}>Выбрать исполнителя</button>
    <button type="button" className={applicationButton} disabled={busy||unknown} onClick={()=>setConfirm('rejected')}>Отклонить отклик</button></>}
  </div>
  {unknown&&<p className="mt-3 text-sm text-slate-700">Результат действия не подтверждён. Сначала нажмите «Проверить отклик».</p>}
  {confirm&&!unknown&&<div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4" role="group" aria-label="Подтверждение решения">
    <p className="text-sm text-slate-800">{confirm==='selected'?`Выбрать этого исполнителя? ${local&&value.target.kind==='workRequest'?'Заказ исчезнет из каталога, остальные специалисты получат уведомление о выборе другого исполнителя. ':''}`:'Отклонить этот отклик? '}Решение будет отправлено заявителю, отменить его здесь нельзя.</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={applicationButton} disabled={busy} onClick={()=>onDecision(confirm)}>{confirm==='selected'?'Подтвердить выбор':'Подтвердить отказ'}</button>
    <button type="button" className={applicationButton} disabled={busy} onClick={()=>setConfirm(null)}>Отмена</button></div>
  </div>}
 </section>;
}
