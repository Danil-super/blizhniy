'use client';
import {useEffect,useRef,useState} from 'react';
import {phoneVerification,type PhoneStatus} from '@/lib/client-phone-verification';
import {normalizeProfilePhone} from '@/lib/phone-verification-contract';
export function PhoneVerificationButton({owner,returnTo='/cabinet',onVerified,displayedPhone}:{owner:string;returnTo?:string;onVerified?:()=>void|Promise<void>;displayedPhone?:string}){
 const [status,setStatus]=useState<PhoneStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const attempt=useRef<string|null>(null),popup=useRef<Window|null>(null),currentOwner=useRef(owner);currentOwner.current=owner;
 const shownVerified=status?.verified&&(displayedPhone===undefined||normalizeProfilePhone(displayedPhone)===status.verifiedPhone);
 useEffect(()=>{let active=true;setStatus(null);setError('');setBusy(false);void phoneVerification.status(owner).then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('Не удалось проверить доступность подтверждения.');});return()=>{active=false;attempt.current=null;popup.current?.close();};},[owner]);
 useEffect(()=>{
  const update=async(data:unknown)=>{
   if(!data||typeof data!=='object'||!('type'in data)||data.type!=='blizhniy-phone-confirmed'||!('attemptId'in data)||data.attemptId!==attempt.current||currentOwner.current!==owner)return;
   try{const value=await phoneVerification.status(owner);if(currentOwner.current!==owner||data.attemptId!==attempt.current||!value.verified)return;setStatus(value);attempt.current=null;setBusy(false);await onVerified?.();}
   catch(e){if(currentOwner.current===owner){setBusy(false);setError(e instanceof Error?e.message:'Не удалось обновить профиль.');}}
  };
  const message=(event:MessageEvent)=>{if(event.origin===location.origin&&event.source===popup.current)void update(event.data);};
  window.addEventListener('message',message);const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('blizhniy-phone-verification'):null;
  if(channel)channel.onmessage=event=>void update(event.data);
  return()=>{window.removeEventListener('message',message);channel?.close();};
 },[owner,onVerified]);
 async function start(){
  if(!status?.available||busy)return;const opened=window.open('about:blank','blizhniy-phone-'+crypto.randomUUID(),'popup,width=520,height=740');
  if(!opened){setError('Разрешите открытие окна подтверждения в браузере и повторите попытку.');return;}
  popup.current=opened;setBusy(true);setError('');
  try{const result=await phoneVerification.start(owner,returnTo);if(currentOwner.current!==owner){opened.close();return;}attempt.current=result.attemptId;opened.location.replace(result.authorizationUrl);}
  catch(e){opened.close();if(currentOwner.current===owner){setBusy(false);setError(e instanceof Error?e.message:'Не удалось начать подтверждение.');}}
 }
 return <div className="min-w-0 space-y-2">
  {shownVerified&&<p className="text-sm font-semibold text-emerald-700">Телефон подтверждён через Telegram</p>}
  <button type="button" disabled={!status?.available||busy} onClick={()=>void start()} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-55">{busy?'Подтверждение открыто в отдельном окне…':shownVerified?'Подтвердить другой номер через Telegram':'Подтвердить номер через Telegram'}</button>
  <p className="text-xs leading-5 text-slate-600">Получим номер, связанный с вашим Telegram-аккаунтом. Он не будет опубликован без вашего разрешения.</p>
  {status&&!status.available&&<p role="status" className="text-xs leading-5 text-slate-600">Подтверждение через Telegram пока не настроено. Номер можно сохранить без подтверждения.</p>}
  {shownVerified&&<button type="button" disabled={busy} onClick={()=>void (async()=>{
   if(!window.confirm('Отвязать подтверждение Telegram? Новые размещения потребуют повторного подтверждения номера.'))return;
   setBusy(true);setError('');try{await phoneVerification.unlink(owner);if(currentOwner.current!==owner)return;setStatus(await phoneVerification.status(owner));await onVerified?.();}
   catch(e){if(currentOwner.current===owner)setError(e instanceof Error?e.message:'Не удалось снять подтверждение.');}finally{if(currentOwner.current===owner)setBusy(false);}
  })()} className="text-sm font-semibold text-slate-600 underline disabled:opacity-50">Отвязать подтверждение</button>}
  {busy&&<button type="button" onClick={()=>{attempt.current=null;popup.current?.close();setBusy(false);}} className="ml-2 text-sm font-semibold text-slate-600 underline">Отменить</button>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
 </div>;
}
