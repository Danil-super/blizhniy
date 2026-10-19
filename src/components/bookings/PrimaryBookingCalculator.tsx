"use client";
import {useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';import Link from 'next/link';
import type {AccountAuthSnapshot} from '@/lib/account-session-state';import {notifyAccountSessionChange} from '@/lib/local-account';
import {productionBookings,BookingClientError} from '@/lib/client-bookings';import {validateBookingSelection,bookingMatchesSelection,type BookingSelectionIssues} from '@/lib/booking-selection';
import {addBookingDays,bookingNightsCount,type BookingAvailability} from '@/lib/booking-availability';
import type {BookingRequestInput,BookingQuote} from '@/lib/booking-request-contract';import type {BookingInventory,BookingSnapshot} from '@/lib/postgres-bookings';import type {BookingDetails} from '@/lib/types';
import {bookingButton} from './BookingDetail';
import {BookingTerms} from './BookingTerms';
export type PrimaryBookingCalendarProps={booking:BookingDetails;today?:string;startDate:string;endDate:string;listingId:string;requests:BookingAvailability[];selectedDates:Set<string>;onDateClick:(day:string)=>void};
type Calendar=(props:PrimaryBookingCalendarProps)=>ReactNode;
type Confirmation={input:BookingRequestInput;quote:BookingQuote;phase:'quoted'|'unknown'|'retry'};
const inputStyle='mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100';
const primaryButton='inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600';

function Workspace({owner,listingId,visible,renderCalendar}:{owner:string;listingId:string;visible:boolean;renderCalendar:Calendar}){
 const [inventory,setInventory]=useState<BookingInventory|null>(null),[fresh,setFresh]=useState(false),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[guests,setGuests]=useState('1');
 const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[saved,setSaved]=useState<BookingSnapshot|null>(null),[issues,setIssues]=useState<BookingSelectionIssues>({}),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),pending=useRef<object|null>(null),start=useRef<HTMLInputElement>(null),end=useRef<HTMLInputElement>(null),people=useRef<HTMLInputElement>(null),alert=useRef<HTMLParagraphElement>(null),success=useRef<HTMLHeadingElement>(null),prefix=useId();
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>)=>{
  const current=controller.current;if(!current||current.signal.aborted||pending.current)return;const attempt={};pending.current=attempt;setBusy(true);setMessage(null);
  try{await work(current.signal);}catch(error){if(!current.signal.aborted){setMessage(error instanceof Error?error.message:'Не удалось выполнить действие.');if(error instanceof BookingClientError&&error.code==='UNAUTHENTICATED')notifyAccountSessionChange(false);}}
  finally{if(pending.current===attempt){pending.current=null;if(!current.signal.aborted)setBusy(false);}}
 },[]);
 const load=useCallback(async(signal:AbortSignal)=>{
  setFresh(false);const value=await productionBookings.inventory(listingId,{signal});if(signal.aborted)return;setInventory(value);setFresh(true);setConfirmation(null);if(value.booking.mode==='tour')setStartDate(value.booking.tourDate!);
 },[listingId]);
 useEffect(()=>{const current=new AbortController();controller.current=current;void run(load);return()=>{current.abort();pending.current=null;};},[load,run]);
 useEffect(()=>{if(message)alert.current?.focus();},[message]);useEffect(()=>{if(saved)success.current?.focus();},[saved]);
 const locked=busy||!!confirmation&&confirmation.phase!=='quoted',selection={startDate,endDate,guests};
 function change(field:'startDate'|'endDate'|'guests',value:string){if(!visible||locked||saved)return;({startDate:setStartDate,endDate:setEndDate,guests:setGuests}[field])(value);setConfirmation(null);setMessage(null);setIssues(current=>({...current,[field]:undefined,general:undefined}));}
 function pick(day:string){if(!startDate||endDate||day<=startDate){change('startDate',day);change('endDate','');}else change('endDate',day);}
 function preview(){if(!visible||!inventory||!fresh||locked||saved)return;const result=validateBookingSelection(inventory,selection,crypto.randomUUID());setIssues(result.issues);
  if(!result.input){(result.issues.startDate?start:result.issues.endDate?end:people).current?.focus();return;}const input=result.input;
  void run(async signal=>{try{const result=await productionBookings.preview(owner,input,{signal});if(!signal.aborted)setConfirmation({input,quote:result.quote,phase:'quoted'});}
   catch(error){if(!signal.aborted&&error instanceof BookingClientError&&['BOOKING_CHANGED','BOOKING_NOT_FOUND','BOOKING_UNAVAILABLE'].includes(error.code))setFresh(false);throw error;}});
 }
 function submit(){if(!visible||!confirmation||confirmation.phase==='unknown'||saved)return;const original=confirmation;
  void run(async signal=>{setConfirmation({...original,phase:'unknown'});try{const value=await productionBookings.create(owner,original.input,{signal});if(!signal.aborted){setSaved(value);setConfirmation(null);}}
   catch(error){if(!signal.aborted&&original.phase==='quoted'&&error instanceof BookingClientError&&error.code!=='UNKNOWN'){setConfirmation(null);setFresh(false);}throw error;}});
 }
 function recover(){if(!visible||confirmation?.phase!=='unknown')return;const original=confirmation;
  void run(async signal=>{const value=await productionBookings.intent(owner,original.input.creationKey,{signal});if(signal.aborted)return;
   if(value){if(!bookingMatchesSelection(value,original.input))throw new BookingClientError('UNKNOWN');setSaved(value);setConfirmation(null);}
   else{setConfirmation({...original,phase:'retry'});setMessage('Заявка пока не найдена. Можно повторить только ту же отправку; даты и ключ сохранены.');}});
 }
 const dates=new Set<string>(),nights=bookingNightsCount(startDate,endDate);if(nights&&nights>0&&nights<=30)for(let offset=0;offset<nights;offset++)dates.add(addBookingDays(startDate,offset)!);
 const requests:BookingAvailability[]=inventory?.occupiedDates.map(day=>({listingId,startDate:day,endDate:addBookingDays(day,1),guests:1,status:'accepted'}))??[];
 return <div hidden={!visible} inert={!visible} className="mt-4 min-w-0" aria-busy={busy}>
  {saved?<div className="rounded-xl border border-green-200 bg-green-50 p-4"><h3 ref={success} tabIndex={-1} className="font-semibold text-green-900">Заявка отправлена владельцу.</h3><p className="mt-2 text-sm text-slate-800">Ожидайте ответа в личном кабинете. Это заявка, деньги не списаны.</p><Link href="/cabinet/bronirovaniya" className={`${bookingButton} mt-4`}>Открыть бронирования</Link></div>:<>
   {busy&&<p role="status" className="mb-3 text-sm text-slate-700">Проверяем данные…</p>}
   {message&&<p ref={alert} tabIndex={-1} role="alert" className="mb-3 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
   {!busy&&!fresh&&<button type="button" className={`${bookingButton} mb-4`} disabled={locked} onClick={()=>{if(visible&&!locked)void run(load);}}>Обновить доступность</button>}
   {inventory&&<form noValidate onSubmit={event=>{event.preventDefault();preview();}} className="grid min-w-0 gap-4">
    <BookingTerms booking={inventory.booking}/>
    {inventory.booking.mode==='stay'?<>
     <fieldset disabled={locked} className="min-w-0"><legend className="mb-2 text-sm font-semibold text-slate-950">Выберите даты проживания</legend>{renderCalendar({booking:inventory.booking,today:inventory.today,listingId,requests,selectedDates:dates,startDate,endDate,onDateClick:pick})}</fieldset>
     <label className="min-w-0 text-sm font-semibold text-slate-950">Дата заезда<input ref={start} aria-label="Дата заезда" type="date" required value={startDate} disabled={locked} onChange={event=>change('startDate',event.target.value)} aria-invalid={!!issues.startDate} aria-describedby={issues.startDate?`${prefix}-start`:undefined} className={inputStyle}/>{issues.startDate&&<span id={`${prefix}-start`} className="mt-1 block text-sm font-normal text-rose-800">{issues.startDate}</span>}</label>
     <label className="min-w-0 text-sm font-semibold text-slate-950">Дата выезда<input ref={end} aria-label="Дата выезда" type="date" required value={endDate} disabled={locked} onChange={event=>change('endDate',event.target.value)} aria-invalid={!!issues.endDate} aria-describedby={issues.endDate?`${prefix}-end`:undefined} className={inputStyle}/>{issues.endDate&&<span id={`${prefix}-end`} className="mt-1 block text-sm font-normal text-rose-800">{issues.endDate}</span>}</label>
    </>:<><p className="text-sm text-slate-800">Свободных мест: {inventory.tourSeatsRemaining}.</p>{issues.startDate&&<p role="alert" className="text-sm text-rose-800">{issues.startDate}</p>}</>}
    <label className="min-w-0 text-sm font-semibold text-slate-950">Количество гостей<input ref={people} aria-label="Количество гостей" type="number" inputMode="numeric" min={1} max={inventory.booking.maxGuests} step={1} required value={guests} disabled={locked} onChange={event=>change('guests',event.target.value)} aria-invalid={!!issues.guests} aria-describedby={issues.guests?`${prefix}-guests`:undefined} className={inputStyle}/>{issues.guests&&<span id={`${prefix}-guests`} className="mt-1 block text-sm font-normal text-rose-800">{issues.guests}</span>}</label>
    {issues.general&&<p role="alert" className="text-sm text-rose-800">{issues.general}</p>}
    {confirmation?<div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-semibold text-slate-950">Сумма заявки: {confirmation.quote.total} ₽</p><p className="text-sm text-slate-700">Гостей: {confirmation.input.guests}. {confirmation.input.startDate}{confirmation.input.endDate?` — ${confirmation.input.endDate}`:''}. Это не оплата; дождитесь ответа владельца.</p>
     {confirmation.phase==='unknown'?<><p className="text-sm font-semibold text-slate-800">Отправка не подтверждена. Не отправляйте новую заявку до проверки.</p><button type="button" className={bookingButton} disabled={busy} onClick={recover}>Проверить отправку</button></>:<button type="button" className={primaryButton} disabled={busy} onClick={submit}>{confirmation.phase==='retry'?'Повторить ту же отправку':'Отправить заявку владельцу'}</button>}
    </div>:<button type="submit" className={primaryButton} disabled={busy||!fresh}>Рассчитать стоимость</button>}
   </form>}
  </>}
 </div>;
}
export function PrimaryBookingCalculator({auth,booking,listingId,listingOwnerId,renderCalendar}:{auth:AccountAuthSnapshot;booking:BookingDetails;listingId:string;listingOwnerId?:string;renderCalendar:Calendar}){
 const owner=auth.state==='signed-in'||auth.state==='admin'?auth.userId:null,[scope,setScope]=useState(owner);
 if(owner&&owner!==scope)setScope(owner);if(auth.state==='signed-out'&&scope)setScope(null);const visible=!!owner&&owner===scope;
 return <section id="booking-calculator" aria-label="Заявка на бронирование" className="min-w-0 scroll-mt-28 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-xl font-bold text-slate-950">Бронирование</h2>
  {(!scope||scope===listingOwnerId)&&<BookingTerms booking={booking}/>}
  {!visible&&<div role="status" className="mt-3 text-sm text-slate-700">{auth.state==='signed-out'?<><p>Для отправки заявки войдите в аккаунт. Даты и стоимость проверим перед отправкой.</p><Link href="/auth" className={`${bookingButton} mt-3`}>Войти для бронирования</Link></>:<><p>Проверяем доступ. Заполненная форма временно скрыта.</p>{auth.state==='unavailable'&&<button type="button" className={`${bookingButton} mt-3`} onClick={()=>notifyAccountSessionChange(false)}>Повторить проверку входа</button>}</>}</div>}
  {scope&&(scope===listingOwnerId?<div hidden={!visible}><p className="mt-3 text-sm text-slate-700">Это ваше предложение. Заявки гостей доступны в личном кабинете.</p><Link href="/cabinet/bronirovaniya" className={`${bookingButton} mt-3`}>Открыть бронирования</Link></div>:<Workspace key={`${listingId}:${scope}`} owner={scope} listingId={listingId} visible={visible} renderCalendar={renderCalendar}/>)}
 </section>;
}
