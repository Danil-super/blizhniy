'use client';
import {parseListingDraftId,parseListingDraftRevision,parseListingDraftCursor} from './listing-draft-contract.ts';
import {parseWorkOwnerAction,type WorkOwnerAction} from './work-owner-actions-contract.ts';
import type {WorkOwnerActionResult} from './postgres-work-owner-actions';
const messages={UNAUTHENTICATED:'Войдите в аккаунт.',PUBLICATION_NOT_FOUND:'Публикация недоступна.',PUBLICATION_CHANGED:'Публикация изменилась или её нельзя восстановить. Обновите страницу.',
 RESPONSE_PAYMENT_PENDING:'Сейчас завершается оплата отклика. Дождитесь её результата и повторите действие.',ACTION_BUSY:'Публикация сейчас обновляется. Повторите действие.',
 PHONE_REQUIRED:'Для восстановления подтвердите телефон в настройках.',INVALID_INPUT:'Проверьте причину действия.',RATE_LIMITED:'Слишком много запросов. Попробуйте позже.',UNKNOWN:'Результат пока неизвестен. Повторите проверку той же операции.'};
export class WorkOwnerActionClientError extends Error{constructor(readonly code:keyof typeof messages){super(messages[code]);this.name='WorkOwnerActionClientError';}}
export function createWorkOwnerActionsClient(transport:typeof fetch){return{async change(owner:string,value:WorkOwnerAction):Promise<WorkOwnerActionResult>{
 let expectedOwnerId:string,input:WorkOwnerAction;
 try{expectedOwnerId=parseListingDraftId(owner);input=parseWorkOwnerAction(value);}catch{throw new WorkOwnerActionClientError('INVALID_INPUT');}
 try{
  const signal=AbortSignal.timeout(10000);
  const response=await transport('/api/account/work-actions',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify({...input,expectedOwnerId})});
  if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;text+=decoder.decode();break;}size+=part.value.byteLength;if(size>8192)throw Error();text+=decoder.decode(part.value,{stream:true});}}
  finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const row=JSON.parse(text);
  if(response.status!==200){const statuses:Record<string,number>={UNAUTHENTICATED:401,PUBLICATION_NOT_FOUND:404,PUBLICATION_CHANGED:409,RESPONSE_PAYMENT_PENDING:409,ACTION_BUSY:409,PHONE_REQUIRED:403,INVALID_INPUT:422,RATE_LIMITED:429};
   const code=row?.error?.code;if(Object.hasOwn(statuses,code)&&statuses[code]===response.status)throw new WorkOwnerActionClientError(code);throw Error();}
  const keys=['operationId','publicationId','ownerId','kind','expectedRevision','action','reason','resultingRevision','status','occurredAt'];
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw Error();
  const bound=parseWorkOwnerAction({operationId:row.operationId,publicationId:row.publicationId,kind:row.kind,expectedRevision:row.expectedRevision,action:row.action,reason:row.reason});
  if(JSON.stringify(bound)!==JSON.stringify(input)||row.ownerId!==expectedOwnerId||BigInt(parseListingDraftRevision(row.resultingRevision))!==BigInt(input.expectedRevision)+BigInt(1)||row.status!==(input.action==='restore'?'published':'archived'))throw Error();
  parseListingDraftCursor({id:input.operationId,updatedAt:row.occurredAt});return row;
 }catch(error){if(error instanceof WorkOwnerActionClientError)throw error;throw new WorkOwnerActionClientError('UNKNOWN');}
}};}
export const workOwnerActions=createWorkOwnerActionsClient((...args)=>fetch(...args));
