'use client';
import {normalizeTelegramPhone,phoneReturnPath} from './phone-verification-contract.ts';
export type PhoneStatus={available:boolean;required:boolean;verified:boolean;phone:string|null;verifiedPhone:string|null};
export type PhoneReview={id:string;phone:string;currentPhone:string;replaceRequired:boolean;profileRevision:string|null;confirmed:boolean;returnTo:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const messages:Record<string,string>={INVALID_ATTEMPT:'Попытка подтверждения недействительна или истекла. Начните ещё раз.',UNAUTHENTICATED:'Войдите в аккаунт повторно.',
 UNAVAILABLE:'Подтверждение через Telegram пока недоступно. Попробуйте позже.',PHONE_CONFLICT:'Не удалось привязать номер. Восстановите доступ к своему аккаунту или обратитесь в поддержку.',
 PROFILE_CHANGED:'Профиль изменился. Обновите данные и проверьте замену номера ещё раз.',REPLACEMENT_REQUIRED:'Подтвердите замену указанного номера.',RATE_LIMITED:'Слишком много попыток. Попробуйте через 15 минут.',
 CANCELLED:'Подтверждение номера отменено. Данные формы сохранены.',INVALID_INPUT:'Проверьте данные подтверждения.',PHONE_REQUIRED:'Подтвердите номер телефона, чтобы разместить публикацию.'};
export class PhoneClientError extends Error{code:string;constructor(code:string){super(messages[code]??messages.UNAVAILABLE);this.name='PhoneClientError';this.code=code;}}
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new PhoneClientError('UNAVAILABLE');return value as Record<string,unknown>;};
async function call(action:string,owner:string,body:Record<string,unknown>={}){
 if(!uuid.test(owner))throw new PhoneClientError('UNAUTHENTICATED');
 try{
  const signal=AbortSignal.timeout(12000);const response=await fetch('/api/account/phone/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
   headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId:owner,...body})});
  if(!response.body)throw new PhoneClientError('UNAVAILABLE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}size+=part.value.byteLength;if(size>32768)throw new PhoneClientError('UNAVAILABLE');text+=decoder.decode(part.value);}}
  finally{if(!complete)void reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const result=object(JSON.parse(text));
  if(!response.ok){const code=object(result.error).code;throw new PhoneClientError(typeof code==='string'&&Object.hasOwn(messages,code)?code:'UNAVAILABLE');}
  if(response.status!==200)throw new PhoneClientError('UNAVAILABLE');return result;
 }catch(error){if(error instanceof PhoneClientError)throw error;throw new PhoneClientError('UNAVAILABLE');}
}
export const phoneVerification={
 async status(owner:string):Promise<PhoneStatus>{const row=await call('status',owner);
  if(Object.keys(row).sort().join()!=='available,phone,required,verified,verifiedPhone'||['available','required','verified'].some(key=>typeof row[key]!=='boolean')||
   !(row.phone===null||typeof row.phone==='string'&&row.phone.length<=40)||!(row.verifiedPhone===null||normalizeTelegramPhone(row.verifiedPhone))||
   row.verified&&(row.available!==true||!row.verifiedPhone))throw new PhoneClientError('UNAVAILABLE');return row as PhoneStatus;},
 async start(owner:string,returnTo:string):Promise<{authorizationUrl:string;attemptId:string}>{const row=await call('start',owner,{returnTo:phoneReturnPath(returnTo)});
  if(Object.keys(row).sort().join()!=='attemptId,authorizationUrl'||typeof row.authorizationUrl!=='string'||typeof row.attemptId!=='string'||!uuid.test(row.attemptId))throw new PhoneClientError('UNAVAILABLE');
  const url=new URL(row.authorizationUrl);if(url.origin!=='https://oauth.telegram.org'||url.pathname!=='/auth'||url.username||url.password||url.hash)throw new PhoneClientError('UNAVAILABLE');return row as {authorizationUrl:string;attemptId:string};},
 async review(owner:string,attemptId:string):Promise<PhoneReview>{if(!uuid.test(attemptId))throw new PhoneClientError('INVALID_ATTEMPT');const row=await call('review',owner,{attemptId});
  if(Object.keys(row).sort().join()!=='confirmed,currentPhone,id,phone,profileRevision,replaceRequired,returnTo'||row.id!==attemptId||!normalizeTelegramPhone(row.phone)||
   typeof row.currentPhone!=='string'||row.currentPhone.length>40||typeof row.replaceRequired!=='boolean'||typeof row.confirmed!=='boolean'||
   !(row.profileRevision===null||typeof row.profileRevision==='string'&&/^[a-f0-9]{64}$/.test(row.profileRevision)))throw new PhoneClientError('UNAVAILABLE');
  phoneReturnPath(row.returnTo);return row as PhoneReview;},
 async confirm(owner:string,review:PhoneReview,acceptReplacement:boolean){const row=await call('confirm',owner,{attemptId:review.id,expectedRevision:review.profileRevision,acceptReplacement});
  if(row.confirmed!==true||row.phone!==review.phone||phoneReturnPath(row.returnTo)!==review.returnTo)throw new PhoneClientError('UNAVAILABLE');return row;},
 async unlink(owner:string){const row=await call('unlink',owner);if(row.confirmed!==false)throw new PhoneClientError('UNAVAILABLE');},
};
