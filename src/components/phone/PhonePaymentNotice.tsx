'use client';
import {useEffect,useState} from 'react';
import {phoneVerification} from '@/lib/client-phone-verification';
import {PhoneVerificationButton} from './PhoneVerificationButton';
/** Financial success remains separate from permission to publish. No new checkout. */
export function PhonePaymentNotice({owner,onVerified}:{owner:string;onVerified:()=>void}){
 const [waiting,setWaiting]=useState(false);
 useEffect(()=>{let active=true;void phoneVerification.status(owner).then(value=>{if(active)setWaiting(value.required&&!value.verified);}).catch(()=>{if(active)setWaiting(false);});return()=>{active=false;};},[owner]);
 if(!waiting)return null;
 return <aside className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
  <h2 className="font-semibold text-slate-950">Подтвердите телефон для размещения</h2>
  <p className="text-sm leading-6 text-slate-700">Оплата уже подтверждена. Новый платёж не нужен. После подтверждения номера продолжим размещение на приобретённый срок.</p>
  <PhoneVerificationButton owner={owner} returnTo={location.pathname+location.search} onVerified={()=>{setWaiting(false);onVerified();}}/>
 </aside>;
}
