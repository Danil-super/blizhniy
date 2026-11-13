"use client";
import {parsePaymentHistoryInput,parsePaymentHistoryPage,type PaymentHistoryCursor} from './payment-history-contract.ts';
export class PaymentHistoryClientError extends Error{
 constructor(readonly code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Не удалось загрузить историю платежей. Повторите загрузку.');}
}
export function createPaymentHistoryClient(transport:typeof fetch){return{
 async list(owner:string,cursor:PaymentHistoryCursor|null,options:{signal?:AbortSignal}={}){
  try{
   options.signal?.throwIfAborted();const input=parsePaymentHistoryInput({expectedOwnerId:owner,cursor});
   const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/payments',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(input)});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,chunks=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}
    size+=part.value.byteLength;if(size>32768||++chunks>1024)throw Error();text+=decoder.decode(part.value,{stream:true});}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const page=JSON.parse(text);
   if(response.status!==200){const code=page?.error?.code;throw new PaymentHistoryClientError(response.status===401&&code==='UNAUTHENTICATED'||response.status===429&&code==='RATE_LIMITED'?code:'UNKNOWN');}
   return parsePaymentHistoryPage(page,input.cursor);
  }catch(error){if(error instanceof PaymentHistoryClientError)throw error;throw new PaymentHistoryClientError('UNKNOWN');}
 },
};}
export const paymentHistory=createPaymentHistoryClient((...args)=>fetch(...args));
