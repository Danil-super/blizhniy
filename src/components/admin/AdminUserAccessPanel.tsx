"use client";
import {useEffect,useRef,useState} from 'react';
import {adminUserAccess} from '@/lib/client-admin-user-access';
import {AdminUserAccessError,parseAdminUserAccessCommand,type AdminUserAccessCommand,type AdminUserAccessResult,type UserAccessChange} from '@/lib/admin-user-access-contract';
import {notifyAccountSessionChange} from '@/lib/local-account';
type Props={actor:string;targetId:string;targetLabel:string;onClose:()=>void;onChanged:()=>void};
const button='min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
function AccessDetails({actor,targetId,targetLabel,onClose,onChanged}:Props){
  const [data,setData]=useState<AdminUserAccessResult|null>(null),[role,setRole]=useState<'user'|'admin'>('user'),[blocked,setBlocked]=useState(false);
  const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<UserAccessChange|null>(null);
  const [phase,setPhase]=useState<'loading'|'ready'|'unknown'|'error'>('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
  const alive=useRef(false),working=useRef(false),flight=useRef<AbortController|null>(null),section=useRef<HTMLElement|null>(null);
  const self=actor===targetId;
  const unchanged=data?.user.role===role&&data.user.isBlocked===blocked;
  useEffect(()=>{alive.current=true;section.current?.focus();return()=>{alive.current=false;flight.current?.abort();};},[]);
  const deny=(cause:unknown)=>{
    if(cause instanceof AdminUserAccessError&&cause.code==='ADMIN_REQUIRED'){
      setData(null);setPending(null);setReason('');setConfirmed(false);notifyAccountSessionChange(false);return true;
    }return false;
  };
  useEffect(()=>{
    let active=true;const controller=new AbortController();flight.current=controller;
    setData(null);setPhase('loading');setError('');setConfirmed(false);setPending(null);setReason('');
    adminUserAccess.execute({action:'inspect',expectedAdminId:actor,targetId},{signal:controller.signal}).then(result=>{
      if(!active)return;setData(result);setRole(result.user.role);setBlocked(result.user.isBlocked);setPhase('ready');
    }).catch(cause=>{
      if(!active)return;setError(cause instanceof AdminUserAccessError?cause.message:'Не удалось загрузить доступ пользователя.');setPhase('error');
      if(cause instanceof AdminUserAccessError&&cause.code==='ADMIN_REQUIRED')notifyAccountSessionChange(false);
    });
    return()=>{active=false;controller.abort();};
  },[actor,targetId,reload]);
  async function run(command:AdminUserAccessCommand){
    if(working.current)return;working.current=true;setBusy(true);setError('');
    const controller=new AbortController();flight.current=controller;
    try{
      const result=await adminUserAccess.execute(command,{signal:controller.signal});if(!alive.current)return;
      if(command.action==='recover'&&!result.receipt){setData(result);setPhase('unknown');setNotice('Запись об операции пока не найдена. Новое решение не отправлено.');return;}
      setData(result);setRole(result.user.role);setBlocked(result.user.isBlocked);setReason('');setConfirmed(false);setPending(null);setPhase('ready');
      setNotice(command.action==='recover'?'Результат операции подтверждён.':result.receipt?.changed?'Доступ обновлён. Прежние сессии пользователя отозваны.':'Решение записано без изменения доступа.');onChanged();
    }catch(cause){
      if(!alive.current)return;const failure=cause instanceof AdminUserAccessError?cause:new AdminUserAccessError('ACCESS_UNAVAILABLE');
      setError(failure.message);
      if(deny(failure)){setPhase('error');return;}
      if(command.action==='change'&&!['ACCESS_UNAVAILABLE','ACCESS_BUSY','RATE_LIMITED'].includes(failure.code)){
        setPending(null);setConfirmed(false);setData(null);setNotice(failure.message);setReload(value=>value+1);
      }else setPhase('unknown');
    }finally{working.current=false;if(alive.current)setBusy(false);}
  }
  function submit(){
    if(working.current||pending||!data||phase!=='ready'||!confirmed||self||unchanged)return;
    try{
      const command=parseAdminUserAccessCommand({action:'change',expectedAdminId:actor,input:{id:crypto.randomUUID(),targetId,expectedVersion:data.user.authVersion,role,isBlocked:blocked,reason}});
      if(command.action!=='change')return;setPending(command.input);setNotice('');void run(command);
    }catch{setError('Укажите причину от 3 до 500 символов обычным текстом.');}
  }
  return <section ref={section} tabIndex={-1} aria-label="Управление доступом" aria-busy={busy||phase==='loading'} className="my-5 rounded-xl border border-blue-200 bg-white p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-bold text-slate-950">Доступ: {targetLabel}</h2><p className="mt-1 break-all text-xs text-slate-500">ID: {targetId}</p></div><button type="button" className={button} onClick={onClose}>Закрыть</button></div>
    {phase==='loading'&&<p role="status" className="mt-4 text-sm text-slate-600">Проверяем текущий доступ…</p>}
    {notice&&<p role="status" className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
    {error&&<p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {phase==='error'&&<button type="button" className={`${button} mt-3`} onClick={()=>setReload(value=>value+1)}>Повторить загрузку</button>}
    {self&&<p className="mt-4 text-sm text-amber-900">Изменить собственный доступ нельзя. Решение должен принять другой администратор.</p>}
    {data&&<form className="mt-4" onSubmit={event=>{event.preventDefault();submit();}}>
      <p className="mb-4 text-sm text-slate-600">Сейчас: {data.user.role==='admin'?'администратор':'пользователь'} · {data.user.isBlocked?'заблокирован':data.user.emailVerified?'активен':'ожидает подтверждения email'}</p>
      <fieldset disabled={self||busy||!!pending} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">Роль<select name="role" value={role} onChange={event=>setRole(event.target.value as 'user'|'admin')} className={field}>
          <option value="user">Пользователь</option><option value="admin" disabled={!data.user.emailVerified}>Администратор</option></select></label>
        <label className="flex min-h-11 items-center gap-3 self-end text-sm font-bold text-slate-700"><input name="blocked" type="checkbox" checked={blocked} onChange={event=>setBlocked(event.target.checked)} className="h-4 w-4"/>Заблокировать аккаунт</label>
        <label className="text-sm font-bold text-slate-700 sm:col-span-2">Причина<textarea name="reason" required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">Кратко опишите основание. Не добавляйте пароли, контакты и другие личные данные.</span></label>
        <label className="flex items-start gap-3 text-sm leading-6 text-slate-700 sm:col-span-2"><input name="confirmed" required type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4"/>Я проверил пользователя и выбранные права. Изменение доступа отзовёт его прежние сессии.</label>
        <button type="submit" disabled={self||busy||!!pending||!confirmed||unchanged} className={`${button} justify-self-start`}>{busy?'Сохраняем…':'Сохранить решение'}</button>
      </fieldset>
    </form>}
    {phase==='unknown'&&pending&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p>Решение пока не подтверждено. Проверка результата не изменяет доступ. Повторная отправка использует то же решение.</p>
      <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} className={button} onClick={()=>void run({action:'recover',expectedAdminId:actor,targetId,id:pending.id})}>Проверить результат</button>
        <button type="button" disabled={busy} className={button} onClick={()=>void run({action:'change',expectedAdminId:actor,input:pending})}>Повторить исходное решение</button></div>
    </div>}
    {(busy||pending)&&<p className="mt-3 text-xs text-slate-500">Закрытие окна не отменяет уже отправленное решение.</p>}
    {data&&<details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-bold text-slate-700">Последние решения ({data.history.length})</summary>
      {data.history.length===0?<p className="mt-3 text-sm text-slate-500">Решений пока нет.</p>:<ol className="mt-3 space-y-3">{data.history.map(item=><li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-bold text-slate-800">{item.role==='admin'?'Администратор':'Пользователь'} · {item.isBlocked?'Заблокирован':'Не заблокирован'}{!item.changed?' · Без изменений':''}</p>
        <p className="mt-1 break-words text-slate-700">{item.reason}</p><p className="mt-2 break-all text-xs text-slate-500"><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(item.createdAt))}</time> · Администратор: {item.actorId}</p>
      </li>)}</ol>}
    </details>}
  </section>;
}
export function AdminUserAccessPanel(props:Props){return <AccessDetails key={`${props.actor}:${props.targetId}`} {...props}/>;}
