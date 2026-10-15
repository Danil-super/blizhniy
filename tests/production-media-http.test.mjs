import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createProductionMediaHandler} from '../src/lib/production-media-http.ts';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai',owner='12345678-1234-4321-8765-123456789abc',id='22345678-1234-4321-8765-123456789abc';
const photo={id,mimeType:'image/webp',width:16,height:9,size:12};
function fixture(changes={}){
 const calls={runtime:0,identity:0,uploads:0,reads:0,bytes:null};
 const state={identity:{resolveSession:async()=>{calls.identity++;return changes.signedOut?null:{id:owner};}},
  limiter:{allowProduction:async()=>!changes.limited},
  upload:{upload:async(token,intent,bytes,mime,signal)=>{calls.uploads++;calls.bytes=bytes;assert.equal(token,'a'.repeat(64));assert.equal(intent,id);assert.equal(mime,'image/jpeg');if(changes.upload) return changes.upload(signal);return photo;}},
  repository:{readOwned:async()=>{calls.reads++;return changes.missing?null:{record:photo,bytes:Buffer.from('524946460400000057454250','hex')};}}};
 return {calls,handle:createProductionMediaHandler({origin},async()=>{calls.runtime++;return state;},()=>{})};
}
function request({body=Buffer.from([1,2]),headers={},method='POST',query=''}={}){
 return new Request(origin+'/api/account/media'+query,{method,headers:{host:new URL(origin).host,origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.1',
  'content-type':'image/jpeg','x-blizhniy-owner':owner,'x-blizhniy-intent':id,cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},
  ...(method==='POST'?{body,...(body instanceof ReadableStream?{duplex:'half'}:{})}:{} )});
}
test('upload authorizes the cookie owner before bounded bytes and returns no path/hash/owner',async()=>{
 const f=fixture(),response=await f.handle(request(),'upload');assert.equal(response.status,200);assert.deepEqual(await response.json(),photo);
 assert.equal(f.calls.identity,1);assert.equal(f.calls.uploads,1);assert.deepEqual(f.calls.bytes,Buffer.from([1,2]));assert.equal(response.headers.get('cache-control'),'no-store');
});
test('invalid ingress/input, Bearer-only and missing cookies never initialize media runtime or consume bytes',async()=>{
 for(const [options,status] of [[{method:'GET'},405],[{headers:{origin:'https://attacker.invalid'}},403],
  [{headers:{host:'attacker.invalid'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],
  [{headers:{cookie:'',authorization:'Bearer old-token'}},401],[{query:'?file=secret'},400],
  [{headers:{'content-type':'image/svg+xml'}},415],[{headers:{'x-blizhniy-intent':'../../etc/passwd'}},422],
  [{headers:{'content-length':String(10*1024*1024+1)}},413]]){
  const f=fixture(),response=await f.handle(request(options),'upload');assert.equal(response.status,status);assert.equal(f.calls.runtime,0);assert.equal(f.calls.uploads,0);
 }
});
test('stale owner, expired identity and shared rate denial do not read image bodies or call decoder',async()=>{
 for(const [change,headers,status] of [[{}, {'x-blizhniy-owner':id},409],[{signedOut:true},{},401],[{limited:true},{},429]]){
  const f=fixture(change),response=await f.handle(request({headers}),'upload');assert.equal(response.status,status);assert.equal(f.calls.uploads,0);
 }
});
test('upload admission rejects a second body while an authorized first upload is unsettled',async()=>{
 let release,started;const waiting=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=fixture({upload:async()=>{started();await gate;return photo;}});
 const first=f.handle(request(),'upload');await waiting;
 try{const other=await f.handle(request(),'upload');assert.equal(other.status,503);assert.equal(f.calls.uploads,1);}
 finally{release();assert.equal((await first).status,200);}
});
test('private read requires the same cookie owner and never returns pending/foreign bytes',async()=>{
 for(const missing of [false,true]){
  const f=fixture({missing}),response=await f.handle(request({body:JSON.stringify({expectedOwnerId:owner,fileId:id}),headers:{'content-type':'application/json'}}),'read');
  assert.equal(response.status,missing?404:200);
  if(!missing){assert.equal(response.headers.get('content-type'),'image/webp');assert.equal((await response.arrayBuffer()).byteLength,12);assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);}
 }
});
test('oversized streams and cancellation never reach decoding; invalid upstream DTO is an unknown server result',async()=>{
 const f=fixture(),body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10*1024*1024+1));controller.close();}});
 assert.equal((await f.handle(request({body}),'upload')).status,413);assert.equal(f.calls.uploads,0);
 const aborted=fixture(),controller=new AbortController();
 const stopped=new Request(request(),{signal:controller.signal});controller.abort();
 assert.equal((await aborted.handle(stopped,'upload')).status,503);assert.equal(aborted.calls.uploads,0);
 const bad=fixture({upload:async()=>({...photo,storagePath:'/private/forbidden'})});
 const response=await bad.handle(request(),'upload');assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:{code:'MEDIA_UNAVAILABLE'}});
});
