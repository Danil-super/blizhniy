"use client";
import {parseServicePublicationForm,type ServicePublicationKind,type ServicePublicationForm} from './service-publication-contract.ts';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseUploadedImage} from './media-upload-contract.ts';
import type {ServicePublicationSnapshot} from './postgres-service-publications';import type {ServiceModerationState} from './postgres-service-moderation';
type Options={signal?:AbortSignal};
export type ServiceSummary=Pick<ServicePublicationSnapshot,'id'|'kind'|'revision'|'status'|'paid'|'updatedAt'>&{title:string};
export type ServicePage={items:ServiceSummary[];nextCursor:ListingDraftCursor|null};
export type ServiceReviewItem={id:string;publicationId:string;kind:ServicePublicationKind;revision:string;title:string;updatedAt:string};
export type ServiceReviewQueue={items:ServiceReviewItem[];nextCursor:ListingDraftCursor|null};
export type ServiceReviewDetail={request:ServiceModerationState;snapshot:ServicePublicationSnapshot;issues:string[]};
const statuses=['draft','pending_payment','paid','published','archived','expired','rejected'];
export class ServiceClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='ADMIN_REQUIRED'?'Недостаточно прав для модерации.':
  code==='PUBLICATION_CHANGED'?'Материал изменён. Сверьте сохранённую версию.':code==='PUBLICATION_NOT_FOUND'?'Материал недоступен.':
  code==='INVALID_INPUT'?'Проверьте поля формы и фотографии.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':
  'Не удалось подтвердить результат. Проверьте сохранённую версию перед повторной отправкой.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join())throw Error();return value as Record<string,unknown>;}
function kind(value:unknown):ServicePublicationKind{if(value!=='specialist'&&value!=='fair'&&value!=='marquee')throw Error();return value;}
const timestamp=(value:unknown)=>parseListingDraftCursor({id:'00000000-0000-4000-8000-000000000000',updatedAt:value})!.updatedAt;
function title(value:unknown){if(typeof value!=='string'||value.length>160||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value))throw Error();return value;}
function financial(row:Record<string,unknown>){if(typeof row.status!=='string'||!statuses.includes(row.status)||typeof row.paid!=='boolean')throw Error();return{status:row.status,paid:row.paid};}
export function parseServicePublicationSnapshot(value:unknown,chosen:ServicePublicationKind,expectedId?:string):ServicePublicationSnapshot{
 try{
  const row=exact(value,['id','kind','form','photos','revision','status','paid','createdAt','updatedAt','publishedAt','expiresAt']),id=parseListingDraftId(row.id);
  if(kind(row.kind)!==chosen||expectedId&&id!==parseListingDraftId(expectedId)||!Array.isArray(row.photos)||row.photos.length>12)throw Error();
  const form=parseServicePublicationForm(chosen,row.form),photos=row.photos.map(parseUploadedImage);
  if(Object.keys(row.form as object).sort().join()!==Object.keys(form).sort().join()||photos.map(item=>item.id).join()!==(form.kind==='marquee'?[]:form.photoIds).join())throw Error();
  return{id,kind:chosen,form,photos,revision:parseListingDraftRevision(row.revision),...financial(row),createdAt:timestamp(row.createdAt),updatedAt:timestamp(row.updatedAt),
   publishedAt:row.publishedAt===null?null:timestamp(row.publishedAt),expiresAt:row.expiresAt===null?null:timestamp(row.expiresAt)};
 }catch{throw new ServiceClientError('UNKNOWN');}
}
function review(value:unknown):ServiceModerationState{
 const row=exact(value,['id','revision','state','note']);
 if(row.state==='not_submitted'){if(row.id!==null||row.revision!==null||row.note!==null)throw Error();return{id:null,revision:null,state:'not_submitted',note:null};}
 if(row.state!=='pending'&&row.state!=='approved'&&row.state!=='rejected'&&row.state!=='outdated')throw Error();
 if(row.state==='pending'||row.state==='approved'){if(row.note!==null)throw Error();}
 else if(row.note!==null&&(typeof row.note!=='string'||!row.note.trim()||row.note!==row.note.trim()||row.note.length>1000||!row.note.isWellFormed()||/[\x00-\x1f\x7f]/.test(row.note)))throw Error();
 if(row.state==='rejected'&&row.note===null)throw Error();return{id:parseListingDraftId(row.id),revision:parseListingDraftRevision(row.revision),state:row.state,note:row.note as string|null};
}
function transportRequest(transport:typeof fetch){
 return async(path:string,method:'POST'|'PUT',body:unknown,options:Options={},image=false):Promise<unknown>=>{
  try{
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport(path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});
   if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[],limit=image&&response.status===200?2097152:262144;let length=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}length+=part.value.byteLength;if(length>limit||chunks.length>=2048)throw Error();chunks.push(part.value);}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(image&&response.status===200){if(response.headers.get('content-type')!=='image/webp'||length<12)throw Error();return new Blob([bytes],{type:'image/webp'});}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,ADMIN_REQUIRED:403,PUBLICATION_NOT_FOUND:404,PUBLICATION_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
    throw new ServiceClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
  }catch(error){if(error instanceof ServiceClientError)throw error;throw new ServiceClientError('UNKNOWN');}
 };
}
/** Bounded same-origin transport; no automatic retries or Bearer/legacy authority. */
export function createServicePublicationClient(transport:typeof fetch){
 const send=transportRequest(transport);
 const request=(action:string,owner:string,chosen:ServicePublicationKind,input:Record<string,unknown>,options?:Options)=>send('/api/account/service-publications',['create','update'].includes(action)?'PUT':'POST',
  {action,expectedOwnerId:parseListingDraftId(owner),kind:kind(chosen),...input},options);
 return{
  read:async(owner:string,chosen:ServicePublicationKind,id:string,options?:Options)=>parseServicePublicationSnapshot(await request('read',owner,chosen,{publicationId:parseListingDraftId(id)},options),chosen,id),
  create:async(owner:string,chosen:ServicePublicationKind,key:string,form:ServicePublicationForm,options?:Options)=>parseServicePublicationSnapshot(await request('create',owner,chosen,{creationKey:parseListingDraftId(key),form:parseServicePublicationForm(chosen,form)},options),chosen),
  update:async(owner:string,chosen:ServicePublicationKind,id:string,revision:string,form:ServicePublicationForm,options?:Options)=>parseServicePublicationSnapshot(await request('update',owner,chosen,{publicationId:parseListingDraftId(id),expectedRevision:parseListingDraftRevision(revision),form:parseServicePublicationForm(chosen,form)},options),chosen,id),
  async intent(owner:string,chosen:ServicePublicationKind,key:string,options?:Options){const value=await request('intent',owner,chosen,{creationKey:parseListingDraftId(key)},options);return value===null?null:parseServicePublicationSnapshot(value,chosen);},
  async list(owner:string,chosen:ServicePublicationKind,after:ListingDraftCursor|null,options?:Options):Promise<ServicePage>{try{
   const row=exact(await request('list',owner,chosen,{after:parseListingDraftCursor(after)},options),['items','nextCursor']);if(!Array.isArray(row.items)||row.items.length>20)throw Error();
   const items=row.items.map(value=>{const item=exact(value,['id','kind','revision','status','paid','updatedAt','title']);if(kind(item.kind)!==chosen)throw Error();
    return{id:parseListingDraftId(item.id),kind:chosen,revision:parseListingDraftRevision(item.revision),title:title(item.title),...financial(item),updatedAt:timestamp(item.updatedAt)};});
   if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();return{items,nextCursor:parseListingDraftCursor(row.nextCursor)};
  }catch(error){if(error instanceof ServiceClientError)throw error;throw new ServiceClientError('UNKNOWN');}},
 };
}
export function createServiceModerationClient(transport:typeof fetch){
 const send=transportRequest(transport);
 async function parsed<T>(work:()=>Promise<unknown>,parse:(value:unknown)=>T){try{return parse(await work());}catch(error){if(error instanceof ServiceClientError)throw error;throw new ServiceClientError('UNKNOWN');}}
 const owner=(actor:string,chosen:ServicePublicationKind,id:string,revision:string)=>({expectedOwnerId:parseListingDraftId(actor),kind:kind(chosen),publicationId:parseListingDraftId(id),expectedRevision:parseListingDraftRevision(revision)});
 const actor=(actor:string,chosen:ServicePublicationKind)=>({expectedAdminId:parseListingDraftId(actor),kind:kind(chosen)});
 function ownerReview(value:unknown,expectedRevision:string,submit=false){
  const result=review(value),expected=parseListingDraftRevision(expectedRevision);
  if(result.state==='not_submitted'){if(submit)throw Error();return result;}
  if(result.state==='outdated'){if(submit||BigInt(result.revision!)>=BigInt(expected))throw Error();}
  else if(result.revision!==expected)throw Error();return result;
 }
 return{
  read:(id:string,chosen:ServicePublicationKind,publication:string,revision:string,options?:Options)=>parsed(()=>send('/api/account/service-moderation','POST',owner(id,chosen,publication,revision),options),value=>ownerReview(value,revision)),
  submit:(id:string,chosen:ServicePublicationKind,publication:string,revision:string,options?:Options)=>parsed(()=>send('/api/account/service-moderation','PUT',owner(id,chosen,publication,revision),options),value=>ownerReview(value,revision,true)),
  adminList:(id:string,chosen:ServicePublicationKind,after:ListingDraftCursor|null,options?:Options):Promise<ServiceReviewQueue>=>parsed(()=>send('/api/admin/service-moderation','POST',{...actor(id,chosen),action:'list',after:parseListingDraftCursor(after)},options),value=>{
   const row=exact(value,['items','nextCursor']);if(!Array.isArray(row.items)||row.items.length>20)throw Error();const items=row.items.map(value=>{const item=exact(value,['id','publicationId','kind','revision','title','updatedAt']);if(kind(item.kind)!==chosen)throw Error();return{id:parseListingDraftId(item.id),publicationId:parseListingDraftId(item.publicationId),kind:chosen,revision:parseListingDraftRevision(item.revision),title:title(item.title),updatedAt:timestamp(item.updatedAt)};});
   if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();return{items,nextCursor:parseListingDraftCursor(row.nextCursor)};
  }),
  adminInspect:(id:string,chosen:ServicePublicationKind,item:ServiceReviewItem,options?:Options):Promise<ServiceReviewDetail>=>parsed(()=>send('/api/admin/service-moderation','POST',{...actor(id,chosen),action:'inspect',requestId:parseListingDraftId(item.id)},options),value=>{
   const row=exact(value,['request','snapshot','issues']),request=review(row.request),snapshot=parseServicePublicationSnapshot(row.snapshot,chosen,item.publicationId);
   if(request.id!==item.id||request.revision!==snapshot.revision||snapshot.revision!==item.revision||!Array.isArray(row.issues)||row.issues.length>20||row.issues.some(issue=>typeof issue!=='string'||issue.length>2000))throw Error();return{request,snapshot,issues:row.issues as string[]};
  }),
  adminDecide:(id:string,chosen:ServicePublicationKind,item:ServiceReviewItem,state:'approved'|'rejected',note:string|null,options?:Options)=>parsed(()=>send('/api/admin/service-moderation','PUT',{...actor(id,chosen),requestId:parseListingDraftId(item.id),state,note},options),value=>{
   const result=review(value);if(result.id!==item.id||result.revision!==item.revision||result.state!==state||result.note!==note)throw Error();return result;
  }),
  adminPhoto:async(id:string,chosen:ServicePublicationKind,requestId:string,fileId:string,options?:Options)=>await send('/api/admin/service-moderation','POST',{...actor(id,chosen),action:'photo',requestId:parseListingDraftId(requestId),fileId:parseListingDraftId(fileId)},options,true) as Blob,
 };
}
export const servicePublications=createServicePublicationClient((...args)=>fetch(...args));
export const serviceModeration=createServiceModerationClient((...args)=>fetch(...args));
