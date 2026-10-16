"use client";
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseListingFormSnapshot} from './client-listing-form.ts';
import {parseListingPublicationCheck} from './client-listing-publication.ts';
import {parseListingModerationState} from './client-listing-moderation.ts';
export type ModerationQueueItem={id:string;listingId:string;revision:string;title:string};
export type ModerationQueue={items:ModerationQueueItem[];nextCursor:string|null};
export type ModerationDetail={request:ReturnType<typeof parseListingModerationState>;snapshot:ReturnType<typeof parseListingFormSnapshot>;check:ReturnType<typeof parseListingPublicationCheck>};
type Options={signal?:AbortSignal};
export class AdminModerationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='ADMIN_REQUIRED'||code==='UNAUTHENTICATED'?'Доступ администратора не подтверждён. Войдите заново.':code==='DRAFT_CHANGED'?'Владелец изменил объявление. Обновите очередь и проверьте новую версию.':
  code==='INVALID_INPUT'?'Проверьте решение и причину отказа.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Результат не подтверждён. Перечитайте запрос перед повторным решением.');this.code=code;}
}
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join())throw new AdminModerationClientError('UNKNOWN');return value as Record<string,unknown>;
}
export function parseModerationQueue(value:unknown):ModerationQueue{
 try{
  const row=object(value,['items','nextCursor']);if(!Array.isArray(row.items)||row.items.length>20)throw Error();
  const items=row.items.map(value=>{const item=object(value,['id','listingId','revision','title']);if(typeof item.title!=='string'||!item.title.isWellFormed()||item.title.length>160)throw Error();
   return{id:parseListingDraftId(item.id),listingId:parseListingDraftId(item.listingId),revision:parseListingDraftRevision(item.revision),title:item.title};});
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();
  const nextCursor=row.nextCursor===null?null:parseListingDraftId(row.nextCursor);if(nextCursor&&(items.length!==20||items.at(-1)?.id!==nextCursor))throw Error();
  return{items,nextCursor};
 }catch{throw new AdminModerationClientError('UNKNOWN');}
}
export function parseModerationDetail(value:unknown,id:string,listingId:string):ModerationDetail{
 try{
  const row=object(value,['request','snapshot','check']),snapshot=parseListingFormSnapshot(row.snapshot,listingId);
  const request=parseListingModerationState(row.request,snapshot.revision),check=parseListingPublicationCheck(row.check,snapshot.id,snapshot.revision);
  if(request.id!==parseListingDraftId(id)||!['pending','approved','rejected'].includes(request.state))throw Error();return{request,snapshot,check};
 }catch{throw new AdminModerationClientError('UNKNOWN');}
}
async function rpc(actor:string,body:Record<string,unknown>,method:'POST'|'PUT',options:Options={},binary=false):Promise<unknown>{
 try{
  parseListingDraftId(actor);options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
  const response=await fetch('/api/admin/listing-moderation',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedAdminId:actor,...body})});
  if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}size+=part.value.byteLength;if(size>2097152)throw Error();chunks.push(part.value);}
  }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(response.ok&&binary){if(response.headers.get('content-type')!=='image/webp'||size<12)throw Error();return new Blob([bytes],{type:'image/webp'});}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!response.ok){const codes:Record<string,number>={ADMIN_REQUIRED:403,UNAUTHENTICATED:401,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429,MEDIA_BUSY:503},code=value?.error?.code;
   throw new AdminModerationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
 }catch(error){if(error instanceof AdminModerationClientError)throw error;throw new AdminModerationClientError('UNKNOWN');}
}
export const adminListingModeration={
 list:async(actor:string,after:string|null,options?:Options)=>parseModerationQueue(await rpc(actor,{action:'list',after:after===null?null:parseListingDraftId(after)},'POST',options)),
 inspect:async(actor:string,id:string,listingId:string,options?:Options)=>parseModerationDetail(await rpc(actor,{action:'inspect',requestId:parseListingDraftId(id)},'POST',options),id,listingId),
 async decide(actor:string,id:string,revision:string,state:'approved'|'rejected',note:string|null,options?:Options){
  const result=parseListingModerationState(await rpc(actor,{requestId:parseListingDraftId(id),state,note},'PUT',options),parseListingDraftRevision(revision));
  if(result.id!==id||result.state!==state)throw new AdminModerationClientError('UNKNOWN');return result;
 },
 photo:async(actor:string,id:string,fileId:string,options?:Options)=>await rpc(actor,{action:'photo',requestId:parseListingDraftId(id),fileId:parseListingDraftId(fileId)},'POST',options,true) as Blob,
};
