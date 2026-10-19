import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import {formModule} from './listing-form-module.mjs';
const id='10000000-0000-4000-8000-000000000001',file='10000000-0000-4000-8000-000000000002',origin='https://example.invalid';
function fixture({enabled=true,failed=false}={}){
 const admission={reads:0},db={},counts={database:0,lookups:0,reader:0,reads:0};let live=true,onRead=()=>{};
 const access={record:{id:file,mimeType:'image/webp',width:2,height:2,size:12,sha256:'b'.repeat(64)},revision:'1',expiresAt:'2099-01-01T00:00:00.000001Z'};
 const policy=formModule('production-public-work-photo-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./trusted-proxy-ip':proxy,'./production-media-http':{productionMediaAdmission:admission}});
 class Store{constructor(value){assert.equal(value,db);}async photoRecord(listing,media){counts.lookups++;assert.equal(listing,id);assert.equal(media,file);return live?access:undefined;}}
 const runtime=formModule('production-public-listing-runtime',{'server-only':{},'./auth-http':http,
  './production-auth-config':{readProductionAuthConfig:()=>enabled?{origin}:null},'./production-auth-runtime':{getProductionAccountDatabase:async()=>{counts.database++;if(failed)throw Error('Synthetic private database error');return{db};}},
  './postgres-public-listings':{PostgresPublicListingStore:Store},'./production-public-work-photo-http':policy,
  './production-media-runtime':{getProductionMediaFileReader:()=>{counts.reader++;return{read:async record=>{counts.reads++;assert.deepEqual(record,access.record);onRead();return Buffer.alloc(12);}};}},
 });
 const request=(headers={})=>new Request(`${origin}/api/listings/${id}/photos/${file}`,{headers:{host:'example.invalid','x-real-ip':'127.0.0.1',...headers}});
 return{runtime,counts,admission,request,hide:()=>live=false,onRead:fn=>onRead=fn,handle:headers=>runtime.handleProductionPublicListingPhoto(request(headers),id,file)};
}
test('ordinary public runtime uses only the restricted primary pool and serves SQL-authorized bounded no-store photos without a session',async()=>{
 const f=fixture();await f.runtime.getProductionPublicListingStore();assert.equal(f.counts.database,1);const response=await f.handle();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.arrayBuffer()).byteLength,12);
 assert.deepEqual(f.counts,{database:2,lookups:2,reader:1,reads:1});assert.equal(f.admission.reads,0);
});
test('ordinary photo runtime never opens the private reader for inaccessible or malformed targets and rechecks withdrawal after the file read',async()=>{
 const hidden=fixture();hidden.hide();assert.equal((await hidden.handle()).status,404);assert.equal(hidden.counts.reader,0);
 const withdrawn=fixture();withdrawn.onRead(withdrawn.hide);assert.equal((await withdrawn.handle()).status,404);assert.equal(withdrawn.counts.reads,1);assert.equal(withdrawn.admission.reads,0);
 const target=fixture();assert.equal((await target.handle({host:'other.invalid'})).status,403);assert.deepEqual(target.counts,{database:0,lookups:0,reader:0,reads:0});
});
test('ordinary public runtime rejects disabled primary configuration and hides database errors without legacy access or file reads',async()=>{
 for(const options of [{enabled:false},{failed:true}]){const f=fixture(options);await assert.rejects(f.runtime.getProductionPublicListingStore());const response=await f.handle();assert.equal(response.status,options.enabled===false?404:503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.text()).includes('private database'),false);assert.equal(f.counts.reader,0);}
});
