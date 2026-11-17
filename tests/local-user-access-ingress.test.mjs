import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request as send} from 'node:http';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const origin='https://access.example.invalid',actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
const input=JSON.stringify({action:'inspect',expectedAdminId:actor,targetId:target});
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-access-ingress-'));let server;
 try{
  await copyFile(new URL('../docs/review/user-access61/local-user-access-request.mjs.candidate',import.meta.url),join(directory,'ingress.mjs'));
  const {serveLocalUserAccessRequest:serve}=await import(pathToFileURL(join(directory,'ingress.mjs')));let calls=0,lastSignal,onExecute;
  const handler=load('admin-user-access-http').createAdminUserAccessHandler({origin},()=>({limiter:{allowProduction:async()=>true},execute:async(_token,_command,signal)=>{
   calls++;lastSignal=signal;await onExecute?.(signal);return{user:{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'},receipt:null,history:[]};
  }}),()=>{});
  const failures=[];
  server=createServer((req,res)=>serve(req,res,new Headers(req.headers),handler,origin+req.url).catch(error=>{failures.push(error);res.destroy();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=(bytes,extra={},hold=false)=>new Promise((resolve,reject)=>{
   const outgoing=send({host:'127.0.0.1',port:server.address().port,path:'/api/admin/user-access',method:'POST',headers:{host:'access.example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...extra}},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));
   });outgoing.on('error',reject);if(hold)outgoing.write(bytes);else outgoing.end(bytes);
  });
  await run({request,calls:()=>calls,signal:()=>lastSignal,setExecute:fn=>{onExecute=fn;},port:server.address().port});assert.deepEqual(failures,[]);
 }finally{server?.closeAllConnections();if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
}
test('candidate ingress delivers valid JSON plus malformed, oversize and slow boundary errors on real sockets',async()=>fixture(async f=>{
 assert.equal((await f.request(input)).status,200);assert.equal(f.calls(),1);
 for(const [bytes,headers,status,code,hold] of [['{',{},400,'INVALID_JSON'],['x'.repeat(4097),{'transfer-encoding':'chunked'},413,'BODY_TOO_LARGE'],['x',{'content-length':'8000'},413,'BODY_TOO_LARGE',true],['{',{'transfer-encoding':'chunked'},408,'BODY_TIMEOUT',true],[input,{origin:'https://foreign.invalid'},403,'FORBIDDEN_ORIGIN']]){
  const response=await f.request(bytes,headers,hold);assert.equal(response.status,status);assert.equal(response.body.error.code,code);assert.equal(response.headers.connection,'close');
 }
 assert.equal(f.calls(),1);
}));
test('candidate ingress carries disconnect cancellation to an in-flight command',async()=>fixture(async f=>{
 let entered,aborted;const ready=new Promise(resolve=>{entered=resolve;}),stopped=new Promise(resolve=>{aborted=resolve;});
 f.setExecute(signal=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted();resolve();},{once:true});entered();}));
 const req=send({host:'127.0.0.1',port:f.port,path:'/api/admin/user-access',method:'POST',headers:{host:'access.example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+'a'.repeat(64)}});req.on('error',()=>{});req.end(input);
 await ready;req.destroy();await stopped;assert.equal(f.signal().aborted,true);assert.equal(f.calls(),1);
}));
