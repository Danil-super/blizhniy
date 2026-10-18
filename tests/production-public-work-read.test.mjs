import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function fixture(chosen,failed=false){
 const name=chosen==='vacancy'?'Vacancy':'WorkRequest',plural=chosen==='vacancy'?'Vacancies':'WorkRequests';
 const source=readFileSync(new URL(`../src/lib/${chosen==='vacancy'?'vacancy':'work-request'}-store.ts`,import.meta.url),'utf8');
 const pick=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return source.slice(from,to);};
 const selected=pick(`export async function getStored${name}ById(`,`export async function ${chosen==='vacancy'?'getStoredVacancyForUser':'listStoredWorkRequests'}(`)+
  pick(`export async function listStored${plural}(`,`export async function listStored${plural}ForAdmin(`);
 const calls=[];let legacy=0;const result={id:'11111111-1111-4111-8111-111111111111',title:'Только российская БД'},exports={};
 const store={read:async(...args)=>{calls.push(['read',...args]);if(failed)throw Error('Synthetic primary unavailable');return result;},
  list:async(...args)=>{calls.push(['list',...args]);if(failed)throw Error('Synthetic primary unavailable');return[result];}};
 const code=ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{BLIZHNIY_AUTH_MODE:'postgres'}},console:{error(){}},Date,Math,Number,encodeURIComponent,
  isSupabaseRestConfigured:()=>{legacy++;return true;},isUuid:()=>true,supabaseRest:async()=>{throw Error('Forbidden legacy request');},fetchWorkRequestRows:async()=>{throw Error('Forbidden legacy request');},
  require:path=>{assert.equal(path,'./production-public-work-runtime');return{getProductionPublicWorkStore:async()=>store};},
 });return{read:exports[`getStored${name}ById`],list:exports[`listStored${plural}`],calls,result,get legacy(){return legacy;}};
}
for(const chosen of ['vacancy','workRequest']){
 test(chosen+' public list/detail select the Russian repository before inspecting leftover legacy configuration',async()=>{
  const f=fixture(chosen);assert.deepEqual(await f.read(f.result.id,{publicOnly:true}),f.result);assert.deepEqual(await f.list(25,24),[f.result]);
  assert.deepEqual(f.calls,[['read',chosen,f.result.id],['list',chosen,25,24]]);assert.equal(f.legacy,0);
  assert.equal(await f.read(f.result.id),undefined,'legacy unscoped private reads are not a Russian owner credential');assert.equal(f.calls.length,2);
 });
 test(chosen+' primary read failure propagates rather than pretending the catalog is empty or falling back',async()=>{
  const f=fixture(chosen,true);await assert.rejects(f.read(f.result.id,{publicOnly:true}),/Synthetic primary unavailable/);await assert.rejects(f.list(),/Synthetic primary unavailable/);assert.equal(f.legacy,0);assert.equal(f.calls.length,2);
 });
}
