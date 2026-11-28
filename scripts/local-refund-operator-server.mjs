import {createServer} from 'node:http';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),unavailable=()=>Error('Local refund operator unavailable');
const compiledCommands=runtime=>require('../compiled/lib/admin-refund-commands.js').createAdminRefundCommands(runtime);
/** Explicit private IPC only. The caller supplies the TEST runtime and any verified activation; import never starts it. */
export async function startLocalRefundOperatorServer(runtime,{createCommands=compiledCommands,activation}={}){
 let directory,server,closing,closed=false,resolveDone;
 const done=new Promise(resolve=>{resolveDone=resolve;});
 try{
  if(typeof process.getuid!=='function'||typeof window!=='undefined')throw unavailable();
  const commands=createCommands(runtime);
  const requestLimit=runtime.passkey?33_792:4096;
  if(!activation){directory=await mkdtemp(join(tmpdir(),'blizhniy-refund-operator-'));await chmod(directory,0o700);}
  const socketPath=activation?.socketPath??join(directory,'operator.sock');if(Buffer.byteLength(socketPath)>100)throw unavailable();
  server=createServer({maxHeaderSize:4096,requestTimeout:3000,headersTimeout:3000},async(req,res)=>{
   const reply=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.end(body);};
   const lifetime=setTimeout(()=>res.destroy(),75000);let bodyTimer,approval=false;
   try{
    if(closed||req.method!=='POST'||req.url!=='/command'||req.headers.host!=='refund-operator.invalid'||req.headers.origin||req.headers['content-type']!=='application/json'||
     req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>requestLimit))throw unavailable();
    bodyTimer=setTimeout(()=>req.destroy(),2000);let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
    for await(const chunk of req){size+=chunk.length;if(size>requestLimit)throw unavailable();text+=decoder.decode(chunk,{stream:true});}
    clearTimeout(bodyTimer);text+=decoder.decode();if(closed||req.aborted||res.destroyed)throw unavailable();
    const envelope=JSON.parse(text);approval=envelope?.command?.action==='approve';
    const result=await commands(envelope),body=JSON.stringify(result);if(Buffer.byteLength(body)>262144)throw unavailable();
    reply(200,body);
   }catch(error){
    if(approval&&error?.code==='REFUND_NOT_LATEST')reply(409,'{"error":{"code":"REFUND_NOT_LATEST"}}');
    else if(runtime.passkey&&error?.code==='PASSKEY_REQUIRED')reply(403,'{"error":{"code":"PASSKEY_REQUIRED"}}');
    else reply(503,'{"error":{"code":"REFUND_OPERATOR_UNAVAILABLE"}}');
   }
   finally{clearTimeout(bodyTimer);clearTimeout(lifetime);}
  });
  server.maxConnections=8;server.timeout=80000;server.on('timeout',socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(activation?{fd:activation.fd}:socketPath,()=>{server.removeListener('error',reject);resolve();});});
  server.on('error',()=>{closed=true;resolveDone(1);});server.once('close',()=>resolveDone(0));
  if(directory)await chmod(socketPath,0o600);
  return{socketPath,done,close:()=>closing??=(async()=>{
   closed=true;let failed=false;
   try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch{failed=true;}
   try{await runtime.close();}catch{failed=true;}
   try{if(directory)await rm(directory,{recursive:true,force:true});}catch{failed=true;}
   if(failed)throw unavailable();
  })()};
 }catch{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  if(directory){try{await rm(directory,{recursive:true,force:true});}catch{ /* Preserve the redacted startup error. */ }}
  throw unavailable();
 }
}
