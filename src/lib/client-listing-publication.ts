"use client";
import {parseListingDraftId,parseListingDraftRevision} from './listing-draft-contract.ts';
import type {ListingPublicationCheck,ListingPublicationIssue} from './listing-publication-check';
export class ListingPublicationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='DRAFT_CHANGED'?'Черновик изменился. Закройте редактор и откройте объявление повторно.':code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите проверку позже.':'Не удалось проверить объявление. Повторите проверку позже.');this.code=code;}
}
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw new ListingPublicationClientError('UNKNOWN');
 return value as Record<string,unknown>;
}
export function parseListingPublicationCheck(value:unknown,id:string,revision:string):ListingPublicationCheck{
 const row=object(value,['listingId','revision','checksPassed','issues','tariff']);
 if(row.listingId!==id||row.revision!==revision||typeof row.checksPassed!=='boolean'||!Array.isArray(row.issues)||row.issues.length>30)throw new ListingPublicationClientError('UNKNOWN');
 const issues=row.issues.map(value=>{const issue=object(value,['field','message']);
  if(!['title','description','category','city','contact','booking','tariff'].includes(String(issue.field))||typeof issue.message!=='string'||!issue.message||issue.message.length>500||!issue.message.isWellFormed())throw new ListingPublicationClientError('UNKNOWN');
  return{field:issue.field as ListingPublicationIssue['field'],message:issue.message};
 });
 let tariff:ListingPublicationCheck['tariff']=null;
 if(row.tariff!==null){const offer=object(row.tariff,['id','name','amount','currency','durationDays']);
  if(typeof offer.id!=='string'||offer.id.length>100||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(offer.id)||typeof offer.name!=='string'||!offer.name.trim()||offer.name.length>200||
   typeof offer.amount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(offer.amount)||offer.currency!=='RUB'||typeof offer.durationDays!=='number'||!Number.isSafeInteger(offer.durationDays)||offer.durationDays<1||offer.durationDays>3650)throw new ListingPublicationClientError('UNKNOWN');
  tariff={id:offer.id,name:offer.name,amount:offer.amount,currency:'RUB',durationDays:offer.durationDays};
 }
 if(row.checksPassed!==(issues.length===0)||(tariff===null)!==issues.some(issue=>issue.field==='tariff'))throw new ListingPublicationClientError('UNKNOWN');
 return{listingId:id,revision,checksPassed:row.checksPassed,issues,tariff};
}
export async function inspectListingPublication(owner:string,id:string,revision:string,options:{signal?:AbortSignal}={}):Promise<ListingPublicationCheck>{
 try{
  parseListingDraftId(owner);parseListingDraftId(id);parseListingDraftRevision(revision);options.signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
  const response=await fetch('/api/account/listing-publication',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
   headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({expectedOwnerId:owner,listingId:id,expectedRevision:revision})});
  if(!response.body)throw new Error('Empty response');const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}bytes+=part.value.byteLength;if(bytes>16384)throw new Error('Oversized response');text+=decoder.decode(part.value,{stream:true});}
  }finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const value=JSON.parse(text);
  if(!response.ok){const codes:Record<string,number>={UNAUTHENTICATED:401,DRAFT_NOT_FOUND:404,DRAFT_CHANGED:409,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
   throw new ListingPublicationClientError(Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}
  return parseListingPublicationCheck(value,id,revision);
 }catch(error){if(error instanceof ListingPublicationClientError)throw error;throw new ListingPublicationClientError('UNKNOWN');}
}
