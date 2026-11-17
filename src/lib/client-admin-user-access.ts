"use client";
import {AdminUserAccessError,parseAdminUserAccessCommand,parseAdminUserAccessResult,userAccessErrorStatus,type UserAccessErrorCode} from './admin-user-access-contract.ts';
export function createAdminUserAccessClient(transport:typeof fetch){
  return {async execute(input:unknown,options:{signal?:AbortSignal}={}){
    try{
      const command=parseAdminUserAccessCommand(input),timeout=AbortSignal.timeout(25000);
      const signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
      const response=await transport('/api/admin/user-access',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
        headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(command)});
      if(!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error();
      const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0,complete=false;
      try{for(;;){
        signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}
        size+=part.value.byteLength;if(size>65536||parts.length>=1024)throw Error();parts.push(part.value);
      }}finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(response.status!==200){
        const code=value?.error?.code;if(response.status===401&&code==='UNAUTHENTICATED')throw new AdminUserAccessError('ADMIN_REQUIRED');
        if(typeof code==='string'&&Object.hasOwn(userAccessErrorStatus,code)&&userAccessErrorStatus[code as UserAccessErrorCode]===response.status)throw new AdminUserAccessError(code as UserAccessErrorCode);
        throw Error();
      }
      return parseAdminUserAccessResult(command,value);
    }catch(error){if(error instanceof AdminUserAccessError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
  }};
}
export const adminUserAccess=createAdminUserAccessClient((...args)=>fetch(...args));
