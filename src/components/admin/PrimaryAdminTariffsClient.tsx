"use client";
import {useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {adminTariffs} from '@/lib/client-admin-tariffs';
import {AdminTariffError,normalizeAdminTariffPrice,parseAdminTariffCommand,tariffCheckoutNotice,type ManagedTariff,type TariffChange,type AdminTariffCommand,type TariffReceipt} from '@/lib/admin-tariff-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
const button='min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
function TariffEditor({actor,initial,onChanged,onRefresh,onClose,visible=true,hosted}:{visible?:boolean;hosted:boolean;actor:string;initial:ManagedTariff;onChanged:(row:ManagedTariff)=>void;onRefresh:()=>void;onClose:()=>void}){
 const [row,setRow]=useState(initial),[name,setName]=useState(initial.name),[price,setPrice]=useState(initial.price),[days,setDays]=useState(initial.durationDays===null?'':String(initial.durationDays)),[active,setActive]=useState(initial.active);
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<TariffChange|null>(null),[history,setHistory]=useState<TariffReceipt[]>([]);
 const [phase,setPhase]=useState<'ready'|'unknown'|'stale'|'denied'>('ready'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const result=useRef<HTMLParagraphElement|null>(null);
 const shown=useRef(visible);shown.current=visible;
 const alive=useRef(false),working=useRef(false),flight=useRef<AbortController|null>(null),section=useRef<HTMLElement|null>(null);
 useEffect(()=>{alive.current=true;section.current?.focus();return()=>{alive.current=false;flight.current?.abort();};},[]);
 useEffect(()=>{if(!visible){flight.current?.abort();if(pending)setPhase(value=>value==='denied'||value==='stale'?value:'unknown');}},[visible,pending]);
 useEffect(()=>{if(notice)result.current?.focus();},[notice]);
 const unchanged=name===row.name&&price===row.price&&days===(row.durationDays===null?'':String(row.durationDays))&&active===row.active;
 async function run(command:AdminTariffCommand){
  if(working.current||!shown.current)return;working.current=true;setBusy(true);setError('');const controller=new AbortController();flight.current=controller;
  try{
   const result=await adminTariffs.execute(command,{signal:controller.signal});if(!alive.current||!shown.current)return;
   if(!result.receipt){setPhase('unknown');setNotice('Запись о сохранении пока не найдена. Новое изменение не отправлено.');return;}
   const current=result.tariffs[0];if(!current){setPending(null);setPhase('stale');setNotice('Сохранение найдено, но тариф больше недоступен. Обновите список.');return;}
   setRow(current);setName(current.name);setPrice(current.price);setDays(current.durationDays===null?'':String(current.durationDays));setActive(current.active);setHistory(result.history);
   setPending(null);setReason('');setConfirmed(false);setPhase('ready');setNotice('Сохранение подтверждено. Показана текущая версия тарифа.');onChanged(current);
  }catch(cause){
   if(!alive.current||!shown.current)return;const failure=cause instanceof AdminTariffError?cause:new AdminTariffError('TARIFF_UNAVAILABLE');setError(failure.message);
   if(failure.code==='ADMIN_REQUIRED'){setPending(null);setHistory([]);setPhase('denied');notifyAccountSessionChange(false);}
   else if(failure.code==='TARIFF_TERMS_INVALID'){setPending(null);setConfirmed(false);setPhase('ready');}
   else if(['STALE_TARIFF','TARIFF_NOT_FOUND','OPERATION_CONFLICT'].includes(failure.code)){setPending(null);setConfirmed(false);setPhase('stale');}
   else setPhase('unknown');
  }finally{working.current=false;if(alive.current)setBusy(false);}
 }
 function submit(){
  if(!shown.current||working.current||pending||phase!=='ready'||!confirmed||unchanged)return;
  try{
   const command=parseAdminTariffCommand({resource:'tariffs',action:'change',expectedAdminId:actor,input:{id:crypto.randomUUID(),tariffId:row.id,expectedRevision:row.revision,name:name.trim(),price:normalizeAdminTariffPrice(price),durationDays:days===''?null:/^[1-9]\d{0,3}$/.test(days)?Number(days):0,active,reason:reason.trim()}});
   if(command.action!=='change')return;setPending(command.input);setNotice('');void run(command);
  }catch{setError('Проверьте название, цену с точностью до копеек, срок от 1 до 3650 дней и причину от 3 до 500 символов. Пустой срок означает разовую оплату.');}
 }
 if(!visible)return null;
 return <section ref={section} tabIndex={-1} aria-label="Изменение тарифа" className="my-4 rounded-xl border border-blue-200 bg-white p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-bold text-slate-950">{row.name}</h2><button className={button} type="button" disabled={busy||!!pending} onClick={onClose}>Закрыть</button></div>
  <p ref={result} tabIndex={-1} role="status" aria-atomic="true" className={notice?"mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600":"sr-only"}>{notice}</p>
  {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {phase==='stale'&&<button type="button" className={`${button} mt-3`} onClick={onRefresh}>Загрузить актуальный тариф</button>}
  {phase!=='denied'&&<form aria-busy={busy} className="mt-4" onSubmit={event=>{event.preventDefault();submit();}}><fieldset disabled={busy||!!pending||phase!=='ready'} className="grid gap-4 sm:grid-cols-2">
   <label className="text-sm font-bold text-slate-700 sm:col-span-2">Название<input name="name" readOnly={hosted} required maxLength={200} value={name} onChange={event=>setName(event.target.value)} className={field}/></label>
   <label className="text-sm font-bold text-slate-700">Цена, ₽<input name="price" type="text" inputMode="decimal" required maxLength={13} value={price} onChange={event=>setPrice(event.target.value)} className={field}/></label>
   <label className="text-sm font-bold text-slate-700">Срок, дней<input name="days" type="text" inputMode="numeric" maxLength={4} placeholder="Разовая оплата" value={days} onChange={event=>setDays(event.target.value)} className={field}/></label>
   <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700 sm:col-span-2"><input name="active" type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)} className="h-4 w-4"/>Тариф активен</label>
   <label className="text-sm font-bold text-slate-700 sm:col-span-2">Причина изменения<textarea name="reason" required minLength={3} maxLength={500} rows={2} value={reason} onChange={event=>setReason(event.target.value)} className={field}/></label>
   <label className="flex items-start gap-3 text-sm leading-6 text-slate-700 sm:col-span-2"><input name="confirmed" type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4"/>Я проверил цену, срок и доступность оплаты. Уже созданные оплаты сохранят прежние условия.</label>
   <button className={button} type="submit" disabled={busy||!!pending||!confirmed||unchanged}>Сохранить тариф</button>
  </fieldset></form>}
  {phase==='unknown'&&pending&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>Результат неизвестен. Сначала проверьте сохранение. Повтор использует исходные данные и тот же номер операции.</p><div className="mt-3 flex flex-wrap gap-3">
   <button type="button" disabled={busy} className={button} onClick={()=>void run({resource:'tariffs',action:'recover',expectedAdminId:actor,tariffId:row.id,id:pending.id})}>Проверить сохранение</button>
   <button type="button" disabled={busy} className={button} onClick={()=>void run({resource:'tariffs',action:'change',expectedAdminId:actor,input:pending})}>Повторить исходное сохранение</button></div></div>}
  {pending&&<p className="mt-3 text-xs text-slate-500">Сначала подтвердите результат сохранения. Обновление страницы или выход из аккаунта не отменяют отправленное изменение.</p>}
  {history.length>0&&<details className="mt-4 border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">Последние изменения ({history.length})</summary><ol className="mt-3 space-y-3">{history.map(item=><li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-bold">{item.next.price} ₽ · {item.next.durationDays===null?'Разово':`${item.next.durationDays} дн.`} · {item.next.active?'Активен':'Отключён'}</p><p className="mt-1 break-words">{item.reason}</p><p className="mt-1 break-all text-xs text-slate-500"><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(item.createdAt))}</time> · Администратор: {item.actorId}</p></li>)}</ol></details>}
 </section>;
}
function TariffList({actor,visible,editable,hosted}:{actor:string;visible:boolean;editable:boolean;hosted:boolean}){
 const [rows,setRows]=useState<ManagedTariff[]|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;const controller=new AbortController();setRows(null);setSelected(null);setError('');
  adminTariffs.execute({resource:'tariffs',action:'list',expectedAdminId:actor},{signal:controller.signal}).then(result=>{
   if(active)setRows(result.tariffs);
  }).catch(cause=>{
   if(!active)return;
   const failure=cause instanceof AdminTariffError?cause:null;
   setError(failure&&failure.code!=='TARIFF_UNAVAILABLE'?failure.message:'Не удалось загрузить тарифы.');
   if(failure?.code==='ADMIN_REQUIRED')notifyAccountSessionChange(false);
  });
  return()=>{active=false;controller.abort();};
 },[actor,reload]);
 const closedTariffId=useRef<string|null>(null);
 useEffect(()=>{
  if(selected!==null || closedTariffId.current===null)return;
  const id=closedTariffId.current;
  closedTariffId.current=null;
  if(visible)document.getElementById('tariff-'+id)?.focus();
 },[selected,visible]);
 const current=rows?.find(row=>row.id===selected);
 return <div>{visible&&editable&&<p className="text-sm leading-6 text-slate-600">Изменения применяются к новым оплатам. Суммы и сроки сохранённых заказов остаются прежними.</p>}
  {visible&&error&&<div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><button type="button" className={`${button} mt-3`} onClick={()=>setReload(value=>value+1)}>Повторить загрузку</button></div>}
  {visible&&!rows&&!error&&<p role="status" className="mt-4 text-sm text-slate-600">Загружаем тарифы…</p>}
  {editable&&current&&<TariffEditor key={`${actor}:${current.id}`} actor={actor} initial={current} visible={visible} hosted={hosted} onChanged={next=>setRows(items=>items?.map(item=>item.id===next.id?next:item)??null)} onRefresh={()=>setReload(value=>value+1)} onClose={()=>{closedTariffId.current=current.id;setSelected(null);}}/>}
  {visible&&rows?.length===0&&<p role="status" className="mt-4 text-sm text-slate-600">Тарифы пока не настроены.</p>}
  {visible&&<ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">{rows?.map(row=><li key={row.id} className="flex flex-wrap items-start justify-between gap-4 p-4"><div className="min-w-0 flex-1"><h2 className="break-words font-bold text-slate-950">{row.name}</h2><p className="mt-1 text-sm text-slate-700">{row.price} ₽ · {row.durationDays===null?'Разовая оплата':`${row.durationDays} дн.`}</p><p className="mt-1 break-all text-xs text-slate-500">{row.id}</p>{tariffCheckoutNotice(row)&&<p className="mt-2 text-sm text-amber-900">{tariffCheckoutNotice(row)}</p>}</div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${row.active?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 bg-slate-50 text-slate-600'}`}>{row.active?'Активен':'Отключён'}</span>{editable&&(!hosted||row.action!=='fair_participation')&&<button type="button" id={'tariff-'+row.id} className={button} disabled={selected!==null} onClick={()=>setSelected(row.id)}>Изменить</button>}</div></li>)}</ul>}
 </div>;
}
export function PrimaryAdminTariffsClient({editable=true,hosted=false}:{editable?:boolean;hosted?:boolean}={}){
 const auth=usePrimaryAccountAuth(),actor=auth?.state==='admin'?auth.userId:null,[scope,setScope]=useState(actor);
 if(actor&&actor!==scope)setScope(actor);
 if((auth?.state==='signed-out'||auth?.state==='signed-in')&&scope)setScope(null);
 const visible=actor!==null&&actor===scope;
 return <>{!visible&&<p role="status" className="text-sm text-slate-600">{auth?.state==='loading'?'Проверяем права администратора…':'Доступ администратора не подтверждён.'}</p>}
  {scope&&<TariffList key={scope} actor={scope} visible={visible} editable={editable} hosted={hosted}/>}</>;
}
