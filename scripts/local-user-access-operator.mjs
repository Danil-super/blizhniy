import {createServer} from 'node:http';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseUserAccessEnvelope,parseAdminUserAccessResult,userAccessErrorStatus} from '../src/lib/admin-user-access-contract.ts';
/** Explicit owned runtime only. Import never connects, installs a role or starts a listener. */
export async function startLocalUserAccessOperator(runtime,{parseEnvelope=parseUserAccessEnvelope,parseResult=parseAdminUserAccessResult,errorStatus=userAccessErrorStatus,activation}={}){
  let directory,server,closed=false,closing,resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const unavailable=()=>Error('User access operator unavailable');
  try{
    if(typeof process.getuid!=='function'||typeof runtime?.execute!=='function'||typeof runtime?.close!=='function')throw unavailable();
    if(!activation){directory=await mkdtemp(join(tmpdir(),'blizhniy-user-operator-'));await chmod(directory,0o700);}
    const socketPath=activation?.socketPath??join(directory,'operator.sock');if(Buffer.byteLength(socketPath)>100)throw unavailable();
    server=createServer({maxHeaderSize:4096,requestTimeout:3000,headersTimeout:3000},async(req,res)=>{
      const reply=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.end(body);};
      const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);req.once('aborted',abort);
      const lifetime=setTimeout(()=>{abort();res.destroy();},15000);let bodyTimer;
      try{
        if(closed||req.method!=='POST'||req.url!=='/command'||req.headers.host!=='user-operator.invalid'||req.headers.origin||req.headers['content-type']!=='application/json'||
          req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>4096))throw unavailable();
        bodyTimer=setTimeout(()=>req.destroy(),2000);let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
        for await(const chunk of req){size+=chunk.length;if(size>4096)throw unavailable();text+=decoder.decode(chunk,{stream:true});}
        clearTimeout(bodyTimer);text+=decoder.decode();if(closed||req.aborted||res.destroyed)throw unavailable();
        const {token,command}=parseEnvelope(JSON.parse(text));
        const result=parseResult(command,await runtime.execute(token,command,controller.signal)),body=JSON.stringify(result);
        if(Buffer.byteLength(body)>65536)throw unavailable();reply(200,body);
      }catch(error){
        const code=typeof error?.code==='string'&&Object.hasOwn(errorStatus,error.code)?error.code:'ACCESS_UNAVAILABLE';
        reply(errorStatus[code],JSON.stringify({error:{code}}));
      }finally{clearTimeout(bodyTimer);clearTimeout(lifetime);res.removeListener('close',abort);req.removeListener('aborted',abort);}
    });
    server.maxConnections=8;server.timeout=16000;server.on('timeout',socket=>socket.destroy());server.on('clientError',(_error,socket)=>socket.destroy());
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(activation?{fd:activation.fd}:socketPath,()=>{server.removeListener('error',reject);resolve();});});
    server.on('error',()=>{closed=true;resolveDone(1);});server.once('close',()=>resolveDone(0));if(directory)await chmod(socketPath,0o600);
    return {socketPath,done,close:()=>closing??=(async()=>{
      closed=true;let failed=false;
      try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch{failed=true;}
      try{await runtime.close();}catch{failed=true;}
      try{if(directory)await rm(directory,{recursive:true,force:true});}catch{failed=true;}
      if(failed)throw unavailable();
    })()};
  }catch{
    resolveDone(1);
    if(server?.listening)await Promise.allSettled([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))]);
    if(typeof runtime?.close==='function')await Promise.allSettled([Promise.resolve().then(()=>runtime.close())]);
    if(directory)await Promise.allSettled([rm(directory,{recursive:true,force:true})]);
    throw unavailable();
  }
}
