'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {Cookie} from 'lucide-react';
import {cookieNoticeAcknowledgement,cookieNoticeOpenEvent,hasCookieNoticeAcknowledgement} from '@/lib/cookie-notice';

function acknowledged(){
 try{return hasCookieNoticeAcknowledgement(document.cookie);}catch{return false;}
}
function remember(){
 try{document.cookie=cookieNoticeAcknowledgement();return acknowledged();}catch{return false;}
}
export function CookieNotice(){
 const pathname=usePathname(),[visible,setVisible]=useState(false),[manual,setManual]=useState(false);
 const dismissed=useRef(false),openedManually=useRef(false),opener=useRef<HTMLElement|null>(null);
 const panel=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  setVisible(!acknowledged());
  const open=()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;openedManually.current=true;setManual(true);setVisible(true);};
  const refresh=()=>{if(!openedManually.current&&(dismissed.current||acknowledged()))setVisible(false);};
  const visibility=()=>{if(document.visibilityState==='visible')refresh();};
  window.addEventListener(cookieNoticeOpenEvent,open);window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener(cookieNoticeOpenEvent,open);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{if(manual&&visible)panel.current?.focus();},[manual,visible]);
 // The short-lived verification window has its own completion/close flow.
 if(!visible||pathname==='/cabinet/phone'&&!manual)return null;
 return <aside ref={panel} tabIndex={-1} aria-labelledby="cookie-notice-heading" className="fixed inset-x-3 bottom-[calc(var(--mobile-nav-clearance)+env(safe-area-inset-bottom))] z-[60] mx-auto max-h-[calc(100dvh-var(--mobile-nav-clearance)-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:inset-x-auto md:bottom-5 md:left-5 md:right-5 md:mx-0" role="region">
  <div className="flex items-start gap-3">
   <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue"><Cookie aria-hidden="true" className="h-5 w-5"/></span>
   <div className="min-w-0 flex-1"><h2 id="cookie-notice-heading" className="text-sm font-bold text-brand-ink">Файлы cookie</h2>
    <p className="mt-1 text-sm leading-5 text-slate-600">Используем cookie для входа и защиты аккаунта. Настройки сайта сохраняются в вашем браузере.{' '}<Link href="/legal/privacy#cookies" prefetch={false} className="font-semibold text-brand-blue underline underline-offset-2">Подробнее</Link></p>
   </div>
  </div>
  <div className="mt-3 flex justify-end"><button type="button" onClick={()=>{remember();dismissed.current=true;openedManually.current=false;setManual(false);setVisible(false);opener.current?.focus();}} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-blue px-5 py-2 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Понятно</button></div>
 </aside>;
}
export function CookieNoticeButton(){
 return <button type="button" onClick={()=>window.dispatchEvent(new Event(cookieNoticeOpenEvent))} className="w-fit py-1 text-left text-sm font-semibold text-slate-700 transition hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">О файлах cookie</button>;
}
