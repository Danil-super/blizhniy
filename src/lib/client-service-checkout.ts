'use client';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract';
import {parseServiceCheckout,type PaidServiceKind,type ServiceCheckoutInput} from './service-checkout-contract';
import type {ServicePaymentOrder,ServicePaymentSnapshot} from './postgres-service-checkout';
import {notifyAccountSessionChange} from './local-account';
type Options={signal?:AbortSignal};
export type ServiceQuote={publicationId:string;revision:string;tariff:{id:string;name:string;amount:string;durationDays:number|null};fairEvent:{date:string;endsAt:string}|null;activePayment:ServicePaymentOrder|null};
const fail=():never=>{throw Error('Не удалось проверить данные оплаты.');};
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))return fail();return value as Record<string,unknown>;}
function stamp(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))return fail();return value;}
function event(value:unknown){if(value===null)return null;const row=object(value,['date','endsAt']);if(typeof row.date!=='string')return fail();return{date:row.date,endsAt:stamp(row.endsAt)};}
export function parseServicePaymentOrder(kind:PaidServiceKind,value:unknown):ServicePaymentOrder{
 const row=object(value,['id','creationKey','targetId','targetRevision','tariffId','amount','durationDays','status','createdAt','fairEvent']),fairEvent=event(row.fairEvent);
 const parsed=parseServiceCheckout(kind,{publicationId:row.targetId,expectedRevision:row.targetRevision,creationKey:row.creationKey,expectedTariffId:row.tariffId,expectedAmount:row.amount,expectedDurationDays:row.durationDays,expectedFairDate:fairEvent?.date??null});
 if(typeof row.status!=='string'||!['created','pending','succeeded','failed','refunded'].includes(row.status))return fail();
 return{id:parseListingDraftId(row.id),creationKey:parsed.creationKey,targetId:parsed.publicationId,targetRevision:parsed.expectedRevision,tariffId:parsed.expectedTariffId,amount:parsed.expectedAmount,durationDays:parsed.expectedDurationDays,status:row.status as ServicePaymentOrder['status'],createdAt:stamp(row.createdAt),fairEvent};
}
export function parseServicePaymentSnapshot(kind:PaidServiceKind,value:unknown,id:string):ServicePaymentSnapshot{
 const row=object(value,['order','eventEnded','fulfillment']),order=parseServicePaymentOrder(kind,row.order);if(order.id!==id||typeof row.eventEnded!=='boolean'||kind==='marquee'&&row.eventEnded)return fail();
 let fulfillment:ServicePaymentSnapshot['fulfillment']=null;
 if(row.fulfillment!==null){const f=object(row.fulfillment,['publishedAt','expiresAt']);fulfillment={publishedAt:stamp(f.publishedAt),expiresAt:stamp(f.expiresAt)};if(fulfillment.publishedAt>=fulfillment.expiresAt||!['succeeded','refunded'].includes(order.status)||order.fairEvent&&fulfillment.expiresAt!==order.fairEvent.endsAt)return fail();}
 return{order,eventEnded:row.eventEnded,fulfillment};
}
async function request(kind:PaidServiceKind,value:unknown,options:Options,method='POST'){
 const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
 const response=await fetch('/api/account/'+kind+'-checkout',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(value)});
 if(!response.ok){if(response.status===401)notifyAccountSessionChange(false);throw Error(response.status===409?'Данные или условия размещения изменились. Проверьте сохранённую оплату.':'Не удалось выполнить запрос. Проверьте начатую оплату перед повтором.');}
 if(!response.body)return fail();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,chunks=0,complete=false;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}size+=part.value.byteLength;if(size>16384||++chunks>1024)return fail();text+=decoder.decode(part.value,{stream:true});}}
 finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
 return JSON.parse(text) as unknown;
}
export const serviceCheckout={
 async preview(kind:PaidServiceKind,owner:string,id:string,revision:string,options:Options={}):Promise<ServiceQuote>{
  const row=object(await request(kind,{action:'preview',expectedOwnerId:owner,publicationId:id,expectedRevision:revision},options),['publicationId','revision','tariff','fairEvent','activePayment']),tariff=object(row.tariff,['id','name','amount','durationDays']),fairEvent=event(row.fairEvent);
  if(typeof tariff.name!=='string'||tariff.name.length>200||row.publicationId!==id||row.revision!==revision)return fail();
  const parsed=parseServiceCheckout(kind,{publicationId:row.publicationId,expectedRevision:row.revision,creationKey:id,expectedTariffId:tariff.id,expectedAmount:tariff.amount,expectedDurationDays:tariff.durationDays,expectedFairDate:fairEvent?.date??null});
  const activePayment=row.activePayment===null?null:parseServicePaymentOrder(kind,row.activePayment);if(activePayment&&(activePayment.targetId!==id||activePayment.targetRevision!==revision))return fail();
  return{publicationId:parseListingDraftId(row.publicationId),revision:parseListingDraftRevision(row.revision),tariff:{id:parsed.expectedTariffId,name:tariff.name,amount:parsed.expectedAmount,durationDays:parsed.expectedDurationDays},fairEvent,activePayment};
 },
 async prepare(kind:PaidServiceKind,owner:string,input:ServiceCheckoutInput,options:Options={}){const order=parseServicePaymentOrder(kind,await request(kind,{expectedOwnerId:owner,...parseServiceCheckout(kind,input)},options,'PUT'));if(order.creationKey!==input.creationKey||order.targetId!==input.publicationId||order.targetRevision!==input.expectedRevision||order.tariffId!==input.expectedTariffId||order.amount!==input.expectedAmount||order.durationDays!==input.expectedDurationDays||(order.fairEvent?.date??null)!==input.expectedFairDate)return fail();return order;},
 async recover(kind:PaidServiceKind,owner:string,key:string,options:Options={}){const row=await request(kind,{action:'intent',expectedOwnerId:owner,creationKey:key},options);return row===null?null:parseServicePaymentOrder(kind,row);},
 async order(kind:PaidServiceKind,owner:string,id:string,options:Options={}){return parseServicePaymentSnapshot(kind,await request(kind,{action:'order',expectedOwnerId:owner,paymentId:id},options),id);},
 async dispatch(kind:PaidServiceKind,owner:string,id:string,options:Options={}){const row=object(await request(kind,{action:'dispatch',expectedOwnerId:owner,paymentId:id},options),['confirmationUrl','isTest']);if(row.isTest!==true||row.confirmationUrl!==null&&(typeof row.confirmationUrl!=='string'||!row.confirmationUrl.startsWith('https://yookassa.ru/')))return fail();},
};
