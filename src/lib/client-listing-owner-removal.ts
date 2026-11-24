"use client";
import {parseListingOwnerRemovalRequest,parseListingOwnerRemovalResult,type DraftRemovalTarget,type ListingOwnerRemovalResult} from './listing-owner-removal-contract.ts';
const codes={UNAUTHENTICATED:401,INVALID_INPUT:422,RATE_LIMITED:429,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409,CHECKOUT_ACTIVE:409} as const;
type Options={signal?:AbortSignal;target?:DraftRemovalTarget};
export class ListingOwnerRemovalClientError extends Error{
 constructor(readonly code:keyof typeof codes|'UNKNOWN'){super('Не удалось подтвердить удаление объявления.');this.name='ListingOwnerRemovalClientError';}
}
export function createListingOwnerRemovalClient(transport:typeof fetch){
 async function call(action:'read'|'remove',owner:string,id:string,revision:string,options:Options={}):Promise<ListingOwnerRemovalResult>{
  try{
   const body=parseListingOwnerRemovalRequest({action,expectedOwnerId:owner,listingId:id,expectedRevision:revision,
    ...(options.target===undefined?{}:{target:options.target})});
   const timeout=AbortSignal.timeout(10000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
   signal.throwIfAborted();
   const response=await transport('/api/account/listing-removal',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});
   if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
   try{for(;;){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done){complete=true;text+=decoder.decode();break;}bytes+=chunk.value.byteLength;if(bytes>4096)throw Error();text+=decoder.decode(chunk.value,{stream:true});}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const payload=JSON.parse(text);
   if(response.status!==200){const code=payload?.error?.code;if(Object.hasOwn(codes,code)&&codes[code as keyof typeof codes]===response.status)throw new ListingOwnerRemovalClientError(code);throw Error();}
   const result=parseListingOwnerRemovalResult(payload,body.listingId,body.expectedRevision);
   if(action==='remove'&&!result.removed)throw Error();return result;
  }catch(error){if(error instanceof ListingOwnerRemovalClientError)throw error;throw new ListingOwnerRemovalClientError('UNKNOWN');}
 }
 return{read:(owner:string,id:string,revision:string,options?:Options)=>call('read',owner,id,revision,options),
  remove:(owner:string,id:string,revision:string,options?:Options)=>call('remove',owner,id,revision,options)};
}
export const listingOwnerRemoval=createListingOwnerRemovalClient((...args)=>fetch(...args));
