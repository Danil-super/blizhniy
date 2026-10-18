"use client";
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseListingModerationState} from './client-listing-moderation.ts';
import {parseWorkPublicationSnapshot} from './client-work-publications.ts';
import {parseWorkReviewDecision} from './work-moderation-contract.ts';
import type {WorkPublicationKind} from './work-publication-contract';
import type {WorkModerationState} from './postgres-work-moderation';
export type WorkReviewItem={id:string;publicationId:string;kind:WorkPublicationKind;revision:string;title:string;updatedAt:string};
export type WorkReviewQueue={items:WorkReviewItem[];nextCursor:ListingDraftCursor|null};
export type WorkReviewDetail={request:WorkModerationState;snapshot:ReturnType<typeof parseWorkPublicationSnapshot>;issues:string[]};
export class WorkModerationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'||code==='ADMIN_REQUIRED'?'Войдите в аккаунт повторно.':code==='PUBLICATION_CHANGED'?'Публикация изменилась. Откройте сохранённую версию.':
  code==='INVALID_INPUT'?'Заполните обязательные поля перед отправкой.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Ответ не получен. Проверьте статус отправки перед повторным действием.');this.code=code;}
}
export function createWorkModerationClient(transport:typeof fetch){
 async function rpc(path:string,method:'POST'|'PUT',body:Record<string,unknown>,options:{signal?:AbortSignal}={},binary=false):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();
   const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});
   if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}size+=part.value.byteLength;if(size>2097152)throw Error();chunks.push(part.value);}
   }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(binary&&response.status===200){if(response.headers.get('content-type')!=='image/webp'||size<12)throw Error();return new Blob([bytes],{type:'image/webp'});}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(response.status!==200){const codes:Record<string,number>={ADMIN_REQUIRED:403,UNAUTHENTICATED:401,PUBLICATION_CHANGED:409,PUBLICATION_NOT_FOUND:404,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
    throw new WorkModerationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
   return value;
  }catch(error){if(error instanceof WorkModerationClientError)throw error;throw new WorkModerationClientError('UNKNOWN');}
 }
 async function request(method:'POST'|'PUT',owner:string,kind:WorkPublicationKind,id:string,revision:string,options?:{signal?:AbortSignal}){
  try{parseListingDraftRevision(revision);if(kind!=='vacancy'&&kind!=='workRequest')throw Error();return parseListingModerationState(await rpc('/api/account/work-moderation',method,
   {expectedOwnerId:parseListingDraftId(owner),kind,publicationId:parseListingDraftId(id),expectedRevision:revision},options),revision);
  }catch(error){if(error instanceof WorkModerationClientError)throw error;throw new WorkModerationClientError('UNKNOWN');}
 }
 const admin=(actor:string,body:Record<string,unknown>,method:'POST'|'PUT',options?:{signal?:AbortSignal},binary=false)=>rpc('/api/admin/work-moderation',method,{expectedAdminId:parseListingDraftId(actor),...body},options,binary);
 return{read:(owner:string,kind:WorkPublicationKind,id:string,revision:string,options?:{signal?:AbortSignal})=>request('POST',owner,kind,id,revision,options),
  submit:(owner:string,kind:WorkPublicationKind,id:string,revision:string,options?:{signal?:AbortSignal})=>request('PUT',owner,kind,id,revision,options),
  async adminList(actor:string,after:ListingDraftCursor|null,options?:{signal?:AbortSignal}):Promise<WorkReviewQueue>{
   try{const row=await admin(actor,{action:'list',after:parseListingDraftCursor(after)},'POST',options) as WorkReviewQueue;
    if(!row||Object.keys(row).sort().join()!=='items,nextCursor'||!Array.isArray(row.items)||row.items.length>20)throw Error();
    const items=row.items.map(item=>{if(Object.keys(item).sort().join()!=='id,kind,publicationId,revision,title,updatedAt'||!['vacancy','workRequest'].includes(item.kind)||typeof item.title!=='string'||!item.title.isWellFormed()||item.title.length>120)throw Error();
     parseListingDraftId(item.id);parseListingDraftId(item.publicationId);parseListingDraftRevision(item.revision);parseListingDraftCursor({id:item.id,updatedAt:item.updatedAt});return item;});
    if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();return{items,nextCursor:parseListingDraftCursor(row.nextCursor)};
   }catch(error){if(error instanceof WorkModerationClientError)throw error;throw new WorkModerationClientError('UNKNOWN');}
  },
  async adminInspect(actor:string,item:WorkReviewItem,options?:{signal?:AbortSignal}):Promise<WorkReviewDetail>{
   try{const row=await admin(actor,{action:'inspect',requestId:parseListingDraftId(item.id)},'POST',options) as WorkReviewDetail;
    if(!row||Object.keys(row).sort().join()!=='issues,request,snapshot'||!Array.isArray(row.issues)||row.issues.length>30||row.issues.some(issue=>typeof issue!=='string'||!issue.isWellFormed()||issue.length>1000))throw Error();
    const snapshot=parseWorkPublicationSnapshot(row.snapshot,item.kind,item.publicationId),request=parseListingModerationState(row.request,snapshot.revision);
    if(snapshot.revision!==item.revision||request.id!==item.id||!['pending','approved','rejected'].includes(request.state))throw Error();return{snapshot,request,issues:row.issues};
   }catch(error){if(error instanceof WorkModerationClientError)throw error;throw new WorkModerationClientError('UNKNOWN');}
  },
  async adminDecide(actor:string,item:WorkReviewItem,state:'approved'|'rejected',note:string|null,options?:{signal?:AbortSignal}){
   try{const decision=parseWorkReviewDecision(state,note),result=parseListingModerationState(await admin(actor,{requestId:parseListingDraftId(item.id),...decision},'PUT',options),parseListingDraftRevision(item.revision));
    if(result.id!==item.id||result.state!==decision.state||result.note!==decision.note)throw Error();return result;
   }catch(error){if(error instanceof WorkModerationClientError)throw error;throw new WorkModerationClientError('UNKNOWN');}
  },
  async adminPhoto(actor:string,id:string,file:string,options?:{signal?:AbortSignal}){return await admin(actor,{action:'photo',requestId:parseListingDraftId(id),fileId:parseListingDraftId(file)},'POST',options,true) as Blob;},
 };
}
export const workModeration=createWorkModerationClient((...args)=>fetch(...args));
