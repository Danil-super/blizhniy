"use client";
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingCheckout,type ListingCheckoutInput} from './listing-checkout-contract.ts';
import {parseListingPaymentSnapshot,ListingPaymentClientError} from './client-listing-payment.ts';
import type {ListingPaymentOrder} from './postgres-listing-checkout';
type Options={signal?:AbortSignal};
type Quote={listingId:string;revision:string;tariff:{id:string;name:string;amount:string;currency:'RUB';durationDays:number};activePayment:ListingPaymentOrder|null};
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;
}
function order(value:unknown):ListingPaymentOrder{
 const row=exact(value,['id','creationKey','targetId','targetRevision','tariffId','amount','durationDays','status','createdAt']);
 return parseListingPaymentSnapshot({order:row,fulfillment:null},parseListingDraftId(row.id))!.order;
}
export function createAccountTestPaymentClient(transport:typeof fetch){
 async function call(owner:string,body:Record<string,unknown>,method='POST',options:Options={}):Promise<unknown>{
  try{
   const expectedOwnerId=parseListingDraftId(owner),timeout=AbortSignal.timeout(50000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
   const response=await transport('/api/account/listing-checkout',{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId,...body})});
   if(!response.body)throw Error();const reader=response.body.getReader();let size=0,chunks=0,complete=false;const bytes:Uint8Array[]=[];
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}size+=part.value.byteLength;if(size>16384||++chunks>1024)throw Error();bytes.push(part.value);}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const all=new Uint8Array(size);let offset=0;for(const part of bytes){all.set(part,offset);offset+=part.byteLength;}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
   if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,RATE_LIMITED:429,CHECKOUT_DISABLED:503,CHECKOUT_NOT_READY:409,CHECKOUT_CHANGED:409,DRAFT_CHANGED:409,DRAFT_NOT_FOUND:404},code=value?.error?.code;
    throw new ListingPaymentClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
   return value;
  }catch(error){if(error instanceof ListingPaymentClientError)throw error;throw new ListingPaymentClientError('UNKNOWN');}
 }
 return{
  async preview(owner:string,listingId:string,revision:string,options:Options={}):Promise<Quote>{
   const id=parseListingDraftId(listingId),expectedRevision=parseListingDraftRevision(revision);
   const value=exact(await call(owner,{action:'testPreview',listingId:id,expectedRevision},'POST',options),['listingId','revision','tariff','activePayment']);
   const tariff=exact(value.tariff,['id','name','amount','currency','durationDays']);
   const validated=parseListingCheckout({listingId:value.listingId,expectedRevision:value.revision,creationKey:id,expectedTariffId:tariff.id,expectedAmount:tariff.amount,expectedDurationDays:tariff.durationDays});
   if(validated.listingId!==id||validated.expectedRevision!==expectedRevision||tariff.currency!=='RUB'||typeof tariff.name!=='string'||tariff.name.length>200)throw new ListingPaymentClientError('UNKNOWN');
   const activePayment=value.activePayment===null?null:order(value.activePayment);if(activePayment&&activePayment.targetId!==id)throw new ListingPaymentClientError('UNKNOWN');
   return{listingId:id,revision:expectedRevision,tariff:{id:validated.expectedTariffId,name:tariff.name,amount:validated.expectedAmount,currency:'RUB',durationDays:validated.expectedDurationDays},activePayment};
  },
  async prepare(owner:string,value:ListingCheckoutInput,options:Options={}){
   const input=parseListingCheckout(value),saved=order(await call(owner,{...input},'PUT',options));
   if(saved.creationKey!==input.creationKey||saved.targetId!==input.listingId||saved.targetRevision!==input.expectedRevision||saved.tariffId!==input.expectedTariffId||saved.amount!==input.expectedAmount||saved.durationDays!==input.expectedDurationDays)throw new ListingPaymentClientError('UNKNOWN');return saved;
  },
  async recover(owner:string,key:string,options:Options={}){
   const creationKey=parseListingDraftId(key),value=await call(owner,{action:'intent',creationKey},'POST',options);if(value===null)return null;
   const saved=order(value);if(saved.creationKey!==creationKey)throw new ListingPaymentClientError('UNKNOWN');return saved;
  },
  async dispatch(owner:string,id:string,options:Options={}){
   const value=exact(await call(owner,{action:'dispatch',paymentId:parseListingDraftId(id)},'POST',options),['confirmationUrl','isTest']);
   if(value.isTest!==true)throw new ListingPaymentClientError('UNKNOWN');
   if(value.confirmationUrl!==null){
    if(typeof value.confirmationUrl!=='string'||value.confirmationUrl.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(value.confirmationUrl))throw new ListingPaymentClientError('UNKNOWN');
    const url=new URL(value.confirmationUrl);if(url.protocol!=='https:'||!['yoomoney.ru','yookassa.ru'].includes(url.hostname)||url.username||url.password||url.port)throw new ListingPaymentClientError('UNKNOWN');
   }
   return{confirmationUrl:value.confirmationUrl as string|null,isTest:true as const};
  },
 };
}
export const accountTestPayment=createAccountTestPaymentClient((...args)=>fetch(...args));
