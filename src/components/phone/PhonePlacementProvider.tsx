'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {PhoneVerificationButton} from './PhoneVerificationButton';
import {phonePlacementEvent,type PhonePlacementRequest} from '@/lib/phone-placement';
import {phoneVerification,PhoneClientError} from '@/lib/client-phone-verification';
export function PhonePlacementProvider({children}:{children:ReactNode}){
 const auth=usePrimaryAccountAuth(),owner=auth&&(auth.state==='signed-in'||auth.state==='admin')?auth.userId:null;
 const [pending,setPending]=useState<PhonePlacementRequest|null>(null),[error,setError]=useState('');const active=useRef<PhonePlacementRequest|null>(null),latestOwner=useRef(owner);latestOwner.current=owner;const dialog=useRef<HTMLDialogElement>(null);
 const cancel=()=>{active.current?.reject(new PhoneClientError('CANCELLED'));active.current=null;setPending(null);};
 useEffect(()=>{const receive=(event:Event)=>{const e=event as CustomEvent<PhonePlacementRequest>;e.preventDefault();if(!e.detail||latestOwner.current!==e.detail.owner){e.detail?.reject(new PhoneClientError('UNAUTHENTICATED'));return;}if(active.current){e.detail.reject(new PhoneClientError('CANCELLED'));return;}active.current=e.detail;setError('');setPending(e.detail);};window.addEventListener(phonePlacementEvent,receive);return()=>{window.removeEventListener(phonePlacementEvent,receive);active.current?.reject(new PhoneClientError('CANCELLED'));active.current=null;};},[]);
 useEffect(()=>{if(pending&&owner!==pending.owner){active.current?.reject(new PhoneClientError('UNAUTHENTICATED'));active.current=null;setPending(null);}},[owner,pending]);
 useEffect(()=>{if(pending&&!dialog.current?.open)dialog.current?.showModal();else if(!pending&&dialog.current?.open)dialog.current.close();},[pending]);
 async function confirmed(){const request=active.current;if(!request||latestOwner.current!==request.owner)return;
  try{const status=await phoneVerification.status(request.owner);if(!status.verified)throw new Error('Номер пока не подтверждён.');if(active.current!==request||latestOwner.current!==request.owner)return;active.current=null;setPending(null);request.resolve();}
  catch(e){setError(e instanceof Error?e.message:'Не удалось проверить номер.');}
 }
 return <>{children}<dialog ref={dialog} aria-labelledby="phone-placement-heading" onCancel={e=>{e.preventDefault();cancel();}} className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
  {pending&&<div className="space-y-4"><h2 id="phone-placement-heading" className="text-xl font-bold text-slate-950">Подтвердите номер телефона</h2><p className="text-sm leading-6 text-slate-600">Подтвердите номер телефона, чтобы разместить публикацию. После подтверждения продолжим с заполненными данными.</p><PhoneVerificationButton owner={pending.owner} returnTo={location.pathname+location.search} onVerified={confirmed}/>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<button type="button" onClick={cancel} className="min-h-11 text-sm font-semibold text-slate-600 underline">Вернуться к форме</button></div>}
 </dialog></>;
}
