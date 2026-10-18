import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as http from '../src/lib/auth-http.ts';
import {workPublicationModule} from './work-publication-module.mjs';

function setup({enabled=true,failed=false}={}){
 const calls=[];const db={query:async(sql)=>{calls.push(sql);if(failed)throw Error('Synthetic secret database failure');}},limiter={};
 class Store{constructor(value){assert.equal(value,db);calls.push('store');}}
 const {handleProductionWorkPublicationRequest}=workPublicationModule('production-work-publication-runtime',{
  './auth-http':http,'./production-auth-config':{readProductionAuthConfig:()=>enabled?{origin:'https://synthetic.invalid'}:null},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>({db,limiter})},
  './postgres-work-publications':{PostgresWorkPublicationStore:Store},
  './production-work-publication-http':{createProductionWorkPublicationHandler:(config,getRuntime)=>async request=>{
   assert.equal(config.origin,'https://synthetic.invalid');assert.equal(request.method,'PUT');
   const runtime=await getRuntime();assert.ok(runtime.store instanceof Store);assert.equal(runtime.limiter,limiter);return http.authJson({ok:true},200);
  }},
 });return{calls,handle:()=>handleProductionWorkPublicationRequest(new Request('https://synthetic.invalid/api/account/work-publications',{method:'PUT'}))};
}
test('work runtime uses only the existing verified account database and probes new schema before constructing storage',async()=>{
 const f=setup(),response=await f.handle();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(f.calls.length,3);assert.match(f.calls[0],/app\.work_publications.*limit 0/);assert.match(f.calls[1],/app\.work_publication_photos.*limit 0/);assert.equal(f.calls[2],'store');
});
test('work runtime cannot enable an absent primary account config or reveal a failed schema probe',async()=>{
 for(const options of [{enabled:false},{failed:true}]){const f=setup(options),response=await f.handle();
  assert.equal(response.status,options.enabled===false?404:503);assert.deepEqual(await response.json(),{error:{code:options.enabled===false?'NOT_FOUND':'WORK_PUBLICATIONS_UNAVAILABLE'}});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(f.calls.includes('store'),false);
 }
});
