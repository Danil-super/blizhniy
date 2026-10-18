"use client";
import {parseListingDraftId,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import type {InboxItem,InboxPage} from './postgres-notification-inbox';
type Options={signal?:AbortSignal};
export class InboxClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':'Не удалось подтвердить результат. Обновите уведомления перед повторным действием.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;
}
function text(value:unknown,max:number,multiline=false):string{
 if(typeof value!=='string'||!value.length||!value.isWellFormed()||[...value].length>max||
  (multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value))throw Error();return value;
}
function item(value:unknown):InboxItem{
 const row=exact(value,['id','category','tone','title','message','createdAt','read','actionHref','bookingRequestId']),id=parseListingDraftId(row.id);
 if(!['system','publication','payment','message','booking'].includes(row.category as string)||!['info','success','warning'].includes(row.tone as string)||typeof row.read!=='boolean'||
  row.actionHref!==null&&(typeof row.actionHref!=='string'||!/^\/cabinet(?:\/[a-z0-9-]+)*$/.test(row.actionHref)))throw Error();
 const createdAt=parseListingDraftCursor({id,updatedAt:row.createdAt})!.updatedAt;
 return{id,category:row.category as InboxItem['category'],tone:row.tone as InboxItem['tone'],title:text(row.title,200),message:text(row.message,4000,true),createdAt,read:row.read,
  actionHref:row.actionHref as string|null,bookingRequestId:row.bookingRequestId===null?null:parseListingDraftId(row.bookingRequestId)};
}
const before=(left:ListingDraftCursor,right:ListingDraftCursor)=>left.updatedAt<right.updatedAt||left.updatedAt===right.updatedAt&&left.id<right.id;
export function createNotificationInboxClient(transport:typeof fetch){
 async function send(owner:string,action:'list'|'read'|'dismiss',input:Record<string,unknown>,options:Options={}):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/notifications',{method:action==='list'?'POST':'PUT',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({action,expectedOwnerId:parseListingDraftId(owner),...input})});
   if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[],decoder=new TextDecoder('utf-8',{fatal:true});let length=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}length+=part.value.byteLength;
    if(length>524288||chunks.length>=2048)throw Error();chunks.push(part.value);}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const value=JSON.parse(decoder.decode(bytes));if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,INVALID_INPUT:422,RATE_LIMITED:429},code=value?.error?.code;
    throw new InboxClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
  }catch(error){if(error instanceof InboxClientError)throw error;throw new InboxClientError('UNKNOWN');}
 }
 return{
  async list(owner:string,after:ListingDraftCursor|null,options?:Options):Promise<InboxPage>{try{
   const cursor=parseListingDraftCursor(after),row=exact(await send(owner,'list',{after:cursor},options),['items','nextCursor']);
   if(!Array.isArray(row.items)||row.items.length>20)throw Error();const items=row.items.map(item),next=parseListingDraftCursor(row.nextCursor);
   if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();let previous=cursor;
   for(const value of items){const current={id:value.id,updatedAt:value.createdAt};if(previous&&!before(current,previous))throw Error();previous=current;}
   if(next&&(items.length!==20||next.id!==previous?.id||next.updatedAt!==previous.updatedAt))throw Error();return{items,nextCursor:next};
  }catch(error){if(error instanceof InboxClientError)throw error;throw new InboxClientError('UNKNOWN');}},
  async mark(owner:string,action:'read'|'dismiss',values:string[],options?:Options):Promise<void>{try{
   if(!['read','dismiss'].includes(action)||!Array.isArray(values)||values.length<1||values.length>20)throw Error();const ids=values.map(parseListingDraftId);if(new Set(ids).size!==ids.length)throw Error();
   const row=exact(await send(owner,action,{ids},options),['ok']);if(row.ok!==true)throw Error();
  }catch(error){if(error instanceof InboxClientError)throw error;throw new InboxClientError('UNKNOWN');}},
 };
}
export const notificationInbox=createNotificationInboxClient((...args)=>fetch(...args));
