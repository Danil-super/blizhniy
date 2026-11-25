import {hostedRefundOperatorSocket} from './local-refund-admin-config.ts';
import {request} from 'node:http';
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {AdminRefundRejectedError,parseAdminRefundCommand,parseAdminRefundResult} from './admin-refund-contract.ts';
import {hashSessionToken} from './identity';
/** No network host/redirect/retry. A timeout may hide a committed action; reuse its original ID explicitly. */
async function callRefundOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal,shopId?:string,hosted=false){
 try{
  const command=parseAdminRefundCommand(value);if(!hashSessionToken(token))throw Error();
  if(shopId!==undefined&&!/^[a-zA-Z0-9_-]{1,64}$/.test(shopId))throw Error();
  const body=JSON.stringify({token,command,...(shopId===undefined?{}:{shopId})});if(Buffer.byteLength(body)>4096)throw Error();
  if(typeof process.getuid!=='function')throw Error();
  if(!hosted&&(!isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100||basename(socketPath)!=='operator.sock'||
   !/^blizhniy-refund-operator-[a-zA-Z0-9]+$/.test(basename(dirname(socketPath)))||dirname(dirname(socketPath))!==tmpdir()))throw Error();
  signal?.throwIfAborted();const [parent,socket]=await Promise.all([lstat(dirname(socketPath)),lstat(socketPath)]);
  const owner=hosted?0:process.getuid(),modeMask=hosted?0o7777:0o777;
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==owner||(parent.mode&modeMask)!==(hosted?0o755:0o700)||
   !socket.isSocket()||socket.uid!==owner||(socket.mode&modeMask)!==(hosted?0o660:0o600)||await realpath(dirname(socketPath))!==dirname(socketPath)||socketPath!==join(dirname(socketPath),'operator.sock'))throw Error();
  if(hosted){
   const root=await lstat('/run');
   if(!root.isDirectory()||root.uid!==0||(root.mode&0o022)!==0||process.getuid()===0||socket.nlink!==1||socket.gid!==process.getgid?.())throw Error();
  }
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

export function callLocalRefundOperator(socketPath:string,token:string,value:unknown,signal?:AbortSignal,shopId?:string){
 return callRefundOperator(socketPath,token,value,signal,shopId);
}

export function callHostedRefundOperator(token:string,value:unknown,shopId:string,signal?:AbortSignal){
 return callRefundOperator(hostedRefundOperatorSocket,token,value,signal,shopId,true);
}
