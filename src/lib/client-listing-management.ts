"use client";
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseListingManagementItem,parseListingManagementSummary,type ListingManagementPage} from './listing-block-contract.ts';
import {parseListingFormSnapshot} from './client-listing-form.ts';
import type {ListingFormSnapshot} from './listing-form-contract.ts';
export type ListingManagementDetail={listing:ReturnType<typeof parseListingManagementItem>;snapshot:ListingFormSnapshot};
export class ListingManagementClientError extends Error {
 constructor(readonly code:string){super(code==='ADMIN_REQUIRED'||code==='UNAUTHENTICATED'?'Доступ администратора не подтверждён.':code==='LISTING_CHANGED'?'Объявление изменилось. Перечитайте его перед решением.':code==='INVALID_INPUT'?'Укажите причину блокировки от 1 до 1000 символов.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Результат не подтверждён. Перечитайте объявление перед повторным действием.');}
}
async function rpc(actor:string,body:Record<string,unknown>,signal?:AbortSignal,binary=false):Promise<unknown>{
 try{
  parseListingDraftId(actor);const timeout=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetch('/api/admin/listing-management',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:combined,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedAdminId:actor,...body})});
  if(!response.body)throw Error('Empty reply');const reader=response.body.getReader();let size=0,complete=false;const chunks:Uint8Array[]=[];
  try{for(;;){combined.throwIfAborted();const next=await reader.read();combined.throwIfAborted();if(next.done){complete=true;break;}size+=next.value.byteLength;if(size>2097152)throw Error('Reply limit');chunks.push(next.value);}}
  finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(binary&&response.ok){if(response.headers.get('content-type')!=='image/webp'||size<12)throw Error('Image invalid');return new Blob([bytes],{type:'image/webp'});}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!response.ok){const codes:Record<string,number>={ADMIN_REQUIRED:403,UNAUTHENTICATED:401,LISTING_NOT_FOUND:404,LISTING_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429};const code=value?.error?.code;
   throw new ListingManagementClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
  return value;
 }catch(error){if(error instanceof ListingManagementClientError)throw error;throw new ListingManagementClientError('UNKNOWN');}
}
function detail(value:unknown,id:string):ListingManagementDetail {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='listing,snapshot')throw new ListingManagementClientError('UNKNOWN');
 const row=value as ListingManagementDetail,listing=parseListingManagementItem(row.listing),snapshot=parseListingFormSnapshot(row.snapshot,id);
 if(listing.id!==id||listing.revision!==snapshot.revision)throw new ListingManagementClientError('UNKNOWN');return {listing,snapshot};
}
export const listingManagement={
 async list(actor:string,after:string|null,signal?:AbortSignal):Promise<ListingManagementPage>{
  const value=await rpc(actor,{action:'list',after},signal);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='items,nextCursor')throw new ListingManagementClientError('UNKNOWN');
  const row=value as ListingManagementPage;if(!Array.isArray(row.items)||row.items.length>20)throw new ListingManagementClientError('UNKNOWN');
  const items=row.items.map(parseListingManagementSummary),nextCursor=row.nextCursor===null?null:parseListingDraftId(row.nextCursor);
  if(new Set(items.map(item=>item.id)).size!==items.length||nextCursor&&(items.length!==20||items.at(-1)?.id!==nextCursor))throw new ListingManagementClientError('UNKNOWN');return {items,nextCursor};
 },
 inspect:async(actor:string,id:string,signal?:AbortSignal)=>detail(await rpc(actor,{action:'inspect',listingId:id},signal),id),
 block:async(actor:string,id:string,revision:string,reason:string,signal?:AbortSignal)=>parseListingManagementItem(await rpc(actor,{action:'block',listingId:id,expectedRevision:revision,reason},signal)),
 photo:async(actor:string,id:string,file:string,signal?:AbortSignal)=>await rpc(actor,{action:'photo',listingId:id,fileId:file},signal,true) as Blob,
};
