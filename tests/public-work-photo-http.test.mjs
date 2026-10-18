import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as http from '../src/lib/auth-http.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as ids from '../src/lib/listing-draft-contract.ts';
const ts=createRequire(import.meta.url)('typescript');
const id='10000000-0000-4000-8000-000000000001',file='10000000-0000-4000-8000-000000000002',origin='https://example.invalid';
function fixture(){
 const admission={reads:0},events=[],exports={},deps={'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,
  './trusted-proxy-ip':proxy,'./listing-draft-contract.ts':ids,'./production-media-http':{productionMediaAdmission:admission}};
 new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/production-public-work-photo-http.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},exports);
 const access={record:{id:file,mimeType:'image/webp',width:2,height:2,size:12,sha256:'b'.repeat(64)},revision:'2',expiresAt:'2099-01-01T00:00:00.000001Z'};
 let lookups=0,reads=0,available=true,onRead=()=>{},result=Buffer.alloc(12);
 const handler=exports.createProductionPublicWorkPhotoHandler({origin},()=>({store:{photoRecord:async(publication,media)=>{
  assert.equal(publication,id);assert.equal(media,file);lookups++;return available?access:undefined;}},files:{read:async record=>{reads++;assert.deepEqual(record,access.record);onRead();return result;}}}),event=>events.push(event));
 const request=(path=`/api/work-publications/${id}/photos/${file}`,headers={},method='GET')=>new Request(origin+path,{method,headers:{host:'example.invalid','x-real-ip':'127.0.0.1',...headers}});
 return{handler,request,access,admission,events,counts:()=>({lookups,reads}),hide:()=>available=false,onRead:fn=>onRead=fn,bytes:value=>result=value};
}
test('public work photo authorizes before filesystem and rechecks before returning bounded no-store bytes without a session',async()=>{
 const f=fixture(),response=await f.handler(f.request(),id,file);assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,12);
 assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(f.counts(),{lookups:2,reads:1});assert.equal(f.admission.reads,0);
 assert.equal(JSON.stringify(f.events).includes(id),false);assert.equal(JSON.stringify(f.events).includes(file),false);
});
test('public photo never touches private files without exact live authorization, including withdrawal during the read',async()=>{
 const f=fixture();f.hide();assert.equal((await f.handler(f.request(),id,file)).status,404);assert.deepEqual(f.counts(),{lookups:1,reads:0});
 const withdrawn=fixture();withdrawn.onRead(withdrawn.hide);assert.equal((await withdrawn.handler(withdrawn.request(),id,file)).status,404);
 const revised=fixture();revised.onRead(()=>revised.access.revision='3');assert.equal((await revised.handler(revised.request(),id,file)).status,404);
 const expired=fixture();expired.onRead(()=>expired.access.expiresAt='2000-01-01T00:00:00.000001Z');assert.equal((await expired.handler(expired.request(),id,file)).status,404);
});
test('public photo rejects malformed boundaries before SQL, shares the existing image cap and releases its slot on failures',async()=>{
 for(const mutate of [f=>f.request(undefined,{},'POST'),f=>f.request('/?extra=1'),f=>f.request(undefined,{host:'other.invalid'}),f=>f.request(undefined,{'x-real-ip':'invalid'})]){
  const f=fixture();assert.notEqual((await f.handler(mutate(f),id,file)).status,200);assert.deepEqual(f.counts(),{lookups:0,reads:0});}
 const invalid=fixture();assert.equal((await invalid.handler(invalid.request(),'../private',file)).status,404);assert.equal(invalid.counts().reads,0);
 const busy=fixture();busy.admission.reads=4;const full=await busy.handler(busy.request(),id,file);assert.equal(full.status,503);assert.equal(full.headers.get('retry-after'),'1');assert.equal(busy.admission.reads,4);assert.equal(busy.counts().reads,0);
 const bad=fixture();bad.bytes(Buffer.alloc(13));assert.equal((await bad.handler(bad.request(),id,file)).status,503);assert.equal(bad.admission.reads,0);
 const failed=fixture();failed.onRead(()=>{throw Error('private path /secret');});const response=await failed.handler(failed.request(),id,file);assert.equal(response.status,503);assert.equal((await response.text()).includes('/secret'),false);assert.equal(failed.admission.reads,0);
});
