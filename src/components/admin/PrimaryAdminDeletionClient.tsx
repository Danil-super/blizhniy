'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {AccountAuthSnapshot} from '@/lib/account-session-state';
import type {AdminDeletionCase,DeletionResolution} from '@/lib/account-deletion-contract';
import {deletionRequest,deletionDate,deletionStatus} from '@/lib/account-deletion-client';

const button='min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-brand-blue disabled:opacity-50';
function CaseCard({item,busy,onBegin,onResolve}:{item:AdminDeletionCase;busy:boolean;onBegin:()=>void;
 onResolve:(decision:{resolution:DeletionResolution;caseReference:string;confirmedManualDecision:true})=>void}){
 const [resolution,setResolution]=useState<DeletionResolution>('declined'),[reference,setReference]=useState(''),[confirmed,setConfirmed]=useState(false);
 return <article className="rounded-xl border border-slate-200 bg-white p-4">
  <div className="flex flex-wrap justify-between gap-2"><h2 className="break-all font-semibold">{item.email??'Аккаунт удалён'}</h2><span className="text-sm text-slate-600">{deletionStatus[item.status]}</span></div>
  <p className="mt-2 text-sm text-slate-600">{deletionDate(item.requestedAt)} · № {item.id}</p>
  {item.status==='requested'?<button className={button+' mt-4'} disabled={busy} onClick={onBegin}>Начать рассмотрение</button>:<form className="mt-4 grid gap-3" onSubmit={event=>{event.preventDefault();if(confirmed)onResolve({resolution,caseReference:reference,confirmedManualDecision:true});}}>
   <label className="text-sm font-semibold">Результат<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" value={resolution} onChange={event=>setResolution(event.target.value as DeletionResolution)}>
    <option value="declined">Отказать</option><option value="partly_retained">Часть данных сохранена по основанию</option><option value="fulfilled">Исполнение подтверждено</option></select></label>
   <label className="text-sm font-semibold">Номер защищённого дела<input required pattern="[A-Za-z0-9_-]{6,80}" minLength={6} maxLength={80} value={reference} onChange={event=>setReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" aria-describedby={'case-'+item.id}/></label>
   <p id={'case-'+item.id} className="text-xs text-slate-600">6–80 латинских букв, цифр, дефисов или подчёркиваний. Без персональных данных.</p>
   <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4"/>Подтверждаю: необходимые действия выполнены вручную, основание решения и ответ пользователю зафиксированы в защищённом деле.</label>
   <button className={button+' justify-self-start'} disabled={busy||!confirmed}>Записать решение</button>
  </form>}
 </article>;
}
export function PrimaryAdminDeletionClient({auth}:{auth:AccountAuthSnapshot}){
 const [items,setItems]=useState<AdminDeletionCase[]>([]),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
 const generation=useRef(0),inFlight=useRef(false);
 const discard=useCallback(()=>{generation.current++;},[]);
 const invalidate=useCallback(()=>{generation.current++;setItems([]);setLoaded(false);setError('');},[]);
 useEffect(()=>{window.addEventListener('blizhniy-account-changing',invalidate);return()=>{discard();window.removeEventListener('blizhniy-account-changing',invalidate);};},[invalidate,discard]);
 useEffect(()=>{setPage(0);},[auth.userId]);
 useEffect(()=>{
  const version=++generation.current;setItems([]);setLoaded(false);setError('');setBusy(false);inFlight.current=false;
  if(auth.state!=='admin'||!auth.userId)return;
  void deletionRequest<{requests:AdminDeletionCase[];hasMore:boolean}>('list',{expectedAdminId:auth.userId,page},true).then(result=>{
   if(version===generation.current){setItems(result.requests);setHasMore(result.hasMore);setLoaded(true);}
  }).catch(cause=>{if(version===generation.current)setError(cause instanceof Error?cause.message:'Не удалось загрузить очередь.');});
  return discard;
 },[auth.state,auth.userId,page,reload,discard]);
 async function change(item:AdminDeletionCase,decision?:{resolution:DeletionResolution;caseReference:string;confirmedManualDecision:true}){
  if(inFlight.current||!auth.userId||auth.state!=='admin')return;inFlight.current=true;setBusy(true);setError('');const version=generation.current;
  try{
   await deletionRequest(decision?'resolve':'begin',{expectedAdminId:auth.userId,id:item.id,revision:item.revision,...(decision?{decision}:{})},true);
   if(version===generation.current){if(decision)setPage(0);setReload(value=>value+1);}
  }catch(cause){if(version===generation.current)setError(cause instanceof Error?cause.message:'Не удалось записать решение.');}
  finally{if(version===generation.current){inFlight.current=false;setBusy(false);}}
 }
 if(auth.state==='loading')return <p role="status">Проверяем доступ…</p>;
 if(auth.state!=='admin')return <p role="alert">Нужен вход администратора. <Link href="/auth" className="underline">Войти</Link></p>;
 return <section className="max-w-3xl space-y-4">
  <p className="text-sm leading-6 text-slate-600">Очередь заявок. Решение записывается после ручного рассмотрения и выполнения необходимых действий. Изменение статуса само по себе не удаляет аккаунт и данные.</p>
  <button className={button} disabled={busy} onClick={()=>setReload(value=>value+1)}>Обновить очередь</button>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {!loaded&&!error?<p role="status">Загружаем заявки…</p>:loaded&&!items.length?<p role="status">{page?'На этой странице активных заявок нет.':'Активных заявок нет.'}</p>:items.map(item=><CaseCard key={item.id+':'+item.revision} item={item} busy={busy} onBegin={()=>void change(item)} onResolve={decision=>void change(item,decision)}/>)}
  <div className="flex gap-3">{page>0&&<button className={button} disabled={busy} onClick={()=>setPage(value=>value-1)}>Предыдущая страница</button>}{loaded&&hasMore&&<button className={button} disabled={busy} onClick={()=>setPage(value=>value+1)}>Следующая страница</button>}</div>
 </section>;
}
