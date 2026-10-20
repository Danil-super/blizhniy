"use client";
import {parseListingDraftId,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseListingCheckout} from './listing-checkout-contract.ts';
import type {ListingPaymentOrder,ListingPaymentSnapshot} from './postgres-listing-checkout';

export class ListingPaymentClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите проверку позже.':
  code==='CHECKOUT_DISABLED'?'Оплата пока недоступна. Новый платёж не создавался.':'Не удалось получить актуальный статус. Проверьте соединение и повторите проверку — новый платёж создан не будет.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;
}
const stamp=(id:string,value:unknown)=>parseListingDraftCursor({id,updatedAt:value})!.updatedAt;
function snapshot(value:unknown,id:string):ListingPaymentSnapshot|null{
 if(value===null)return null;
 const row=exact(value,['order','fulfillment']),o=exact(row.order,['id','creationKey','targetId','targetRevision','tariffId','amount','durationDays','status','createdAt']);
 if(o.id!==id||!['created','pending','succeeded','failed','refunded'].includes(o.status as string))throw Error();
 const input=parseListingCheckout({listingId:o.targetId,expectedRevision:o.targetRevision,creationKey:o.creationKey,expectedTariffId:o.tariffId,expectedAmount:o.amount,expectedDurationDays:o.durationDays});
 const order:ListingPaymentOrder={id,creationKey:input.creationKey,targetId:input.listingId,targetRevision:input.expectedRevision,tariffId:input.expectedTariffId,amount:input.expectedAmount,durationDays:input.expectedDurationDays,status:o.status as ListingPaymentOrder['status'],createdAt:stamp(id,o.createdAt)};
 let fulfillment:ListingPaymentSnapshot['fulfillment']=null;
 if(row.fulfillment!==null){
  if(order.status!=='succeeded'&&order.status!=='refunded')throw Error();
  const f=exact(row.fulfillment,['publishedAt','expiresAt']),publishedAt=stamp(id,f.publishedAt),expiresAt=stamp(id,f.expiresAt);
  if(publishedAt<order.createdAt||expiresAt<=publishedAt)throw Error();fulfillment={publishedAt,expiresAt};
 }
 return{order,fulfillment};
}
export function createListingPaymentClient(transport:typeof fetch){return{
 async read(owner:string,paymentId:string,options:{signal?:AbortSignal}={}):Promise<ListingPaymentSnapshot|null>{
  try{
   const expectedOwnerId=parseListingDraftId(owner),id=parseListingDraftId(paymentId);
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/listing-checkout',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId,action:'order',paymentId:id})});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,chunks=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}size+=part.value.byteLength;if(size>16384||++chunks>1024)throw Error();text+=decoder.decode(part.value,{stream:true});}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const value=JSON.parse(text);
   if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,CHECKOUT_DISABLED:503,RATE_LIMITED:429},code=value?.error?.code;
    throw new ListingPaymentClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
   return snapshot(value,id);
  }catch(error){if(error instanceof ListingPaymentClientError)throw error;throw new ListingPaymentClientError('UNKNOWN');}
 },
};}
export const listingPayment=createListingPaymentClient((...args)=>fetch(...args));
