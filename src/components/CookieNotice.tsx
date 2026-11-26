'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {Cookie} from 'lucide-react';
import {cookieNoticeAcknowledgement,cookieNoticeOpenEvent,hasCookieNoticeAcknowledgement} from '@/lib/cookie-notice';
import {getAnalyticsConsent,saveAnalyticsConsent,subscribeAnalyticsConsent,type AnalyticsConsent} from '@/lib/analytics-consent';

function acknowledged(){
 try{return hasCookieNoticeAcknowledgement(document.cookie);}catch{return false;}
}
function remember(){
 try{document.cookie=cookieNoticeAcknowledgement();return acknowledged();}catch{return false;}
}
export function CookieNotice({initiallyAcknowledged,analyticsAvailable=false}:{initiallyAcknowledged:boolean;analyticsAvailable?:boolean}){
 const [canDismiss,setCanDismiss]=useState(false);
 const [docked,setDocked]=useState(false);
 const [consent,setConsent]=useState<AnalyticsConsent>('unknown'),[message,setMessage]=useState('');
 const pathname=usePathname(),[visible,setVisible]=useState(!initiallyAcknowledged),[manual,setManual]=useState(false);
 const dismissed=useRef(false),openedManually=useRef(false),opener=useRef<HTMLElement|null>(null);
 const panel=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  const update=(choice:AnalyticsConsent)=>{
   setConsent(choice);
   if(!openedManually.current)setVisible(choice==='unknown'&&!dismissed.current);
  };
  const unsubscribe=analyticsAvailable?subscribeAnalyticsConsent(update):null;
  if(!analyticsAvailable)setVisible(!acknowledged());
  setCanDismiss(true);
  const open=()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;openedManually.current=true;setManual(true);setMessage('');if(analyticsAvailable)setConsent(getAnalyticsConsent());setVisible(true);};
  const refresh=()=>{if(analyticsAvailable)update(getAnalyticsConsent());else if(!openedManually.current&&(dismissed.current||acknowledged()))setVisible(false);};
  const visibility=()=>{if(document.visibilityState==='visible')refresh();};
  const onFocus=(event:FocusEvent)=>{
   if(panel.current && event.target instanceof HTMLElement && !panel.current.contains(event.target) && event.target.matches(':focus-visible'))setDocked(true);
  };
  window.addEventListener(cookieNoticeOpenEvent,open);window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',visibility);
  document.addEventListener('focusin',onFocus);
  return()=>{unsubscribe?.();window.removeEventListener(cookieNoticeOpenEvent,open);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('focusin',onFocus);};
 },[analyticsAvailable]);
 useEffect(()=>{if(manual&&visible)panel.current?.focus();},[manual,visible]);
 const close=()=>{dismissed.current=true;openedManually.current=false;setManual(false);setVisible(false);setMessage('');opener.current?.focus();};
 const choose=(choice:'granted'|'denied')=>{
  // Keep the panel open on a storage failure, even when revocation immediately notifies consumers.
  openedManually.current=true;
  const saved=saveAnalyticsConsent(choice),effective=getAnalyticsConsent();setConsent(effective);
  if(!saved){
   setManual(true);setVisible(true);
   setMessage(choice==='denied'
    ? 'Аналитика отключена в этой вкладке. Браузер не сохранил выбор: при следующем открытии сайта проверьте настройки cookie.'
    : effective==='granted'?'Не удалось сохранить настройку. Ранее разрешенная аналитика остается включенной.'
    : 'Не удалось сохранить выбор. Аналитика не включена. Проверьте настройки cookie в браузере.');
   return;
  }
  remember();close();
 };
 // The short-lived verification window has its own completion/close flow.
 if(!visible||pathname==='/cabinet/phone'&&!manual)return null;
 const placement=pathname==='/auth'||pathname.startsWith('/auth/')
  ? 'relative mx-3 my-3 sm:mx-auto'
  : 'cookie-notice-floating fixed inset-x-3 bottom-[calc(var(--mobile-nav-clearance)+env(safe-area-inset-bottom))] mx-auto md:inset-x-auto md:bottom-5 md:left-5 md:right-5 md:mx-0';
 return <aside ref={panel} data-docked={docked&&!manual?'true':undefined} tabIndex={-1} aria-labelledby="cookie-notice-heading" className={`${placement} [@media(scripting:none)]:static z-[60] max-h-[calc(100dvh-var(--mobile-nav-clearance)-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg`} role="region">
  <div className="flex items-start gap-3">
   <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue"><Cookie aria-hidden="true" className="h-5 w-5"/></span>
   <div className="min-w-0 flex-1"><h2 id="cookie-notice-heading" className="text-sm font-bold text-brand-ink">Файлы cookie</h2>
    <p className="mt-1 text-sm leading-5 text-slate-600">{analyticsAvailable
     ? 'Обязательные cookie нужны для входа и защиты аккаунта. С вашего согласия Яндекс.Метрика поможет нам понять, как посетители пользуются публичными страницами сайта. Аналитику можно отключить в любой момент в настройках cookie.'
     : 'Используем cookie для входа и защиты аккаунта. Настройки сайта сохраняются в вашем браузере.'}{' '}<Link href="/legal/privacy#cookies" prefetch={false} className="font-semibold text-brand-blue underline underline-offset-2">Подробнее</Link></p>
    {analyticsAvailable&&manual&&<p role="status" className="mt-2 text-sm font-semibold text-slate-700">{consent==='granted'?'Аналитика включена.':consent==='denied'?'Аналитика отключена.':'Аналитика пока не включена.'} Обязательные cookie остаются доступными.</p>}
    {message&&<p role="alert" className="mt-2 text-sm text-rose-700">{message}</p>}
   </div>
  </div>
  <div className="mt-3 flex flex-wrap justify-end gap-2 [@media(scripting:none)]:hidden">{analyticsAvailable?<>
   <button type="button" disabled={!canDismiss} onClick={()=>choose('granted')} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-brand-blue bg-white px-4 py-2 text-sm font-semibold text-brand-blue transition disabled:opacity-60 enabled:hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Разрешить аналитику</button>
   <button type="button" disabled={!canDismiss} onClick={()=>choose('denied')} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-brand-blue bg-white px-4 py-2 text-sm font-semibold text-brand-blue transition disabled:opacity-60 enabled:hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">{manual?'Отключить аналитику':'Только необходимые'}</button>
   {manual&&<button type="button" onClick={close} className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Закрыть настройки</button>}
  </>:<button type="button" disabled={!canDismiss} onClick={()=>{remember();close();}} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-blue px-5 py-2 text-sm font-semibold text-white transition disabled:opacity-60 enabled:hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Понятно</button>}</div>
 </aside>;
}
export function CookieNoticeButton({analyticsAvailable=false}:{analyticsAvailable?:boolean}={}){
 return <button type="button" onClick={()=>window.dispatchEvent(new Event(cookieNoticeOpenEvent))} className="w-fit py-1 text-left text-sm font-semibold text-slate-700 transition hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">{analyticsAvailable?'Настройки cookie':'О файлах cookie'}</button>;
}
