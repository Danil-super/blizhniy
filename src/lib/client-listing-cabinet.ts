"use client";
import {parseListingDraftCursor,parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {listingCabinetPlacementHeader,parseListingCabinetPage,type ListingCabinetPage} from './listing-cabinet-contract.ts';
const codes={PHONE_REQUIRED:403,UNAUTHENTICATED:401,SESSION_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409} as const;
export class ListingCabinetClientError extends Error{
 constructor(readonly code:keyof typeof codes|'UNKNOWN'){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':'Не удалось загрузить объявления. Попробуйте ещё раз.');this.name='ListingCabinetClientError';}
}
export function createListingCabinetClient(transport:typeof fetch,{includePlacement=false}:{includePlacement?:boolean}={}){
 async function call(path:string,body:Record<string,unknown>,options:{signal?:AbortSignal}={},placement=false):Promise<unknown>{
  try{
   const timeout=AbortSignal.timeout(10000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   signal.throwIfAborted();
   const response=await transport(path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1',...(placement?{[listingCabinetPlacementHeader]:'1'}:{})},body:JSON.stringify(body)});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
   try{for(;;){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done){complete=true;text+=decoder.decode();break;}bytes+=chunk.value.byteLength;if(bytes>131072)throw Error();text+=decoder.decode(chunk.value,{stream:true});}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const payload=JSON.parse(text);
   if(response.status!==200){const code=payload?.error?.code;if(Object.hasOwn(codes,code)&&codes[code as keyof typeof codes]===response.status)throw new ListingCabinetClientError(code);throw Error();}
   return payload;
  }catch(error){if(error instanceof ListingCabinetClientError)throw error;throw new ListingCabinetClientError('UNKNOWN');}
 }
 return{
  async list(owner:string,cursor:unknown=null,options:{signal?:AbortSignal}={}):Promise<ListingCabinetPage>{
   try{return parseListingCabinetPage(await call('/api/account/listings',{expectedOwnerId:parseListingDraftId(owner),cursor:parseListingDraftCursor(cursor)},options,includePlacement));}
   catch(error){if(error instanceof ListingCabinetClientError)throw error;throw new ListingCabinetClientError('UNKNOWN');}
  },
  async change(owner:string,id:string,revision:string,action:'withdraw'|'restore',options:{signal?:AbortSignal}={}){
   const value=await call('/api/account/listing-actions',{expectedOwnerId:parseListingDraftId(owner),listingId:parseListingDraftId(id),expectedRevision:parseListingDraftRevision(revision),action},options);
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='id,revision,status')throw new ListingCabinetClientError('UNKNOWN');
   const row=value as Record<string,unknown>;
   if(row.id!==id||row.status!==(action==='withdraw'?'archived':'published'))throw new ListingCabinetClientError('UNKNOWN');
   return{id,revision:parseListingDraftRevision(row.revision),status:row.status as 'published'|'archived'};
  },
 };
}
export const listingCabinet=createListingCabinetClient((...args)=>fetch(...args),{includePlacement:true});
