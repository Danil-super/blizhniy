'use client';
import {parseAdminRefundCommand,parseAdminRefundResult,type AdminRefundCommand} from './admin-refund-contract.ts';
export class AdminRefundClientError extends Error{
 readonly code:string;
 constructor(code:string){super(code==='UNAUTHENTICATED'?'Войдите в аккаунт заново.':code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':code==='INVALID_INPUT'?'Проверьте введённые данные.':'Результат запроса не подтверждён. Проверьте журнал или повторите ту же операцию.');this.code=code;}
}
export function createAdminRefundClient(transport:typeof fetch){return{async call(value:unknown,outer?:AbortSignal){
 let command:AdminRefundCommand;try{command=parseAdminRefundCommand(value);}catch{throw new AdminRefundClientError('INVALID_INPUT');}
 try{
  const deadline=AbortSignal.timeout(90000),signal=outer?AbortSignal.any([deadline,outer]):deadline;signal.throwIfAborted();
  const response=await transport('/api/admin/refunds',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
   headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(command)});
  if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,complete=false;
  try{for(;;){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done){complete=true;text+=decoder.decode();break;}size+=chunk.value.byteLength;if(size>262144)throw Error();text+=decoder.decode(chunk.value,{stream:true});}}
  finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
  const value=JSON.parse(text);if(response.status!==200){const codes:Record<string,number>={UNAUTHENTICATED:401,RATE_LIMITED:429,INVALID_INPUT:422},code=value?.error?.code;
   throw new AdminRefundClientError(typeof code==='string'&&codes[code]===response.status?code:'UNKNOWN');}
  return parseAdminRefundResult(command,value);
 }catch(error){if(error instanceof AdminRefundClientError)throw error;throw new AdminRefundClientError('UNKNOWN');}
}};}
export const adminRefunds=createAdminRefundClient((...args)=>fetch(...args));
