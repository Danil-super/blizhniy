"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {workModeration,WorkModerationClientError,type WorkReviewDetail,type WorkReviewItem,type WorkReviewQueue} from '@/lib/client-work-moderation';
import {notifyAccountSessionChange} from '@/lib/local-account';
import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';
import type {ListingDraftPhoto} from '@/lib/listing-photo-contract';
const labels:Record<string,string>={title:'Название',description:'Описание',cityName:'Город',professionName:'Специализация',district:'Район',address:'Адрес',latitude:'Широта',longitude:'Долгота',
 showExactAddress:'Показ точного адреса',contactPhone:'Телефон',messengerUrl:'Мессенджер',placementRightConfirmed:'Право размещения подтверждено',budget:'Бюджет',salary:'Оплата',organization:'Работодатель',
 employerType:'Тип работодателя',inn:'ИНН',ogrn:'ОГРН',ogrnip:'ОГРНИП',contactPerson:'Контактное лицо',email:'Email',website:'Сайт',requirements:'Требования',responsibilities:'Обязанности',conditions:'Условия',schedule:'График',workFormat:'Формат работы'};

function ReviewPhoto({actor,id,photo,index,count}:{actor:string;id:string;photo:ListingDraftPhoto;index:number;count:number}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState(false);
 useEffect(()=>{const controller=new AbortController();let objectUrl:string|null=null;
  void workModeration.adminPhoto(actor,id,photo.id,{signal:controller.signal}).then(blob=>{if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}})
   .catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[actor,id,photo.id]);
 return url?<div role="img" aria-label={`Фотография ${index+1} из ${count}`} className="mt-3 h-64 max-w-full bg-contain bg-center bg-no-repeat" style={{backgroundImage:`url("${url}")`}}/>:
  <p role="status">{error?'Не удалось загрузить фотографию. Не одобряйте её без проверки.':'Загружаем фотографию…'}</p>;
}
export function WorkModerationWorkspace({actor,visible}:{actor:string;visible:boolean}){
 const [queue,setQueue]=useState<WorkReviewQueue|null>(null),[detail,setDetail]=useState<WorkReviewDetail|null>(null),[note,setNote]=useState('');
 const [message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[photo,setPhoto]=useState(0);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 const noteId=useId();
 useDraftLeaveGuard(uncertain||!!note.trim()&&detail?.request.state==='pending');
 const run=useCallback(async<T,>(work:(signal:AbortSignal|undefined)=>Promise<T>,apply:(value:T)=>void,write=false)=>{
  if(!visible||locked.current)return;locked.current=true;setBusy(true);setMessage(null);if(write)setUncertain(true);const generation=epoch.current;
  try{const result=await work(scope.current?.signal);if(epoch.current===generation)apply(result);}
  catch(error){if(epoch.current===generation){const failure=error instanceof WorkModerationClientError?error:new WorkModerationClientError('UNKNOWN');setMessage(failure.message);
   if(['UNAUTHENTICATED','ADMIN_REQUIRED'].includes(failure.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}}}
  finally{if(epoch.current===generation){locked.current=false;setBusy(false);}}
 },[visible]);
 useEffect(()=>{const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;setBusy(false);
  if(visible)void run(signal=>workModeration.adminList(actor,null,{signal}),setQueue);
  return()=>{epoch.current=generation+1;controller.abort();};
 },[actor,visible,run]);
 function open(item:WorkReviewItem,readback=false){
  if(!readback&&(uncertain||note.trim()&&detail?.request.state==='pending')&&!window.confirm('Закрыть текущую проверку? Несохранённая причина отказа будет потеряна; отправленное решение не отменяется.'))return;
  void run(signal=>workModeration.adminInspect(actor,item,{signal}),value=>{setDetail(value);setPhoto(0);setUncertain(false);if(!readback||value.request.state!=='pending')setNote(value.request.note??'');});
 }
 function decide(state:'approved'|'rejected'){
  if(!detail?.request.id||detail.request.state!=='pending'||uncertain)return;
  const reason=state==='rejected'?note.trim():null;if(state==='rejected'&&!reason){setMessage('Укажите причину отказа.');return;}
  const item={id:detail.request.id,publicationId:detail.snapshot.id,kind:detail.snapshot.kind,revision:detail.snapshot.revision,title:detail.snapshot.form.title,updatedAt:detail.snapshot.updatedAt};
  void run(signal=>workModeration.adminDecide(actor,item,state,reason,{signal}),value=>{setDetail(current=>current?{...current,request:value}:null);setUncertain(false);setNote(value.note??'');
   setQueue(current=>current?{...current,items:current.items.filter(row=>row.id!==item.id)}:null);},true);
 }
 if(!visible)return null;
 const form=detail?.snapshot.form,photos=detail?.snapshot.photos??[];
 return <div className="min-w-0">
  <p className="mt-3 text-slate-600">Проверяйте текст, работодателя и фотографии. Одобрение не публикует материал и не запускает оплату.</p>
  <button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>void run(signal=>workModeration.adminList(actor,null,{signal}),setQueue)}>Обновить очередь</button>
  {busy&&<p className="mt-3" role="status">Проверяем данные…</p>}{message&&<p className="mt-3 break-words text-rose-700" role="alert">{message}</p>}
  {queue&&<section className="mt-5" aria-label="Очередь модерации"><h2 className="text-xl font-bold">Ожидают проверки</h2>
   {queue.items.length===0?<p className="mt-3">Нет вакансий и заказов, ожидающих проверки.</p>:<ul className="mt-3 divide-y divide-slate-200">{queue.items.map(item=><li key={item.id}>
    <p className="mt-3 text-sm text-slate-600">{item.kind==='vacancy'?'Вакансия':'Заказ'}</p><button type="button" className={`${draftButton} my-2 w-full break-words text-left`} disabled={busy} onClick={()=>open(item)}>{item.title||'Без названия'}</button>
   </li>)}</ul>}
   {queue.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={busy} onClick={()=>void run(signal=>workModeration.adminList(actor,queue.nextCursor,{signal}),setQueue)}>Следующая страница очереди</button>}
  </section>}
  {detail&&form&&<section aria-label="Проверка публикации модератором" className="mt-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4">
   <h2 className="break-words text-xl font-bold">{form.title}</h2><p className="mt-2 text-sm">Версия {detail.snapshot.revision}. {form.kind==='vacancy'?'Вакансия':'Заказ'}.</p>
   <dl className="mt-4 grid min-w-0 gap-x-4 gap-y-2 break-words sm:grid-cols-[auto_1fr]">{Object.entries(form).filter(([key])=>key!=='kind'&&key!=='photoIds').map(([key,value])=><div key={key} className="contents">
    <dt className="font-semibold">{labels[key]}</dt><dd className="whitespace-pre-wrap">{typeof value==='boolean'?value?'Да':'Нет':String(value??'Не указано')}</dd>
   </div>)}</dl>
   {detail.issues.length>0&&<ul className="mt-4 list-disc pl-5">{detail.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
   {photos.length>0&&<div className="mt-4"><h3 className="font-bold">Фотографии: {photos.length}</h3>
    <ReviewPhoto key={`${detail.request.id}:${photo}`} actor={actor} id={detail.request.id!} photo={photos[photo]} index={photo} count={photos.length}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy||photo===0} onClick={()=>setPhoto(value=>value-1)}>Предыдущая фотография</button>
     <button type="button" className={draftButton} disabled={busy||photo>=photos.length-1} onClick={()=>setPhoto(value=>value+1)}>Следующая фотография</button></div>
   </div>}
   <p className="mt-5" role="status">{detail.request.state==='approved'?'Одобрено для оплаты. Публикация ещё не размещена.':detail.request.state==='rejected'?`Отклонено: ${detail.request.note}`:'Решение ещё не принято.'}</p>
   {detail.request.state==='pending'&&<div className="mt-4"><label htmlFor={noteId} className="block font-semibold">Причина отказа</label>
    <textarea id={noteId} className="mt-2 min-h-24 w-full rounded-lg border border-slate-500 p-3" maxLength={1000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={busy||uncertain||!!detail.issues.length} onClick={()=>decide('approved')}>Одобрить для оплаты</button>
     <button type="button" className={draftButton} disabled={busy||uncertain||!note.trim()} onClick={()=>decide('rejected')}>Отклонить с причиной</button></div>
   </div>}
   <button type="button" className={`${draftButton} mt-4`} disabled={busy} onClick={()=>open({id:detail.request.id!,publicationId:detail.snapshot.id,kind:detail.snapshot.kind,revision:detail.snapshot.revision,title:form.title,updatedAt:detail.snapshot.updatedAt},true)}>Сверить решение</button>
  </section>}
 </div>;
}
