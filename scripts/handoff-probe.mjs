import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {boundedHandoffRequest} from './handoff-http.mjs';
import {webSlot} from './rolling-web-handoff.mjs';

const identityReader = fileURLToPath(new URL('./read-next-html-identity.cjs', import.meta.url));
function postgresBuildId(body, deadline) {
  const timeout = Math.ceil(deadline - performance.now());
  if (timeout <= 0) return null;
  // Parsing shares the probe deadline and has its own heap, separate from the operator process.
  return execFileSync(process.execPath, ['--max-old-space-size=96', identityReader], {
    input: body, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 256,
    stdio: ['pipe','pipe','ignore'], env: {NODE_PATH: process.env.NODE_PATH ?? ''},
  });
}

/** Read-only readiness + application/build check, sharing one overall deadline. */
export async function probeWebSlot(input,{deadlineMs=10000}={}){
 const slot=webSlot(input);
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>30000)throw new Error('Invalid probe deadline');
 const end=performance.now()+deadlineMs;
 const read=async(path,maxBytes)=>{
  const remaining=Math.ceil(end-performance.now());if(remaining<=0)throw new Error('Probe expired');
  const response=await boundedHandoffRequest({hostname:'127.0.0.1',port:slot.port,path},{deadlineMs:remaining,maxBytes});
  if(response.status!==200)throw new Error('Probe unavailable');return response;
 };
 try{
  if(JSON.parse((await read('/api/health',1024)).body.toString()).ok!==true)return {ready:false,buildId:slot.buildId};
  const ready=JSON.parse((await read('/api/ready',1024)).body.toString());
  if(ready.ok!==true||ready.service!=='blizhniy')return {ready:false,buildId:slot.buildId};
  const page=await read('/',4*1024*1024);
  if(!String(page.headers['content-type']).startsWith('text/html')||postgresBuildId(page.body,end)!==slot.buildId)return {ready:false,buildId:slot.buildId};
  const manifest=await read(`/_next/static/${slot.buildId}/_buildManifest.js`,1024*1024);
  if(!/^(?:application|text)\/javascript/.test(String(manifest.headers['content-type']))||!manifest.body.includes(Buffer.from('__BUILD_MANIFEST')))return {ready:false,buildId:slot.buildId};
  return {ready:true,buildId:slot.buildId};
 }catch{return {ready:false,buildId:slot.buildId};}
}
