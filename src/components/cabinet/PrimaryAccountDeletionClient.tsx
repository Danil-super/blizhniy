'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import Link from 'next/link';
import {PasswordField} from '@/components/auth/PasswordField';
import {TurnstileWidget} from '@/components/TurnstileWidget';
import {useAccountCaptcha} from '@/components/auth/AccountCaptchaProvider';
import type {AccountAuthSnapshot} from '@/lib/account-session-state';
import type {DeletionAccess,DeletionPrincipal,DeletionCase} from '@/lib/account-deletion-contract';
import {deletionRequest,DeletionClientError,deletionStatus,deletionResolution,deletionDate} from '@/lib/account-deletion-client';

const button='min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-blue hover:bg-slate-50 disabled:opacity-50';
export function PrimaryAccountDeletionClient({auth}:{auth:AccountAuthSnapshot}){
 const [user,setUser]=useState<DeletionPrincipal|null>(null),[current,setCurrent]=useState<DeletionCase|null>(null);
 const [mode,setMode]=useState<DeletionAccess>('account'),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[captcha,setCaptcha]=useState(''),[captchaKey,setCaptchaKey]=useState(0);
 const human=useAccountCaptcha(),generation=useRef(0),unknownWrite=useRef(false),inFlight=useRef(false);
 const discard=useCallback(()=>{generation.current++;},[]);
 const load=useCallback(async(access:DeletionAccess)=>{
  const version=++generation.current;setReady(false);setUser(null);setCurrent(null);setConfirmed(false);setError('');setNotice('');inFlight.current=false;setBusy(false);
  try{
   const view=await deletionRequest<{user:DeletionPrincipal}>('session',{access});
   const result=await deletionRequest<{request:DeletionCase|null}>('read',{access,expectedOwnerId:view.user.id});
   if(version!==generation.current)return;
   setMode(access);setUser(view.user);setCurrent(result.request);unknownWrite.current=false;
  }catch(cause){if(version===generation.current&&!(cause instanceof DeletionClientError&&cause.code==='UNAUTHENTICATED'))setError(cause instanceof Error?cause.message:'Не удалось загрузить заявку.');}
  finally{if(version===generation.current)setReady(true);}
 },[]);
 useEffect(()=>{
  if(auth.state==='loading'||auth.state==='unavailable'){
   generation.current++;setUser(null);setCurrent(null);setReady(false);return;
  }
  const access:DeletionAccess=auth.userId?'account':'data-subject';
  void load(access);
  const invalidate=()=>{generation.current++;setUser(null);setCurrent(null);setReady(false);setPassword('');};
  const refresh=()=>{void load(access);};
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  window.addEventListener('blizhniy-account-changing',invalidate);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible);
  return()=>{discard();window.removeEventListener('blizhniy-account-changing',invalidate);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);};
 },[auth.state,auth.userId,load,discard]);
 async function login(event:FormEvent){
  event.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');const version=generation.current;
  try{
   await deletionRequest('login',{email,password,captchaToken:captcha});
   if(version===generation.current){setPassword('');await load('data-subject');}
  }catch(cause){if(version===generation.current){setError(cause instanceof Error?cause.message:'Не удалось войти.');setCaptcha('');setCaptchaKey(value=>value+1);}}
  finally{if(version===generation.current){inFlight.current=false;setBusy(false);}}
 }
 async function submit(){
  if(!user||!confirmed||unknownWrite.current||inFlight.current)return;
  const version=generation.current;inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await deletionRequest<{request:DeletionCase}>('request',{access:mode,expectedOwnerId:user.id});
   if(version===generation.current){setCurrent(result.request);setConfirmed(false);setNotice('Заявка получена. Её статус доступен на этой странице.');}
  }catch(cause){if(version===generation.current){unknownWrite.current=true;setError(cause instanceof Error?cause.message:'Не удалось отправить заявку.');}}
  finally{if(version===generation.current){inFlight.current=false;setBusy(false);}}
 }
 async function logout(){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);const version=generation.current;
  try{await deletionRequest('logout',{});if(version===generation.current)await load('data-subject');}
  catch(cause){if(version===generation.current)setError(cause instanceof Error?cause.message:'Не удалось выйти.');}
  finally{if(version===generation.current){inFlight.current=false;setBusy(false);}}
 }
 const active=current&&current.status!=='resolved';
 return <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
  <h1 className="text-2xl font-bold text-brand-ink">Запрос на удаление аккаунта</h1>
  <p className="mt-3 text-sm leading-6 text-slate-600">Заявку рассмотрит администратор. Отправка запроса сама по себе не удаляет аккаунт. Для данных, которые необходимо сохранить, оператор проверит основание и сообщит о решении.</p>
  {error&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  {auth.state==='unavailable'?<p role="status" className="mt-5">Проверка аккаунта недоступна. Обновите страницу позже.</p>:!ready?<p role="status" className="mt-5">Проверяем доступ к заявке…</p>:!user?<form onSubmit={login} className="mt-5 space-y-4">
   <h2 className="text-lg font-semibold">Доступ к своему запросу</h2>
   <p className="text-sm text-slate-600">Войдите с email и паролем аккаунта. Этот доступ работает и для заблокированного аккаунта и разрешает только работу с его заявкой.</p>
   <label className="block text-sm font-semibold">Email<input type="email" required maxLength={254} autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"/></label>
   <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password"/>
   {!human&&<TurnstileWidget requireProvider manualRetry inline resetKey={captchaKey} onVerify={setCaptcha}/>}
   <button className={button} disabled={busy||(!human&&!captcha)}>{busy?'Проверяем…':'Войти для подачи запроса'}</button>
   <p className="text-sm"><Link href="/auth/recover" className="text-brand-blue underline">Восстановить пароль</Link></p>
  </form>:<div className="mt-5 space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><span className="break-all text-sm font-semibold">{user.email}</span>
    {mode==='data-subject'&&<button className={button} disabled={busy} onClick={()=>void logout()}>Выйти из доступа к заявке</button>}</div>
   {current&&<article className="rounded-xl border border-slate-200 p-4" aria-label="Состояние заявки">
    <h2 className="font-semibold">{deletionStatus[current.status]}</h2>
    <dl className="mt-2 space-y-1 text-sm text-slate-600"><div><dt className="inline">Отправлена: </dt><dd className="inline">{deletionDate(current.requestedAt)}</dd></div>
     {current.resolvedAt&&<div><dt className="inline">Рассмотрена: </dt><dd className="inline">{deletionDate(current.resolvedAt)}</dd></div>}</dl>
    {current.resolution&&<p className="mt-3 text-sm">{deletionResolution[current.resolution]}</p>}
   </article>}
   {!active&&<><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4"/>Прошу удалить мой аккаунт и рассмотреть удаление связанных с ним персональных данных.</label>
    <button className={button+' border-red-300 text-red-700'} disabled={busy||!confirmed||unknownWrite.current} onClick={()=>void submit()}>{busy?'Отправляем…':'Отправить запрос на удаление'}</button></>}
   <button className={button} disabled={busy} onClick={()=>void load(mode)}>Проверить состояние заявки</button>
  </div>}
 </section>;
}
