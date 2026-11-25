import {hostedUserAccessSocket} from './hosted-user-access-config.ts';
import {request} from 'node:http';
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {AdminUserAccessError,parseAdminUserAccessCommand,parseAdminUserAccessResult} from './admin-user-access-contract.ts';
import {AdminTariffError,parseAdminTariffCommand,parseAdminTariffResult} from './admin-tariff-contract.ts';
import {parseAdminOperatorEnvelope,parseAdminOperatorResult,adminOperatorErrorStatus,adminOperatorError} from './admin-operator-contract.ts';
/** Owned Unix IPC only; timeout never retries a mutation. Recover its original operation ID. */
async function callAdminOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal,hosted=false){
  try{
    const envelope=parseAdminOperatorEnvelope({token,command:value}),body=JSON.stringify(envelope);
    if(Buffer.byteLength(body)>4096||typeof process.getuid!=='function')throw Error();
    if(hosted ? socketPath!==hostedUserAccessSocket :
      !isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100||basename(socketPath)!=='operator.sock'||
      !/^blizhniy-user-operator-[a-zA-Z0-9]+$/.test(basename(dirname(socketPath)))||
      dirname(dirname(socketPath))!==tmpdir())throw Error();
    signal?.throwIfAborted();const [parent,socket]=await Promise.all([lstat(dirname(socketPath)),lstat(socketPath)]);
    const owner=hosted?0:process.getuid(),modeMask=hosted?0o7777:0o777;
    if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==owner||(parent.mode&modeMask)!==(hosted?0o755:0o700)||
      !socket.isSocket()||socket.uid!==owner||(socket.mode&modeMask)!==(hosted?0o660:0o600)||
      await realpath(dirname(socketPath))!==dirname(socketPath)||socketPath!==join(dirname(socketPath),'operator.sock'))throw Error();
    if(hosted){
      const root=await lstat('/run');
      if(!root.isDirectory()||root.uid!==0||(root.mode&0o022)!==0||process.getuid()===0||socket.nlink!==1||socket.gid!==process.getgid?.())throw Error();
    }
    const timeout=AbortSignal.timeout(20000),abort=signal?AbortSignal.any([timeout,signal]):timeout;abort.throwIfAborted();
    const payload=await new Promise<unknown>((resolve,reject)=>{
      const outgoing=request({socketPath,hostname:'user-operator.invalid',path:'/command',method:'POST',agent:false,signal:abort,
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},incoming=>{
        let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
        incoming.on('data',(chunk:Buffer)=>{try{size+=chunk.length;if(size>65536)throw Error();text+=decoder.decode(chunk,{stream:true});}catch{incoming.destroy();reject(Error());}});
        incoming.on('error',reject);incoming.on('aborted',()=>reject(Error()));incoming.on('end',()=>{try{
          if(incoming.headers['content-type']!=='application/json')throw Error();const result=JSON.parse(text+decoder.decode());
          if(incoming.statusCode!==200){
            const code=result?.error?.code;
            if(typeof code==='string'&&Object.hasOwn(adminOperatorErrorStatus,code)&&adminOperatorErrorStatus[code as keyof typeof adminOperatorErrorStatus]===incoming.statusCode&&
              Object.keys(result).join()==='error'&&Object.keys(result.error).join()==='code')throw adminOperatorError(envelope.command,code);
            throw Error();
          }
          resolve(result);
        }catch(error){reject(error);}});
      });outgoing.on('error',reject);outgoing.end(body);
    });return parseAdminOperatorResult(envelope.command,payload);
  }catch(error){if(error instanceof AdminUserAccessError||error instanceof AdminTariffError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}

export async function callLocalUserAccessOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 try{const command=parseAdminUserAccessCommand(value);return parseAdminUserAccessResult(command,await callAdminOperator(socketPath,token,command,signal));}
 catch(error){if(error instanceof AdminUserAccessError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}
export async function callLocalTariffOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 try{const command=parseAdminTariffCommand(value);return parseAdminTariffResult(command,await callAdminOperator(socketPath,token,command,signal));}
 catch(error){if(error instanceof AdminTariffError)throw error;throw new AdminTariffError('TARIFF_UNAVAILABLE');}
}

export async function callHostedUserAccessOperator(token:string,value:unknown,signal?:AbortSignal){
 try{const command=parseAdminUserAccessCommand(value);
  return parseAdminUserAccessResult(command,await callAdminOperator(hostedUserAccessSocket,token,command,signal,true));
 }catch(error){if(error instanceof AdminUserAccessError)throw error;throw new AdminUserAccessError('ACCESS_UNAVAILABLE');}
}
