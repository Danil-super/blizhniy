"use client";
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseApplicationCheckout,type ApplicationCheckoutInput,type ApplicationPaymentOrder,type ApplicationPaymentSnapshot,type ApplicationQuote} from './application-checkout-contract.ts';
type Options={signal?:AbortSignal};
export class ApplicationPaymentClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите проверку позже.':
  code==='CHECKOUT_CHANGED'||code==='APPLICATION_CHANGED'?'Отклик или тариф изменились. Проверьте сохранённые данные.':code==='CHECKOUT_DISABLED'||code==='CHECKOUT_NOT_READY'?'Оплата этого отклика сейчас недоступна.':'Результат не подтверждён. Проверьте этот заказ перед повторным действием.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;}
const stamp=(id:string,value:unknown)=>parseListingDraftCursor({id,updatedAt:value})!.updatedAt;
function order(value:unknown):ApplicationPaymentOrder{
 const row=exact(value,['id','creationKey','targetId','targetRevision','tariffId','amount','durationDays','status','createdAt']),id=parseListingDraftId(row.id);
 if(row.durationDays!==null||!['created','pending','succeeded','failed','refunded'].includes(row.status as string))throw Error();
 const input=parseApplicationCheckout({applicationId:row.targetId,expectedRevision:row.targetRevision,creationKey:row.creationKey,expectedTariffId:row.tariffId,expectedAmount:row.amount});
 return{id,creationKey:input.creationKey,targetId:input.applicationId,targetRevision:input.expectedRevision,tariffId:input.expectedTariffId,amount:input.expectedAmount,durationDays:null,status:row.status as ApplicationPaymentOrder['status'],createdAt:stamp(id,row.createdAt)};
}
export function applicationPaymentMatchesInput(saved:ApplicationPaymentOrder,input:ApplicationCheckoutInput){return saved.creationKey===input.creationKey&&saved.targetId===input.applicationId&&saved.targetRevision===input.expectedRevision&&saved.tariffId===input.expectedTariffId&&saved.amount===input.expectedAmount&&saved.durationDays===null;}
export function createApplicationPaymentClient(transport:typeof fetch){
 async function call(owner:string,body:Record<string,unknown>,method='POST',options:Options={}):Promise<unknown>{
  const expectedOwnerId=parseListingDraftId(owner),timeout=AbortSignal.timeout(50000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
  const response=await transport('/api/account/application-checkout',{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId,...body})});
  if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}size+=part.value.byteLength;if(size>16384||chunks.length>=1024)throw Error();chunks.push(part.value);}}
  finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,INVALID_INPUT:422,RATE_LIMITED:429,CHECKOUT_DISABLED:503,CHECKOUT_NOT_READY:409,CHECKOUT_CHANGED:409,APPLICATION_CHANGED:409,APPLICATION_BUSY:409,APPLICATION_NOT_FOUND:404},code=value?.error?.code;
   throw new ApplicationPaymentClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
 }
 const checked=async<T>(work:()=>Promise<T>):Promise<T>=>{try{return await work();}catch(error){if(error instanceof ApplicationPaymentClientError)throw error;throw new ApplicationPaymentClientError('UNKNOWN');}};
 return{
  preview:(owner:string,value:string,version:string,options:Options={}):Promise<ApplicationQuote>=>checked(async()=>{
   const id=parseListingDraftId(value),revision=parseListingDraftRevision(version),row=exact(await call(owner,{action:'preview',applicationId:id,expectedRevision:revision},'POST',options),['applicationId','revision','tariff','activePayment']);
   const tariff=exact(row.tariff,['id','name','amount','currency','durationDays']);
   const input=parseApplicationCheckout({applicationId:row.applicationId,expectedRevision:row.revision,creationKey:id,expectedTariffId:tariff.id,expectedAmount:tariff.amount});
   if(input.applicationId!==id||input.expectedRevision!==revision||tariff.currency!=='RUB'||tariff.durationDays!==null||typeof tariff.name!=='string'||!tariff.name.length||tariff.name.length>200||!tariff.name.isWellFormed()||/[\u0000-\u001f\u007f]/.test(tariff.name))throw Error();
   const activePayment=row.activePayment===null?null:order(row.activePayment);if(activePayment&&activePayment.targetId!==id)throw Error();
   return{applicationId:id,revision,tariff:{id:input.expectedTariffId,name:tariff.name,amount:input.expectedAmount,currency:'RUB',durationDays:null},activePayment};
  }),
  prepare:(owner:string,value:ApplicationCheckoutInput,options:Options={}):Promise<ApplicationPaymentOrder>=>checked(async()=>{const input=parseApplicationCheckout(value),saved=order(await call(owner,{...input},'PUT',options));if(!applicationPaymentMatchesInput(saved,input))throw Error();return saved;}),
  recover:(owner:string,value:string,options:Options={}):Promise<ApplicationPaymentOrder|null>=>checked(async()=>{const creationKey=parseListingDraftId(value),result=await call(owner,{action:'intent',creationKey},'POST',options);if(result===null)return null;const saved=order(result);if(saved.creationKey!==creationKey)throw Error();return saved;}),
  read:(owner:string,value:string,options:Options={}):Promise<ApplicationPaymentSnapshot|null>=>checked(async()=>{
   const id=parseListingDraftId(value),result=await call(owner,{action:'order',paymentId:id},'POST',options);if(result===null)return null;
   const hasClosure=typeof result==='object'&&Object.hasOwn(result,'targetClosed');
   const row=exact(result,['order','deliveredAt',...(hasClosure?['targetClosed']:[])]),saved=order(row.order);if(saved.id!==id||hasClosure&&typeof row.targetClosed!=='boolean')throw Error();
   const deliveredAt=row.deliveredAt===null?null:stamp(id,row.deliveredAt);if(deliveredAt&&(!['succeeded','refunded'].includes(saved.status)||deliveredAt<saved.createdAt))throw Error();return{order:saved,deliveredAt,...(hasClosure?{targetClosed:row.targetClosed as boolean}:{})};
  }),
  dispatch:(owner:string,value:string,options:Options={}):Promise<{confirmationUrl:string|null;isTest:true}>=>checked(async()=>{
   const row=exact(await call(owner,{action:'dispatch',paymentId:parseListingDraftId(value)},'POST',options),['confirmationUrl','isTest']);if(row.isTest!==true)throw Error();
   if(row.confirmationUrl!==null){if(typeof row.confirmationUrl!=='string'||row.confirmationUrl.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(row.confirmationUrl))throw Error();const url=new URL(row.confirmationUrl);if(url.protocol!=='https:'||!['yoomoney.ru','yookassa.ru'].includes(url.hostname)||url.username||url.password||url.port)throw Error();}
   return{confirmationUrl:row.confirmationUrl as string|null,isTest:true};
  }),
 };
}
export const applicationPayment=createApplicationPaymentClient((...args)=>fetch(...args));
