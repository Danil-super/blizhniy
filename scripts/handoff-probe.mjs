import {boundedHandoffRequest} from './handoff-http.mjs';
import {webSlot} from './rolling-web-handoff.mjs';

// Next 15 App Router initial Flight record. Parse data, never execute scripts.
// A changed wire format fails closed and requires a reviewed probe update.
function htmlBuildId(body){
 const chunks=[];
 for(const script of body.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
  const chunk=/^self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\);?$/.exec(script[1]);
  if(chunk)chunks.push(JSON.parse(chunk[1]));
 }
 const records=chunks.join('').split('\n').filter(line=>line.startsWith('0:'));
 if(records.length!==1)return null;
 return JSON.parse(records[0].slice(2)).b;
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
  if(!String(page.headers['content-type']).startsWith('text/html')||!page.body.includes(Buffer.from('name="blizhniy-auth-backend" content="postgres"'))||htmlBuildId(page.body)!==slot.buildId)return {ready:false,buildId:slot.buildId};
  const manifest=await read(`/_next/static/${slot.buildId}/_buildManifest.js`,1024*1024);
  if(!/^(?:application|text)\/javascript/.test(String(manifest.headers['content-type']))||!manifest.body.includes(Buffer.from('__BUILD_MANIFEST')))return {ready:false,buildId:slot.buildId};
  return {ready:true,buildId:slot.buildId};
 }catch{return {ready:false,buildId:slot.buildId};}
}
