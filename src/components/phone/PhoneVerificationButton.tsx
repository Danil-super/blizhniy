'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {phoneVerification,PhoneClientError,type PhoneStatus} from '@/lib/client-phone-verification';
import {phoneWindowMemory,openPhoneVerificationChannel} from '@/lib/phone-verification-window';
import {normalizeProfilePhone} from '@/lib/phone-verification-contract';
export function PhoneVerificationButton({owner,returnTo='/cabinet',onVerified,displayedPhone,compact=false}:{owner:string;returnTo?:string;onVerified?:()=>void|Promise<void>;displayedPhone?:string;compact?:boolean}){
 const availabilityId=useId();
 const [status,setStatus]=useState<PhoneStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const latest=useRef({owner,onVerified});latest.current={owner,onVerified};
 const mounted=useRef(false);
 const shownVerified=status?.verified&&(displayedPhone===undefined||normalizeProfilePhone(displayedPhone)===status.verifiedPhone);
 useEffect(()=>{
  let active=true,inFlight=false;mounted.current=true;setStatus(null);setError('');setBusy(Boolean(phoneWindowMemory.resume(owner)));
  void phoneVerification.status(owner).then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('Не удалось проверить доступность подтверждения.');});
  const update=async()=>{
   if(!active||latest.current.owner!==owner)return;
   const pending=phoneWindowMemory.resume(owner);
   if(!pending?.attemptId||inFlight)return;inFlight=true;
   try{
    const review=await phoneVerification.review(owner,pending.attemptId);
    if(!active||!phoneWindowMemory.isCurrent(pending)||!review.confirmed)return;
    const value=await phoneVerification.status(owner);
    if(!active||latest.current.owner!==owner||!phoneWindowMemory.isCurrent(pending)||!value.verified||value.verifiedPhone!==review.phone)return;
    await latest.current.onVerified?.();
    if(!active||latest.current.owner!==owner||!phoneWindowMemory.isCurrent(pending))return;
    setStatus(value);phoneWindowMemory.finish(pending);setBusy(false);setError('');
   }catch(e){
    // A valid pending attempt has no phone to review until Telegram returns.
    if(active&&!(e instanceof PhoneClientError&&e.code==='INVALID_ATTEMPT'))setError(e instanceof Error?e.message:'Не удалось обновить профиль.');
   }finally{inFlight=false;}
  };
  const receive=(data:unknown)=>{
   if(!active||latest.current.owner!==owner)return;
   const pending=phoneWindowMemory.resume(owner);
   if(data&&typeof data==='object'&&'type'in data&&data.type==='blizhniy-phone-confirmed'&&'attemptId'in data&&data.attemptId===pending?.attemptId)void update();
  };
  const message=(event:MessageEvent)=>{if(active&&event.origin===location.origin&&event.source===phoneWindowMemory.resume(owner)?.popup)receive(event.data);};
  const focus=()=>{if(document.visibilityState==='visible')void update();};
  window.addEventListener('message',message);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  const channel=openPhoneVerificationChannel();
  if(channel)channel.onmessage=event=>receive(event.data);
  // Some privacy modes sever opener and disable BroadcastChannel. Check only
  // the pending closed window, while visible, within its ten-minute lifetime.
  const monitor=!channel?window.setInterval(()=>{
   if(!active)return;const pending=phoneWindowMemory.resume(owner);
   if(!pending){setBusy(false);return;}
   if(pending.popup.closed&&document.visibilityState==='visible')void update();
  },5000):null;
  void update();
  // Auth revalidation temporarily unmounts the form; retain the tab-local attempt.
  return()=>{active=false;mounted.current=false;window.removeEventListener('message',message);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);channel?.close();if(monitor!==null)window.clearInterval(monitor);};
 },[owner]);
 async function start(){
  if(!status?.available||busy)return;
  const previous=phoneWindowMemory.resume(owner);
  if(previous){previous.popup.focus();setBusy(true);return;}
  const opened=window.open('about:blank','blizhniy-phone-'+crypto.randomUUID(),'popup,width=520,height=740');
  if(!opened){setError('Разрешите открытие окна подтверждения в браузере и повторите попытку.');return;}
  const pending=phoneWindowMemory.begin(owner,opened);setBusy(true);setError('');
  try{
   const result=await phoneVerification.start(owner,returnTo);
   if(!phoneWindowMemory.isCurrent(pending)){opened.close();return;}
   pending.attemptId=result.attemptId;opened.location.replace(result.authorizationUrl);
  }catch(e){
   if(phoneWindowMemory.isCurrent(pending))phoneWindowMemory.cancel();else opened.close();
   if(mounted.current&&latest.current.owner===owner){setBusy(false);setError(e instanceof Error?e.message:'Не удалось начать подтверждение.');}
  }
 }
 return <div className="min-w-0 space-y-2 font-normal">
  {shownVerified&&!compact&&<p className="text-sm font-semibold text-emerald-700">Телефон подтверждён через Telegram</p>}
  <button type="button" aria-describedby={status&&!status.available?availabilityId:undefined} disabled={!status?.available||busy} onClick={()=>void start()} className={compact?'inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-55':'inline-flex min-h-11 items-center justify-center rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-55'}>{busy?'Ожидаем подтверждение…':shownVerified?'Изменить номер':compact?'Подтвердить через Telegram':'Подтвердить номер через Telegram'}</button>
  {!compact&&<p className="text-xs leading-5 text-slate-600">Получим номер, связанный с вашим Telegram-аккаунтом. Он не будет опубликован без вашего разрешения.</p>}
  {status&&!status.available&&<p id={availabilityId} role="status" className="text-xs leading-5 text-slate-600">Подтверждение через Telegram пока не настроено. Номер можно сохранить без подтверждения.</p>}
  {shownVerified&&<button type="button" disabled={busy} onClick={()=>void (async()=>{
   if(!window.confirm('Отвязать подтверждение Telegram? Новые размещения потребуют повторного подтверждения номера.'))return;
   setBusy(true);setError('');try{await phoneVerification.unlink(owner);if(latest.current.owner!==owner)return;setStatus(await phoneVerification.status(owner));await onVerified?.();}
   catch(e){if(latest.current.owner===owner)setError(e instanceof Error?e.message:'Не удалось снять подтверждение.');}finally{if(latest.current.owner===owner)setBusy(false);}
  })()} className="text-sm font-semibold text-slate-600 underline disabled:opacity-50">Отвязать подтверждение</button>}
  {busy&&<button type="button" onClick={()=>{phoneWindowMemory.cancel();setBusy(false);}} className="ml-2 text-sm font-semibold text-slate-600 underline">Отменить</button>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
 </div>;
}
