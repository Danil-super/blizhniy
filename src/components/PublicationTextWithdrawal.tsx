"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {postPublicationPrivacy,type PublicationPrivacyTarget,type WithdrawPublicationText} from '@/lib/client-publication-privacy';
import {publicationTextLabels,publicationTextRange,type PublicationTextField} from '@/lib/publication-text-selection';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {PublicationConsent} from './PublicationConsent';

type Field={field:PublicationTextField;text:string;visible:string;fingerprint:string};

export function PublicationTextWithdrawal(target:PublicationPrivacyTarget){
 const [open,setOpen]=useState(false);
 return <details className="my-3 rounded-lg border border-slate-200 p-3 text-sm" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-blue-800 underline">Видимость текста</summary>
  {open&&<TextChooser {...target}/>}
 </details>;
}

function TextChooser({owner,kind,publicationId}:PublicationPrivacyTarget){
 const [fields,setFields]=useState<Field[]>(),[field,setField]=useState<PublicationTextField>();
 const [range,setRange]=useState<{start:number;end:number}|null>(null),[confirm,setConfirm]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false);
 const [consentEnabled,setConsentEnabled]=useState(false);
 const scope=useRef<AbortController|null>(null),result=useRef<HTMLParagraphElement>(null);
 const selected=fields?.find(item=>item.field===field);

 const request=useCallback(async (command?:WithdrawPublicationText)=>{
  const controller=scope.current;if(!controller||controller.signal.aborted)return;
  const target={owner,kind,publicationId};
  setBusy(true);setError(false);setSaved(false);
  try{
   if(command){
    const changed=await postPublicationPrivacy(target,command,controller.signal);
    if(changed.status===401&&!controller.signal.aborted)notifyAccountSessionChange(false);
    if(!changed.ok)throw Error();
   }
   const response=await postPublicationPrivacy(target,{action:'texts'},controller.signal);
   if(controller.signal.aborted)return;
   if(response.status===401)notifyAccountSessionChange(false);
   if(!response.ok)throw Error();
   const data=await response.json();
   if(controller.signal.aborted)return;
   if(data.kind!==kind||data.publicationId!==publicationId||!Array.isArray(data.texts)||
      data.texts.length>Object.keys(publicationTextLabels).length)throw Error();
   const list:Field[]=data.texts;
   if(list.some(item=>!Object.hasOwn(publicationTextLabels,item.field)||typeof item.text!=='string'||
       typeof item.visible!=='string'||typeof item.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(item.fingerprint))||
      new Set(list.map(item=>item.field)).size!==list.length)throw Error();
   setFields(list);setField(current=>list.some(item=>item.field===current)?current:list[0]?.field);
   setConsentEnabled(data.textConsent===true);
   setSaved(!!command);
  }catch{if(!controller.signal.aborted)setError(true);}
  finally{if(!controller.signal.aborted){setBusy(false);setConfirm(false);setRange(null);}}
 },[owner,kind,publicationId]);

 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;
  void request();
  return ()=>controller.abort();
 },[request]);
 useEffect(()=>{if(saved)result.current?.focus({preventScroll:true});},[saved]);

 if(error)return <div className="grid gap-2">
  <p role="status">Не удалось подтвердить состояние текста.</p>
  <div><button className={draftButton} type="button" disabled={busy} onClick={()=>void request()}>Сверить текст</button></div>
 </div>;
 if(!fields)return <p role="status">Загружаем текст публикации…</p>;
 if(!selected)return <p role="status">Нет текста для скрытия.</p>;
 return <div className="grid gap-3">
  <label className="grid gap-1">Поле публикации
   <select value={field} disabled={busy} className="min-h-11 rounded border border-slate-500 bg-white px-2"
    onChange={event=>{setField(event.currentTarget.value as PublicationTextField);setRange(null);setConfirm(false);setSaved(false);}}>
    {fields.map(item=><option key={item.field} value={item.field}>{publicationTextLabels[item.field]}</option>)}
   </select>
  </label>
  <label className="grid gap-1">Исходный текст. Выделите фрагмент, который нужно скрыть
   <textarea key={field} readOnly value={selected.text} rows={5} className="w-full rounded border border-slate-500 p-2"
    onSelect={event=>{
     const input=event.currentTarget;
     const next=publicationTextRange(selected.text,input.selectionStart,input.selectionEnd);
     if(next?.start!==range?.start||next?.end!==range?.end){setRange(next);setConfirm(false);setSaved(false);}
    }}/>
  </label>
  <div><p className="font-semibold">{consentEnabled?'Текст после скрытия фрагментов':'Видимый текст'}</p>
   <p className="whitespace-pre-wrap break-words">{selected.visible||'Поле скрыто целиком.'}</p>
  </div>
  {saved&&<p ref={result} tabIndex={-1} role="status">Фрагмент скрыт.</p>}
  {confirm&&<p>Выделенный фрагмент исчезнет из публичной выдачи. Если исходное поле изменится, оно будет скрыто целиком до проверки.</p>}
  <div className="flex flex-wrap gap-2">
   <button className={draftButton} type="button" disabled={!range||!selected.visible||busy} onClick={()=>{
    if(confirm&&range)void request({action:'withdraw-text',field:selected.field,fingerprint:selected.fingerprint,...range});
    else setConfirm(true);
   }}>{confirm?'Подтвердить скрытие фрагмента':'Скрыть выделенный фрагмент'}</button>
   {confirm&&<button className={draftButton} type="button" disabled={busy} onClick={()=>setConfirm(false)}>Оставить текст</button>}
  </div>
  {consentEnabled&&selected.visible&&<PublicationConsent
   key={owner+'|'+publicationId+'|'+selected.field+'|'+selected.fingerprint+'|'+selected.visible}
   owner={owner} kind={kind} publicationId={publicationId} category="text" field={selected.field}/>}
 </div>;
}
