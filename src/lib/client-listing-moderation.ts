"use client";
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {ListingModerationState} from './postgres-listing-moderation';
export class ListingModerationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='DRAFT_CHANGED'?'Черновик изменился. Закройте редактор и откройте объявление повторно.':code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='INVALID_INPUT'?'Заполните обязательные поля объявления перед отправкой.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Ответ не получен. Проверьте статус отправки перед повторным действием.');this.code=code;}
}
export function parseListingModerationState(value:unknown,expectedRevision:string):ListingModerationState{
 try{
  parseListingDraftRevision(expectedRevision);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='id,note,revision,state')throw Error();
  const row=value as Record<string,unknown>;
  if(row.state==='not_submitted'){
   if(row.id!==null||row.revision!==null||row.note!==null)throw Error();return{id:null,revision:null,state:'not_submitted',note:null};
  }
  const id=parseListingDraftId(row.id),revision=parseListingDraftRevision(row.revision);
  if(!['pending','approved','rejected','outdated'].includes(String(row.state))||(row.state==='outdated'?BigInt(revision)>=BigInt(expectedRevision):revision!==expectedRevision))throw Error();
  if(row.note!==null&&(typeof row.note!=='string'||!row.note.isWellFormed()||!row.note.trim()||row.note!==row.note.trim()||row.note.length>1000||/[\x00-\x1f\x7f]/.test(row.note)))throw Error();
  if((row.state==='rejected'&&row.note===null)||(['pending','approved'].includes(String(row.state))&&row.note!==null))throw Error();
  return{id,revision,state:row.state as ListingModerationState['state'],note:row.note as string|null};
 }catch{throw new ListingModerationClientError('UNKNOWN');}
}
async function request(method:'POST'|'PUT',owner:string,id:string,revision:string,options:{signal?:AbortSignal}={}):Promise<ListingModerationState>{
 try{
  parseListingDraftId(owner);parseListingDraftId(id);parseListingDraftRevision(revision);options.signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
  const response=await fetch('/api/account/listing-moderation',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,
   headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId:owner,listingId:id,expectedRevision:revision})});
  if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}bytes+=part.value.byteLength;if(bytes>4096)throw Error();text+=decoder.decode(part.value,{stream:true});}
  }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const value=JSON.parse(text);
  if(!response.ok){const codes:Record<string,number>={UNAUTHENTICATED:401,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
   throw new ListingModerationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
  return parseListingModerationState(value,revision);
 }catch(error){if(error instanceof ListingModerationClientError)throw error;throw new ListingModerationClientError('UNKNOWN');}
}
export const listingModeration={
 read:(owner:string,id:string,revision:string,options?:{signal?:AbortSignal})=>request('POST',owner,id,revision,options),
 submit:(owner:string,id:string,revision:string,options?:{signal?:AbortSignal})=>request('PUT',owner,id,revision,options),
};
