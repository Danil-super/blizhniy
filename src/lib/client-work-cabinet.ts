"use client";
import {parseListingDraftId,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkCabinetPage,type WorkCabinetPage} from './work-cabinet-contract.ts';
import {WorkPublicationClientError} from './client-work-publications.ts';
import type {WorkPublicationKind} from './work-publication-contract';

export function createWorkCabinetClient(transport:typeof fetch){
 return{async list(owner:string,kind:WorkPublicationKind,after:ListingDraftCursor|null,options:{signal?:AbortSignal}={}):Promise<WorkCabinetPage>{
  try{
   options.signal?.throwIfAborted();parseListingDraftId(owner);if(kind!=='vacancy'&&kind!=='workRequest')throw Error();
   const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/work-cabinet',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({kind,expectedOwnerId:owner,after:parseListingDraftCursor(after)})});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}bytes+=part.value.byteLength;if(bytes>262144)throw Error();text+=decoder.decode(part.value,{stream:true});}
   }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const value=JSON.parse(text);
   if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,PUBLICATION_NOT_FOUND:404,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
    throw new WorkPublicationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
   return parseWorkCabinetPage(value,kind);
  }catch(error){if(error instanceof WorkPublicationClientError)throw error;throw new WorkPublicationClientError('UNKNOWN');}
 }};
}
export const workCabinet=createWorkCabinetClient((...args)=>fetch(...args));
