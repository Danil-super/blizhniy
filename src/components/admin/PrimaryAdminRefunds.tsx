'use client';
import {useServiceCheckout} from '@/components/listings/ListingWorkflowProvider';
import {useCallback,useEffect,useRef,useState} from 'react';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {adminRefunds} from '@/lib/client-admin-refunds';
import {refundButton as button,useAdminRefundActions} from './AdminRefundActions';
import type {AdminRefundPage,AdminRefundPayment} from '@/lib/postgres-admin-refund-journal';
const money=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const types:Record<string,string>={listing:'Объявление',vacancy:'Вакансия',workRequest:'Заказ',application:'Отклик',specialist:'Анкета',fair_application:'Ярмарка',ad_marquee:'Бегущая строка'};
function status(row:AdminRefundPayment){
 if(row.appliedAt)return'Возврат выполнен';
 if(row.refundStatus==='canceled')return'Возврат отменён';
 if(row.refundStatus==='succeeded')return'Возврат подтверждён, ожидает применения';
 if(row.providerRefundId)return'Возврат обрабатывается';
 if(row.attempted)return'Результат возврата не определён';
 if(row.approvalId)return'Решение принято, ожидает обработки';
 return({created:'Ожидает оплаты',pending:'Платёж обрабатывается',succeeded:'Оплачено',failed:'Оплата не завершена',refunded:'Возврат выполнен'} as Record<string,string>)[row.status];
}
function RefundWorkspace({actor}:{actor:string}){
 const serviceCheckout=useServiceCheckout();
 const [page,setPage]=useState<AdminRefundPage|null>(null),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('');
 const scroll=useRef<HTMLDivElement>(null);
 const actions=useAdminRefundActions(actor,true,state=>{if(state==='rejected')setPage(null);},loading);
 const {life,working}=actions;
 const load=useCallback(async(after:string|null=null)=>{
  const scope=life.current;if(!scope?.active||working.current)return;
  working.current=true;setLoading(true);setLoadError('');if(after===null)setPage(null);
  try{const result=await adminRefunds.call({action:'list',expectedAdminId:actor,input:after},scope.controller.signal) as AdminRefundPage;
   if(scope.active){setPage(result);scroll.current?.scrollTo({top:0});}
  }catch{if(scope.active)setLoadError('Журнал не загружен. Проверьте соединение и обновите данные.');}
  finally{if(life.current===scope){working.current=false;if(scope.active)setLoading(false);}}
 },[actor,life,working]);
 useEffect(()=>{void load();},[load]);
 const busy=loading||actions.busy;
 return <section aria-label="Локальный журнал возвратов" aria-busy={busy}>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">Платежи и возвраты</h2><p className="mt-1 text-sm text-slate-600">Локальный TEST-контур · реальные деньги не списываются.</p></div><button type="button" className={button} disabled={busy} onClick={()=>{actions.clearFeedback();void load();}}>Обновить журнал</button></div>
  {loadError&&<p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError}</p>}
  {actions.panel}
  {busy&&!page&&<p role="status" className="mt-4 text-sm text-slate-600">Загружаем журнал…</p>}
  {page&&<><div ref={scroll} tabIndex={0} aria-label="Прокрутка платежей" className="mt-4 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><ul className="grid gap-2">
   {page.items.map(row=><li key={row.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold text-slate-950">{types[row.targetType]??'Платёж'} · {row.id.slice(0,8)}</h3><p className="mt-1 text-sm text-slate-600"><time dateTime={row.createdAt}>{date(row.createdAt)}</time></p></div><div className="text-right"><p className="font-bold text-slate-950">{money.format(Number(row.amount))}</p><p className={'mt-1 text-sm font-semibold '+(row.appliedAt?'text-emerald-800':'text-slate-700')}>{status(row)}</p></div></div>
    {row.reason&&<p className="mt-2 text-sm text-slate-700">Причина возврата: {row.reason}</p>}
    <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer py-2">Идентификаторы платежа и размещения</summary><p className="break-all">Платёж: {row.id}</p><p className="mt-1 break-all">Размещение: {row.targetId}</p></details>
    {row.canRefund===false&&['listing','vacancy','workRequest'].includes(row.targetType)&&row.status==='succeeded'&&!row.approvalId&&<p className="mt-2 text-sm text-slate-600">Для возврата начните с последней покупки и завершите начатую оплату.</p>}
    <div className="mt-2 flex flex-wrap gap-2">{(['listing','vacancy','workRequest'].includes(row.targetType)||serviceCheckout&&['fair_application','ad_marquee'].includes(row.targetType))&&row.status==='succeeded'&&row.capturedAt&&!row.approvalId&&row.canRefund!==false&&<button type="button" className={button} disabled={busy||actions.disabled} onClick={()=>actions.select({row,kind:'approve'})}>Вернуть плату</button>}
    {row.operationId&&row.attempted&&!row.appliedAt&&row.refundStatus!=='canceled'&&<button type="button" className={button} disabled={busy||actions.disabled} onClick={()=>actions.select({row,kind:'recover'})}>{row.providerRefundId?'Сверить возврат':'Сверить по номеру ЮKassa'}</button>}</div>
   </li>)}
  </ul>{page.items.length===0&&<p className="p-6 text-center text-sm text-slate-600">В этом TEST-магазине платежей пока нет.</p>}</div>{page.nextAfter&&<button type="button" className={button+' mt-3'} disabled={busy} onClick={()=>{actions.clearFeedback();void load(page.nextAfter);}}>Следующие платежи</button>}</>}
 </section>;
}
export function PrimaryAdminRefunds(){
 const auth=usePrimaryAccountAuth();
 if(auth?.state!=='admin'||!auth.userId)return <p role="status" className="text-sm text-slate-600">{auth?.state==='loading'?'Проверяем права администратора…':'Доступ администратора не подтверждён.'}</p>;
 return <RefundWorkspace key={auth.userId} actor={auth.userId}/>;
}
