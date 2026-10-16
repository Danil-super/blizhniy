"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {adminListingModeration,AdminModerationClientError,type ModerationQueue,type ModerationQueueItem,type ModerationDetail} from '@/lib/client-admin-listing-moderation';
import {notifyAccountSessionChange} from '@/lib/local-account';import {draftButton} from '@/components/listings/PrivateDraftEditor';
import {useDraftLeaveGuard} from '@/components/listings/useDraftLeaveGuard';import {ModerationPhotoPreview} from './ModerationPhotoPreview';
const field='mt-2 min-h-24 w-full rounded-lg border border-slate-500 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700';
const kindLabels={prodam:'Продам',kuplyu:'Куплю','otdam-darom':'Отдам даром',arenda:'Аренда'};
export function ListingModerationWorkspace({actor,visible}:{actor:string;visible:boolean}){
 const [queue,setQueue]=useState<ModerationQueue|null>(null),[detail,setDetail]=useState<ModerationDetail|null>(null),[note,setNote]=useState('');
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[photo,setPhoto]=useState(0);
 const scope=useRef<AbortController|null>(null),epoch=useRef(0),locked=useRef(false);
 useDraftLeaveGuard(uncertain||!!note.trim()&&detail?.request.state==='pending');
 const run=useCallback(async<T,>(label:string,work:(signal:AbortSignal|undefined)=>Promise<T>,apply:(result:T)=>void,write=false)=>{
  if(!visible||locked.current)return;locked.current=true;setBusy(label);setError(null);if(write)setUncertain(true);const generation=epoch.current;
  try{const result=await work(scope.current?.signal);if(epoch.current===generation)apply(result);}
  catch(error){if(epoch.current===generation){
   const failure=error instanceof AdminModerationClientError?error:new AdminModerationClientError('UNKNOWN');setError(failure.message);
   if(write||failure.code==='DRAFT_CHANGED'||failure.code==='DRAFT_NOT_FOUND')setUncertain(true);
   if(['ADMIN_REQUIRED','UNAUTHENTICATED'].includes(failure.code)){notifyAccountSessionChange(true);notifyAccountSessionChange(false);}
  }}finally{if(epoch.current===generation){locked.current=false;setBusy(null);}}
 },[visible]);
 useEffect(()=>{
  const controller=new AbortController();scope.current=controller;const generation=++epoch.current;locked.current=false;setBusy(null);
  if(visible)void run('Загружаем очередь…',signal=>adminListingModeration.list(actor,null,{signal}),setQueue);
  return()=>{epoch.current=generation+1;controller.abort();};
 },[actor,visible,run]);
 function open(item:ModerationQueueItem,readback=false){
  if(!readback&&(uncertain||detail?.request.state==='pending'&&note.trim())&&!window.confirm('Закрыть текущую проверку? Несохранённая причина отказа будет потеряна; отправленное решение не отменяется.'))return;
  void run('Открываем сохранённую версию…',signal=>adminListingModeration.inspect(actor,item.id,item.listingId,{signal}),result=>{
   setDetail(result);setPhoto(0);setUncertain(false);setNote(result.request.state==='pending'&&readback?note:result.request.note??'');
  });
 }
 function decide(state:'approved'|'rejected'){
  if(!detail?.request.id||detail.request.state!=='pending'||uncertain||locked.current)return;
  const reason=state==='rejected'?note.trim():null;if(state==='rejected'&&!reason){setError('Укажите причину отказа.');return;}
  void run('Сохраняем решение…',signal=>adminListingModeration.decide(actor,detail.request.id!,detail.snapshot.revision,state,reason,{signal}),result=>{
   setDetail(current=>current?{...current,request:result}:null);setUncertain(false);setNote(result.note??'');
   setQueue(current=>current?{...current,items:current.items.filter(item=>item.id!==result.id)}:null);
  },true);
 }
 if(!visible)return null;
 const form=detail?.snapshot.form,photos=detail?.snapshot.photos??[];
 return <div>
  <p className="mt-3 text-slate-600">Одобрение разрешает перейти к оплате, но не публикует объявление и не запускает платёж. Проверяйте текст, контакты и фотографии.</p>
  <button type="button" className={`${draftButton} mt-4`} disabled={!!busy} onClick={()=>void run('Обновляем очередь…',signal=>adminListingModeration.list(actor,null,{signal}),setQueue)}>Обновить очередь</button>
  {busy&&<p className="mt-3" role="status">{busy}</p>}{error&&<p className="mt-3 break-words" role="alert">{error}</p>}
  {queue&&<section className="mt-5" aria-label="Очередь модерации"><h2 className="text-xl font-bold">Ожидают проверки</h2>
   {queue.items.length===0?<p className="mt-3">Нет объявлений, ожидающих модерации.</p>:<ul className="mt-3 divide-y divide-slate-200">{queue.items.map(item=><li key={item.id}>
    <button type="button" className={`${draftButton} my-2 w-full break-words text-left`} disabled={!!busy} onClick={()=>open(item)}>{item.title||'Без названия'}</button></li>)}</ul>}
   {queue.nextCursor&&<button type="button" className={`${draftButton} mt-3`} disabled={!!busy} onClick={()=>void run('Загружаем следующую страницу…',signal=>adminListingModeration.list(actor,queue.nextCursor,{signal}),setQueue)}>Следующая страница очереди</button>}
  </section>}
  {detail&&form&&<section className="mt-6 min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-label="Проверка объявления модератором">
   <h2 className="break-words text-xl font-bold">{form.title}</h2><p className="mt-2 text-sm">Проверяется сохранённая версия {detail.snapshot.revision}.</p>
   <p className="mt-3 whitespace-pre-wrap break-words">{form.description}</p>
   <dl className="mt-4 grid min-w-0 gap-x-4 gap-y-2 break-words sm:grid-cols-[auto_1fr]">
    <dt>Тип</dt><dd>{kindLabels[form.kind]}</dd><dt>Цена в объявлении</dt><dd>{form.price?.replace('.',',')??'Не указана'}</dd>
    <dt>Категория (код)</dt><dd>{form.categorySlug} / {form.subcategoryName}</dd><dt>Город и район</dt><dd>{form.cityName}, {form.district??'Не указан'}</dd>
    <dt>Адрес</dt><dd>{form.address??'Не указан'}</dd><dt>Координаты</dt><dd>{form.latitude??'—'}, {form.longitude??'—'}; точный адрес: {form.showExactAddress?'показывать':'скрывать'}</dd>
    <dt>Телефон</dt><dd>{form.contactPhone??'Не указан'}</dd><dt>Мессенджер</dt><dd>{form.messengerUrl??'Не указан'}</dd>
   </dl>
   {form.booking&&<details className="mt-4"><summary>Все параметры аренды</summary><pre className="mt-2 whitespace-pre-wrap break-all text-sm">{JSON.stringify(form.booking,null,2)}</pre></details>}
   {detail.check.issues.filter(issue=>issue.field!=='tariff').length>0&&<ul className="mt-4 list-disc pl-5">{detail.check.issues.filter(issue=>issue.field!=='tariff').map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
   {photos.length>0?<div className="mt-4"><h3 className="font-bold">Фотографии: {photos.length}</h3>
    <ModerationPhotoPreview key={`${detail.request.id}:${photo}`} actor={actor} requestId={detail.request.id!} photo={photos[photo]} index={photo} count={photos.length}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={photo===0||!!busy} onClick={()=>setPhoto(value=>value-1)}>Предыдущая фотография</button>
     <button type="button" className={draftButton} disabled={photo>=photos.length-1||!!busy} onClick={()=>setPhoto(value=>value+1)}>Следующая фотография</button></div>
   </div>:<p className="mt-4">Фотографий нет.</p>}
   <div className="mt-5" role="status">{detail.request.state==='approved'?'Одобрено для оплаты. Объявление ещё не опубликовано.':detail.request.state==='rejected'?`Отклонено: ${detail.request.note}`:'Решение ещё не принято.'}</div>
   {detail.request.state==='pending'&&<div className="mt-4"><label htmlFor="moderation-rejection-note" className="block font-semibold">Причина отказа</label>
    <textarea id="moderation-rejection-note" className={field} maxLength={1000} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)}/>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={draftButton} disabled={!!busy||uncertain||detail.check.issues.some(issue=>issue.field!=='tariff')} onClick={()=>decide('approved')}>Одобрить для оплаты</button>
     <button type="button" className={draftButton} disabled={!!busy||uncertain||!note.trim()} onClick={()=>decide('rejected')}>Отклонить с причиной</button></div>
   </div>}
   <button type="button" className={`${draftButton} mt-4`} disabled={!!busy} onClick={()=>open({id:detail.request.id!,listingId:detail.snapshot.id,revision:detail.snapshot.revision,title:form.title},true)}>Сверить решение</button>
  </section>}
 </div>;
}
