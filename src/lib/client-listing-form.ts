"use client";
import {parseListingFormDraft,type ListingFormDraft,type ListingFormSnapshot} from './listing-form-contract.ts';
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import {parseUploadedImage} from './media-upload-contract.ts';
type Options={signal?:AbortSignal};
export class ListingFormClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='INVALID_INPUT'?'Проверьте поля формы: категорию, город, контакты и параметры аренды.':code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':
  code==='DRAFT_CHANGED'?'Черновик изменён. Сверьте сохранённую версию.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':'Результат не подтверждён. Проверьте сохранённую версию перед повтором.');this.code=code;}
}
export function parseListingFormSnapshot(value:unknown,expectedId:string):ListingFormSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ListingFormClientError('UNKNOWN');const row=value as ListingFormSnapshot;
 if(Object.keys(row).sort().join()!=='form,id,photos,revision'||row.id!==parseListingDraftId(expectedId)||!Array.isArray(row.photos)||row.photos.length>10000)throw new ListingFormClientError('UNKNOWN');
 if(!row.form||![16,17].includes(Object.keys(row.form).length))throw new ListingFormClientError('UNKNOWN');
 const form=parseListingFormDraft(row.form),photos=row.photos.map(parseUploadedImage);
 if(Object.keys(row.form).sort().join()!==Object.keys(form).sort().join())throw new ListingFormClientError('UNKNOWN');
 if(photos.map(item=>item.id).join()!==form.photoIds.join())throw new ListingFormClientError('UNKNOWN');
 return{id:row.id,revision:parseListingDraftRevision(row.revision),form,photos};
}
async function request(owner:string,id:string,revision:string|null,form:ListingFormDraft|null,options:Options={}):Promise<ListingFormSnapshot>{
 try{
  options.signal?.throwIfAborted();parseListingDraftId(owner);parseListingDraftId(id);
  const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
  const response=await fetch('/api/account/listing-form',{method:form?'PUT':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
   headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId:owner,listingId:id,...(form?{expectedRevision:parseListingDraftRevision(revision),form:parseListingFormDraft(form)}:{})})});
  if(!response.body)throw new Error('Empty reply');const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}
   size+=part.value.byteLength;if(size>2097152)throw new Error('Reply too large');text+=decoder.decode(part.value,{stream:true});}
  }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const payload=JSON.parse(text);
  if(!response.ok){const codes:Record<string,number>={UNAUTHENTICATED:401,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429},code=payload?.error?.code;
   throw new ListingFormClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
  return parseListingFormSnapshot(payload,id);
 }catch(error){if(error instanceof ListingFormClientError)throw error;throw new ListingFormClientError('UNKNOWN');}
}
export const productionListingForm={read:(owner:string,id:string,options?:Options)=>request(owner,id,null,null,options),
 write:(owner:string,id:string,revision:string,form:ListingFormDraft,options?:Options)=>request(owner,id,revision,form,options)};
