"use client";
import {parseWorkPublicationForm,type WorkPublicationKind,type WorkPublicationForm} from './work-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseUploadedImage} from './media-upload-contract.ts';
import type {WorkPublicationSnapshot} from './postgres-work-publications';
export type WorkPublicationSummary=Pick<WorkPublicationSnapshot,'id'|'kind'|'revision'|'status'|'paid'|'updatedAt'>&{title:string};
export type WorkPublicationPage={items:WorkPublicationSummary[];nextCursor:ListingDraftCursor|null};
type Options={signal?:AbortSignal};
const statuses=['draft','pending_payment','paid','published','archived','expired','rejected'];
export class WorkPublicationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='PUBLICATION_CHANGED'?'Публикация изменена. Сверьте сохранённую версию.':
  code==='PUBLICATION_NOT_FOUND'?'Публикация недоступна.':code==='INVALID_INPUT'?'Проверьте поля, город, профессию и фотографии.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':
  'Ответ не получен. Проверьте сохранённую версию перед повторной отправкой.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join())throw Error();return value as Record<string,unknown>;
}
function kind(value:unknown):WorkPublicationKind{if(value!=='vacancy'&&value!=='workRequest')throw Error();return value;}
function timestamp(value:unknown){return parseListingDraftCursor({id:'00000000-0000-4000-8000-000000000000',updatedAt:value})!.updatedAt;}
function summary(value:unknown,expectedKind:WorkPublicationKind):WorkPublicationSummary{
 const row=exact(value,['id','kind','revision','status','paid','updatedAt','title']);
 if(kind(row.kind)!==expectedKind||typeof row.status!=='string'||!statuses.includes(row.status)||typeof row.paid!=='boolean'||typeof row.title!=='string'||row.title.length>120||!row.title.isWellFormed()||/[\x00-\x1f\x7f]/.test(row.title))throw Error();
 return{id:parseListingDraftId(row.id),kind:expectedKind,revision:parseListingDraftRevision(row.revision),status:row.status as string,paid:row.paid,title:row.title,updatedAt:timestamp(row.updatedAt)};
}
export function parseWorkPublicationSnapshot(value:unknown,expectedKind:WorkPublicationKind,expectedId?:string):WorkPublicationSnapshot{
 try{
  const row=exact(value,['id','kind','revision','status','paid','form','photos','createdAt','updatedAt','publishedAt','expiresAt']);
  const id=parseListingDraftId(row.id);if((expectedId&&id!==parseListingDraftId(expectedId))||kind(row.kind)!==expectedKind||typeof row.status!=='string'||!statuses.includes(row.status)||typeof row.paid!=='boolean'||!Array.isArray(row.photos)||row.photos.length>20)throw Error();
  const form=parseWorkPublicationForm(expectedKind,row.form),photos=row.photos.map(parseUploadedImage);
  if(Object.keys(row.form as object).sort().join()!==Object.keys(form).sort().join())throw Error();
  if(photos.map(item=>item.id).join()!==form.photoIds.join())throw Error();
  return{id,kind:expectedKind,revision:parseListingDraftRevision(row.revision),status:row.status as string,paid:row.paid,form,photos,
   createdAt:timestamp(row.createdAt),updatedAt:timestamp(row.updatedAt),publishedAt:row.publishedAt===null?null:timestamp(row.publishedAt),expiresAt:row.expiresAt===null?null:timestamp(row.expiresAt)};
 }catch{throw new WorkPublicationClientError('UNKNOWN');}
}
/** Cookie-only private transport with bounded reads and no implicit mutation retries. */
export function createWorkPublicationClient(transport:typeof fetch){
 async function request(action:string,owner:string,chosen:WorkPublicationKind,input:Record<string,unknown>,options:Options={}):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();parseListingDraftId(owner);kind(chosen);
   const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/work-publications',{method:['create','update'].includes(action)?'PUT':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({action,expectedOwnerId:owner,kind:chosen,...input})});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}bytes+=part.value.byteLength;if(bytes>2097152)throw Error();text+=decoder.decode(part.value,{stream:true});}
   }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const value=JSON.parse(text);if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,PUBLICATION_NOT_FOUND:404,PUBLICATION_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
    throw new WorkPublicationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
  }catch(error){if(error instanceof WorkPublicationClientError)throw error;throw new WorkPublicationClientError('UNKNOWN');}
 }
 async function view(work:()=>Promise<unknown>,chosen:WorkPublicationKind,id?:string){return parseWorkPublicationSnapshot(await work(),chosen,id);}
 return{
  read:(owner:string,chosen:WorkPublicationKind,id:string,options?:Options)=>view(()=>request('read',owner,chosen,{publicationId:parseListingDraftId(id)},options),chosen,id),
  create:(owner:string,chosen:WorkPublicationKind,key:string,form:WorkPublicationForm,options?:Options)=>view(()=>request('create',owner,chosen,{creationKey:parseListingDraftId(key),form:parseWorkPublicationForm(chosen,form)},options),chosen),
  update:(owner:string,chosen:WorkPublicationKind,id:string,revision:string,form:WorkPublicationForm,options?:Options)=>view(()=>request('update',owner,chosen,{publicationId:parseListingDraftId(id),expectedRevision:parseListingDraftRevision(revision),form:parseWorkPublicationForm(chosen,form)},options),chosen,id),
  async intent(owner:string,chosen:WorkPublicationKind,key:string,options?:Options){const value=await request('intent',owner,chosen,{creationKey:parseListingDraftId(key)},options);return value===null?null:parseWorkPublicationSnapshot(value,chosen);},
  async list(owner:string,chosen:WorkPublicationKind,after:ListingDraftCursor|null,options?:Options):Promise<WorkPublicationPage>{
   try{const value=exact(await request('list',owner,chosen,{after:parseListingDraftCursor(after)},options),['items','nextCursor']);
    if(!Array.isArray(value.items)||value.items.length>20)throw Error();const items=value.items.map(item=>summary(item,chosen));if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();
    return{items,nextCursor:parseListingDraftCursor(value.nextCursor)};
   }catch(error){if(error instanceof WorkPublicationClientError)throw error;throw new WorkPublicationClientError('UNKNOWN');}
  },
 };
}
export const productionWorkPublications=createWorkPublicationClient((...args)=>fetch(...args));
