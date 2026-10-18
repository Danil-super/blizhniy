"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {serviceModeration,ServiceClientError,type ServiceReviewDetail,type ServiceReviewItem,type ServiceReviewQueue} from '@/lib/client-service-publications';
import type {ServicePublicationKind} from '@/lib/service-publication-contract';import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
const labels:Record<string,string>={title:'Название',description:'Описание',cityName:'Город',professionName:'Профессия',district:'Район',address:'Адрес',latitude:'Широта',longitude:'Долгота',
 showExactAddress:'Показ точного адреса',contactPhone:'Телефон',email:'Email',messengerUrl:'Мессенджер',videoUrl:'Видео',placementRightConfirmed:'Право размещения подтверждено',
 price:'Стоимость работ, ₽',skills:'Навыки',experience:'Опыт',category:'Категория',comment:'Комментарий организатору (приватный)',href:'Ссылка'};
function ReviewPhoto({actor,kind,id,file,index,count}:{actor:string;kind:ServicePublicationKind;id:string;file:string;index:number;count:number}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();let objectUrl:string|null=null;setError(false);
  void serviceModeration.adminPhoto(actor,kind,id,file,{signal:controller.signal}).then(blob=>{if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}})
   .catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[actor,kind,id,file,retry]);
 return url?<div role="img" aria-label={`Фотография ${index+1} из ${count}`} className="mt-3 h-64 max-w-full bg-contain bg-center bg-no-repeat" style={{backgroundImage:`url("${url}")`}}/>:
  <div role="status"><p>{error?'Не удалось загрузить фотографию. Не одобряйте её без проверки.':'Загружаем фотографию…'}</p>{error&&<button type="button" className={draftButton} onClick={()=>setRetry(value=>value+1)}>Повторить загрузку фото</button>}</div>;
}
export function ServiceModerationWorkspace({actor,kind,visible}:{actor:string;kind:ServicePublicationKind;visible:boolean}){
 const [queue,setQueue]=useState<ServiceReviewQueue|null>(null),[detail,setDetail]=useState<ServiceReviewDetail|null>(null),[note,setNote]=useState('');
 const [message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[photo,setPhoto]=useState(0);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false),noteId=useId();
 useDraftLeaveGuard(uncertain||!!note.trim()&&detail?.request.state==='pending');
 const run=useCallback(async<T,>(work:(signal:AbortSignal|undefined)=>Promise<T>,apply:(value:T)=>void,write=false)=>{
  if(!visible||locked.current)return;locked.current=true;setBusy(true);setMessage(null);if(write)setUncertain(true);const generation=epoch.current;
  try{const result=await work(scope.current?.signal);if(epoch.current===generation)apply(result);}
  catch(error){if(epoch.current===generation){const failure=error instanceof ServiceClientError?error:new ServiceClientError('UNKNOWN');setMessage(failure.message);
   if(['UNAUTHENTICATED','ADMIN_REQUIRED'].includes(failure.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 },[visible]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;setBusy(false);
  if(visible)void run(signal=>serviceModeration.adminList(actor,kind,null,{signal}),setQueue);
  return()=>{epoch.current=generation+1;controller.abort();};
 },[actor,kind,visible,run]);
 function open(item:ServiceReviewItem,readback=false){
  if(!readback&&(uncertain||note.trim()&&detail?.request.state==='pending')&&!window.confirm('Закрыть проверку? Несохранённая причина отказа будет потеряна; отправленное решение не отменяется.'))return;
  void run(signal=>serviceModeration.adminInspect(actor,kind,item,{signal}),value=>{setDetail(value);setPhoto(0);setUncertain(false);if(!readback||value.request.state!=='pending')setNote(value.request.note??'');});
 }
 const item=():ServiceReviewItem=>({id:detail!.request.id!,publicationId:detail!.snapshot.id,kind,revision:detail!.snapshot.revision,title:detail!.snapshot.form.title,updatedAt:detail!.snapshot.updatedAt});
 function decide(state:'approved'|'rejected'){
  if(!detail?.request.id||detail.request.state!=='pending'||uncertain)return;const reason=state==='rejected'?note.trim():null;
  if(state==='rejected'&&!reason){setMessage('Укажите причину отказа.');return;}const selected=item();
  void run(signal=>serviceModeration.adminDecide(actor,kind,selected,state,reason,{signal}),value=>{
   setDetail(current=>current?{...current,request:value}:null);setUncertain(false);setNote(value.note??'');setQueue(current=>current?{...current,items:current.items.filter(row=>row.id!==selected.id)}:null);
  },true);
 }
 if(!visible)return null;const form=detail?.snapshot.form,photos=detail?.snapshot.photos??[];
 return <div className="min-w-0"><p className="mt-3 text-slate-600">Проверяйте текст, контакты и фотографии. Одобрение не списывает деньги и не публикует материал.</p>
  <button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>void run(signal=>serviceModeration.adminList(actor,kind,null,{signal}),setQueue)}>Обновить очередь</button>
  {busy&&<p className="mt-3" role="status">Проверяем данные…</p>}{message&&<p className="mt-3 break-words text-rose-700" role="alert">{message}</p>}
  {queue&&<section className="mt-5" aria-label="Очередь модерации"><h2 className="text-xl font-bold">Ожидают проверки</h2>
   {queue.items.length===0?<p className="mt-3">Нет материалов, ожидающих проверки.</p>:<ul className="mt-3 divide-y divide-slate-200">{queue.items.map(row=><li key={row.id}>
    <button type="button" className={`${draftButton} my-2 w-full break-words text-left`} disabled={busy} onClick={()=>open(row)}>{row.title||'Без названия'}</button></li>)}</ul>}
   {queue.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>void run(signal=>serviceModeration.adminList(actor,kind,queue.nextCursor,{signal}),setQueue)}>Следующая страница очереди</button>}
  </section>}
  {detail&&form&&<section aria-label="Проверка материала модератором" className="mt-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4">
   <h2 className="break-words text-xl font-bold">{form.title}</h2><p className="mt-2 text-sm">Версия {detail.snapshot.revision}.</p>
   <dl className="mt-4 grid min-w-0 gap-x-4 gap-y-2 break-words sm:grid-cols-[auto_1fr]">{Object.entries(form).filter(([key])=>key!=='kind'&&key!=='photoIds').map(([key,value])=><div key={key} className="contents">
    <dt className="font-semibold">{labels[key]}</dt><dd className="whitespace-pre-wrap">{typeof value==='boolean'?value?'Да':'Нет':String(value??'Не указано')}</dd></div>)}</dl>
   {detail.issues.length>0&&<ul className="mt-4 list-disc pl-5">{detail.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
   {photos.length>0&&<div className="mt-4"><h3 className="font-bold">Фотографии: {photos.length}</h3>
    <ReviewPhoto key={`${detail.request.id}:${photo}`} actor={actor} kind={kind} id={detail.request.id!} file={photos[photo].id} index={photo} count={photos.length}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy||photo===0} onClick={()=>setPhoto(value=>value-1)}>Предыдущая фотография</button>
     <button type="button" className={draftButton} disabled={busy||photo>=photos.length-1} onClick={()=>setPhoto(value=>value+1)}>Следующая фотография</button></div></div>}
   <p className="mt-5" role="status">{detail.request.state==='approved'?'Одобрено для оплаты. Публикация ещё не размещена.':detail.request.state==='rejected'?`Отклонено: ${detail.request.note}`:'Решение ещё не принято.'}</p>
   {detail.request.state==='pending'&&<div className="mt-4"><label htmlFor={noteId} className="block font-semibold">Причина отказа</label>
    <textarea id={noteId} className="mt-2 min-h-24 w-full rounded-lg border border-slate-500 p-3" maxLength={1000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy||uncertain||!!detail.issues.length} onClick={()=>decide('approved')}>Одобрить для оплаты</button>
     <button type="button" className={draftButton} disabled={busy||uncertain||!note.trim()} onClick={()=>decide('rejected')}>Отклонить с причиной</button></div></div>}
   <button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>open(item(),true)}>Сверить решение</button>
  </section>}
 </div>;
}
