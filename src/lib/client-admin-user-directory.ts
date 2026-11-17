"use client";
import {parseAdminUserQuery,parseAdminUserPage,type AdminUserQuery} from './admin-user-directory-contract.ts';

export class AdminUserDirectoryClientError extends Error {
  readonly code:string;
  constructor(code:string) {
    super(code==='ADMIN_REQUIRED'||code==='UNAUTHENTICATED'?'Доступ администратора не подтверждён. Войдите заново.':
      code==='RATE_LIMITED'?'Слишком много запросов. Повторите позже.':'Не удалось загрузить пользователей. Проверьте соединение и повторите.');
    this.code=code;
  }
}
export function createAdminUserDirectoryClient(transport:typeof fetch) {
  return {async list(input:AdminUserQuery,options:{signal?:AbortSignal}={}) {
    try {
      const query=parseAdminUserQuery(input),timeout=AbortSignal.timeout(15000);
      const signal=options.signal?AbortSignal.any([timeout,options.signal]):timeout;signal.throwIfAborted();
      const response=await transport('/api/admin/user-directory',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
        headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(query)});
      if(!response.body)throw Error();
      const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0,complete=false;
      try {for(;;){
        signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();
        if(part.done){complete=true;break;}size+=part.value.byteLength;
        if(size>65536||parts.length>=1024)throw Error();parts.push(part.value);
      }} finally {try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
      const bytes=new Uint8Array(size);let offset=0;
      for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(response.status!==200){
        const codes:Record<string,number>={ADMIN_REQUIRED:403,UNAUTHENTICATED:401,RATE_LIMITED:429};
        const code=value?.error?.code;
        throw new AdminUserDirectoryClientError(typeof code==='string'&&Object.hasOwn(codes,code)&&codes[code]===response.status?code:'UNKNOWN');
      }
      return parseAdminUserPage(value);
    } catch(error){if(error instanceof AdminUserDirectoryClientError)throw error;throw new AdminUserDirectoryClientError('UNKNOWN');}
  }};
}
export const adminUserDirectory=createAdminUserDirectoryClient((...args)=>fetch(...args));
