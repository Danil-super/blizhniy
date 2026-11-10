'use client';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseCheckoutCancellation,type CheckoutCancellationInput,type CheckoutCancellationResult} from './checkout-cancellation-contract.ts';
const messages={UNAUTHENTICATED:'Войдите в аккаунт повторно.',CHECKOUT_NOT_FOUND:'Подготовка оплаты недоступна.',CHECKOUT_STARTED:'Отправка оплаты уже могла начаться. Проверьте статус исходного заказа.',CHECKOUT_BUSY:'Состояние оплаты сейчас обновляется. Повторите проверку.',INVALID_INPUT:'Проверьте данные оплаты.',RATE_LIMITED:'Слишком много запросов. Попробуйте позже.',UNKNOWN:'Результат отмены пока неизвестен. Проверьте эту же подготовку.'};
export class CheckoutCancellationClientError extends Error{constructor(readonly code:keyof typeof messages){super(messages[code]);this.name='CheckoutCancellationClientError';}}
export function createCheckoutCancellationClient(transport:typeof fetch){
 async function request(owner:string,input:CheckoutCancellationInput,write:boolean,options?:{signal?:AbortSignal}):Promise<CheckoutCancellationResult|null>{
  let value:CheckoutCancellationInput,expectedOwnerId:string;try{value=parseCheckoutCancellation(input);expectedOwnerId=parseListingDraftId(owner);}catch{throw new CheckoutCancellationClientError('INVALID_INPUT');}
  try{
   const timeout=AbortSignal.timeout(10000),signal=options?.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
   const response=await transport('/api/account/checkout-cancellation',{method:write?'PUT':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({...value,expectedOwnerId})});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});let text='',size=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}size+=part.value.byteLength;if(size>8192)throw Error();text+=decoder.decode(part.value,{stream:true});}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const row=JSON.parse(text);if(response.status!==200){const statuses:Record<string,number>={UNAUTHENTICATED:401,CHECKOUT_NOT_FOUND:404,CHECKOUT_STARTED:409,CHECKOUT_BUSY:409,INVALID_INPUT:422,RATE_LIMITED:429},code=row?.error?.code;
    if(typeof code==='string'&&Object.hasOwn(statuses,code)&&statuses[code]===response.status)throw new CheckoutCancellationClientError(code as keyof typeof messages);throw Error();}
   if(row===null&&!write)return null;
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==3||row.paymentId!==value.paymentId||row.targetType!==value.targetType||row.state!=='cancelled')throw Error();
   return{...value,state:'cancelled'};
  }catch(error){if(error instanceof CheckoutCancellationClientError)throw error;throw new CheckoutCancellationClientError('UNKNOWN');}
 }
 return{read:(owner:string,input:CheckoutCancellationInput,options?:{signal?:AbortSignal})=>request(owner,input,false,options),cancel:(owner:string,input:CheckoutCancellationInput,options?:{signal?:AbortSignal})=>request(owner,input,true,options)};
}
export const checkoutCancellation=createCheckoutCancellationClient((...args)=>fetch(...args));
