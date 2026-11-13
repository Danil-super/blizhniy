import {request} from 'node:http';
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {AdminRefundRejectedError,parseAdminRefundCommand,parseAdminRefundResult} from './admin-refund-contract.ts';
import {hashSessionToken} from './identity';
/** No network host/redirect/retry. A timeout may hide a committed action; reuse its original ID explicitly. */
export async function callLocalRefundOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal){
 try{
  const command=parseAdminRefundCommand(value);if(!hashSessionToken(token))throw Error();
  const body=JSON.stringify({token,command});if(Buffer.byteLength(body)>4096)throw Error();
  if(typeof process.getuid!=='function'||!isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100||basename(socketPath)!=='operator.sock'||
   !/^blizhniy-refund-operator-[a-zA-Z0-9]+$/.test(basename(dirname(socketPath)))||dirname(dirname(socketPath))!==tmpdir())throw Error();
  signal?.throwIfAborted();const [parent,socket]=await Promise.all([lstat(dirname(socketPath)),lstat(socketPath)]);
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700||
   !socket.isSocket()||socket.uid!==process.getuid()||(socket.mode&0o777)!==0o600||await realpath(dirname(socketPath))!==dirname(socketPath)||socketPath!==join(dirname(socketPath),'operator.sock'))throw Error();
  const deadline=AbortSignal.timeout(80000),abort=signal?AbortSignal.any([deadline,signal]):deadline;abort.throwIfAborted();
  const payload=await new Promise<unknown>((resolve,reject)=>{
   const outgoing=request({socketPath,hostname:'refund-operator.invalid',path:'/command',method:'POST',agent:false,signal:abort,
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},incoming=>{
    let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
    incoming.on('data',(chunk:Buffer)=>{try{size+=chunk.length;if(size>262144)throw Error();text+=decoder.decode(chunk,{stream:true});}catch{incoming.destroy();reject(Error());}});
    incoming.on('error',reject);incoming.on('aborted',()=>reject(Error()));
    incoming.on('end',()=>{try{
     if(incoming.headers['content-type']!=='application/json')throw Error();const value=JSON.parse(text+decoder.decode());
     if(command.action==='approve'&&incoming.statusCode===409&&value?.error?.code==='REFUND_NOT_LATEST'&&Object.keys(value).join()==='error'&&Object.keys(value.error).join()==='code')throw new AdminRefundRejectedError();
     if(incoming.statusCode!==200)throw Error();resolve(value);
    }catch(error){reject(error instanceof AdminRefundRejectedError?error:Error());}});
   });outgoing.on('error',reject);outgoing.end(body);
  });return parseAdminRefundResult(command,payload);
 }catch(error){if(error instanceof AdminRefundRejectedError)throw error;throw Error('Local refund operator unavailable');}
}
