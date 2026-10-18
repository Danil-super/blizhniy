"use client";
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor,type ListingDraftCursor} from './listing-draft-contract.ts';
import {parseApplicationKind} from './application-contract.ts';
import type {ApplicationPage,ApplicationSnapshot,ApplicationSummary,ApplicationProfileSnapshot} from './postgres-applications';
type Options={signal?:AbortSignal};type Mode='applicant'|'recipient';type Decision='viewed'|'selected'|'rejected';
export class ApplicationClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт повторно.':code==='RATE_LIMITED'?'Слишком много запросов. Попробуйте позже.':
  code==='APPLICATION_NOT_FOUND'?'Отклик недоступен. Обновите список.':code==='APPLICATION_BUSY'?'Данные сейчас изменяются. Проверьте отклик и повторите действие.':
  code==='APPLICATION_CHANGED'?'Отклик уже изменился. Проверьте его актуальное состояние.':'Не удалось подтвердить результат. Проверьте отклик перед повторным действием.');this.code=code;}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error();return value as Record<string,unknown>;
}
function text(value:unknown,max:number,multiline=false,empty=false):string{
 if(typeof value!=='string'||!empty&&!value.length||value.length>max||!value.isWellFormed()||
  (multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value))throw Error();return value;
}
const stamp=(id:string,value:unknown)=>parseListingDraftCursor({id,updatedAt:value})!.updatedAt;
function state(row:Record<string,unknown>){
 if(!['applicant','recipient'].includes(row.view as string)||!['pending_payment','paid','sent','viewed','selected','rejected'].includes(row.status as string)||typeof row.paid!=='boolean')throw Error();
 const delivered=['sent','viewed','selected','rejected'].includes(row.status as string);
 if(row.status==='pending_payment'&&row.paid||row.status!=='pending_payment'&&!row.paid||row.view==='recipient'&&!delivered)throw Error();return delivered;
}
function snapshot(value:unknown):ApplicationProfileSnapshot{
 const row=exact(value,['name','profession','price','skills','phone','email','messengerUrl']);
 const price=text(row.price,13);if(!/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(price))throw Error();
 return{name:text(row.name,160),profession:text(row.profession,160),price,skills:text(row.skills,500,true),
  phone:row.phone===null?null:text(row.phone,40),email:row.email===null?null:text(row.email,254),messengerUrl:row.messengerUrl===null?null:text(row.messengerUrl,500)};
}
function detail(value:unknown,id:string):ApplicationSnapshot{
 const row=exact(value,['id','revision','view','target','specialistId','snapshot','message','status','paid','sentAt','createdAt','updatedAt']);
 if(parseListingDraftId(row.id)!==id)throw Error();const delivered=state(row),target=exact(row.target,['id','kind','title']);
 if(delivered?row.sentAt===null:row.sentAt!==null)throw Error();
 return{id,revision:parseListingDraftRevision(row.revision),view:row.view as Mode,target:{id:parseListingDraftId(target.id),kind:parseApplicationKind(target.kind),title:text(target.title,160)},
  specialistId:row.specialistId===null?null:parseListingDraftId(row.specialistId),snapshot:snapshot(row.snapshot),message:text(row.message,3000,true,true),status:row.status as ApplicationSnapshot['status'],paid:row.paid as boolean,
  sentAt:row.sentAt===null?null:stamp(id,row.sentAt),createdAt:stamp(id,row.createdAt),updatedAt:stamp(id,row.updatedAt)};
}
function summary(value:unknown,mode:Mode):ApplicationSummary{
 const row=exact(value,['id','revision','view','status','paid','createdAt','targetId','kind','targetTitle','specialistName']);state(row);if(row.view!==mode)throw Error();const id=parseListingDraftId(row.id);
 return{id,revision:parseListingDraftRevision(row.revision),view:mode,status:row.status as ApplicationSummary['status'],paid:row.paid as boolean,createdAt:stamp(id,row.createdAt),
  targetId:parseListingDraftId(row.targetId),kind:parseApplicationKind(row.kind),targetTitle:text(row.targetTitle,160),specialistName:text(row.specialistName,160)};
}
export function createApplicationsClient(transport:typeof fetch){
 async function send(owner:string,action:'list'|'read'|'decide',input:Record<string,unknown>,options:Options={}):Promise<unknown>{
  try{
   options.signal?.throwIfAborted();const timeout=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;
   const response=await transport('/api/account/applications',{method:action==='decide'?'PUT':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({action,expectedOwnerId:parseListingDraftId(owner),...input})});
   if(!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[],decoder=new TextDecoder('utf-8',{fatal:true});let length=0,complete=false;
   try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}length+=part.value.byteLength;
    if(length>524288||chunks.length>=2048)throw Error();chunks.push(part.value);}}
   finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const value=JSON.parse(decoder.decode(bytes));
   if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,INVALID_INPUT:422,RATE_LIMITED:429,APPLICATION_NOT_FOUND:404,APPLICATION_CHANGED:409,APPLICATION_BUSY:409,SPECIALIST_REQUIRED:409},code=value?.error?.code;
    throw new ApplicationClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');}return value;
  }catch(error){if(error instanceof ApplicationClientError)throw error;throw new ApplicationClientError('UNKNOWN');}
 }
 const checked=async<T>(work:()=>Promise<T>):Promise<T>=>{try{return await work();}catch(error){if(error instanceof ApplicationClientError)throw error;throw new ApplicationClientError('UNKNOWN');}};
 return{
  list:(owner:string,mode:Mode,after:ListingDraftCursor|null,options?:Options):Promise<ApplicationPage>=>checked(async()=>{
   if(mode!=='applicant'&&mode!=='recipient')throw Error();const cursor=parseListingDraftCursor(after),row=exact(await send(owner,'list',{mode,after:cursor},options),['items','nextCursor']);
   if(!Array.isArray(row.items)||row.items.length>20)throw Error();const items=row.items.map(value=>summary(value,mode)),next=parseListingDraftCursor(row.nextCursor);let previous=cursor;
   if(new Set(items.map(item=>item.id)).size!==items.length)throw Error();for(const item of items){const current={id:item.id,updatedAt:item.createdAt};
    if(previous&&!(current.updatedAt<previous.updatedAt||current.updatedAt===previous.updatedAt&&current.id<previous.id))throw Error();previous=current;}
   if(next&&(items.length!==20||next.id!==previous?.id||next.updatedAt!==previous.updatedAt))throw Error();return{items,nextCursor:next};
  }),
  read:(owner:string,value:string,options?:Options):Promise<ApplicationSnapshot>=>checked(async()=>{const id=parseListingDraftId(value);return detail(await send(owner,'read',{applicationId:id},options),id);}),
  decide:(owner:string,value:string,expected:string,state:Decision,options?:Options):Promise<ApplicationSnapshot>=>checked(async()=>{
   if(!['viewed','selected','rejected'].includes(state))throw Error();const id=parseListingDraftId(value),revision=parseListingDraftRevision(expected),result=detail(await send(owner,'decide',{applicationId:id,expectedRevision:revision,state},options),id);
   if(result.view!=='recipient'||result.status!==state||![BigInt(revision),BigInt(revision)+BigInt(1)].includes(BigInt(result.revision)))throw Error();return result;
  }),
 };
}
export const productionApplications=createApplicationsClient((...args)=>fetch(...args));
