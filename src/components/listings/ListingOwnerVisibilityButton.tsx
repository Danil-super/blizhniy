"use client";
import {ensurePhoneForPlacement} from '@/lib/phone-placement';
import {PhoneClientError} from '@/lib/client-phone-verification';
import {useEffect,useRef,useState} from 'react';
import {listingCabinet,ListingCabinetClientError} from '@/lib/client-listing-cabinet';
import {notifyAccountSessionChange} from '@/lib/local-account';
export function ListingOwnerVisibilityButton({owner,id,revision,restore,onChanged}:{owner:string;id:string;revision:string;restore:boolean;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false);
 const scope=useRef<AbortController|null>(null),locked=useRef(false);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;return()=>controller.abort();},[owner,id]);
 async function change(){
  if(locked.current||uncertain)return;
  if(!window.confirm(restore?'Вернуть объявление в каталог на оставшийся оплаченный срок?':'Снять объявление с публикации? Оплаченный срок продолжит идти.'))return;
  locked.current=true;setBusy(true);setError(null);const controller=scope.current;
  try{if(restore)await ensurePhoneForPlacement(owner);await listingCabinet.change(owner,id,revision,restore?'restore':'withdraw',{signal:controller?.signal});if(!controller?.signal.aborted)onChanged();}
  catch(failure){if(!controller?.signal.aborted){
   if(failure instanceof PhoneClientError){setError(failure.message);setUncertain(false);return;}
   const code=failure instanceof ListingCabinetClientError?failure.code:'UNKNOWN';
   if(['UNAUTHENTICATED','SESSION_CHANGED'].includes(code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
   setUncertain(code==='UNKNOWN');setError(code==='PHONE_REQUIRED'?'Подтвердите номер телефона для повторной публикации.':code==='DRAFT_CHANGED'?'Объявление изменилось. Обновите список.':code==='DRAFT_NOT_FOUND'?'Действие недоступно: проверьте статус, блокировку и срок размещения.':code==='UNKNOWN'?'Результат пока не подтверждён. Проверьте статус перед повтором.':'Действие не выполнено. Попробуйте позже.');
  }}finally{if(!controller?.signal.aborted){locked.current=false;setBusy(false);}}
 }
 return <div><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-[#0875d1] hover:bg-blue-50 disabled:opacity-50" disabled={busy||uncertain} onClick={()=>void change()}>{busy?'Сохраняем…':restore?'Опубликовать снова':'Снять с публикации'}</button>
  {error&&<p role="alert" className="max-w-64 px-3 py-2 text-sm text-red-800">{error}</p>}
  {uncertain&&<button type="button" className="min-h-11 px-3 text-sm font-semibold text-[#0875d1] underline" onClick={()=>window.location.reload()}>Проверить результат</button>}
 </div>;
}
