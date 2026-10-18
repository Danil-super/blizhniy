import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript');
function fixture(chosen,failed=false){
 const names={specialist:['specialist-profile-store','listStoredSpecialistProfiles','getStoredSpecialistProfileById'],fair:['fair-application-store','listStoredFairApplications'],marquee:['ad-marquee-store','getActiveAdMarqueeMessages']}[chosen];
 const source=readFileSync(new URL(`../src/lib/${names[0]}.ts`,import.meta.url),'utf8'),selected=names.slice(1).map(name=>{const start=source.indexOf(`export async function ${name}(`),next=source.indexOf('\nexport ',start+1);assert.ok(start>=0);return source.slice(start,next<0?source.length:next);}).join('\n');
 const calls=[];let legacy=0;const item={id:'10000000-0000-4000-8000-000000000001',text:'Синтетический материал'},exports={};
 const store={list:async(...args)=>{calls.push(['list',...args]);if(failed)throw Error('Synthetic primary unavailable');return[item];},read:async(...args)=>{calls.push(['read',...args]);if(failed)throw Error('Synthetic primary unavailable');return item;}};
 vm.runInNewContext(ts.transpileModule(selected,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{BLIZHNIY_AUTH_MODE:'postgres'}},Math,Number,encodeURIComponent,console:{error(){}},
  defaultAdMarqueeMessages:['Информация платформы'],specialistProfileSelect:'synthetic',mapSpecialistProfile:value=>value,publicSpecialistProfile:value=>value,isUuid:()=>true,
  isSupabaseRestConfigured:()=>{legacy++;return true;},shouldShowFallbackContent:()=>{throw Error('No legacy fallback');},
  supabaseRest:async()=>{throw Error('Forbidden legacy transport');},listActiveAdMarqueePlacements:async()=>{throw Error('Forbidden legacy queue');},
  require:name=>{assert.equal(name,'./production-public-service-runtime');return{getProductionPublicServiceStore:async()=>store};}});
 return{api:exports,calls,item,get legacy(){return legacy;}};
}
for(const kind of ['specialist','fair','marquee']){
 test(kind+' public callers select the Russian service repository before leftover legacy configuration',async()=>{
  const f=fixture(kind);
  if(kind==='specialist'){assert.deepEqual(await f.api.listStoredSpecialistProfiles(25,24),[f.item]);assert.deepEqual(await f.api.getStoredSpecialistProfileById(f.item.id),f.item);assert.deepEqual(f.calls,[['list','specialist',25,24],['read','specialist',f.item.id]]);}
  else if(kind==='fair'){assert.deepEqual(await f.api.listStoredFairApplications('published',{limit:25,offset:24}),[f.item]);assert.deepEqual(Array.from(await f.api.listStoredFairApplications('draft')),[]);assert.deepEqual(f.calls,[['list','fair',25,24]]);}
  else{assert.deepEqual(Array.from(await f.api.getActiveAdMarqueeMessages()),[f.item.text]);assert.deepEqual(f.calls,[['list','marquee',5,0]]);}
  assert.equal(f.legacy,0);
 });
 test(kind+' primary failures are not swallowed as an empty catalog or legacy fallback',async()=>{
  const f=fixture(kind,true),work=kind==='specialist'?f.api.listStoredSpecialistProfiles():kind==='fair'?f.api.listStoredFairApplications('published'):f.api.getActiveAdMarqueeMessages();
  await assert.rejects(work,/Synthetic primary unavailable/);assert.equal(f.legacy,0);
 });
}
test('fair public API reaches the new repository even when legacy configuration is intentionally disabled',async()=>{
 const source=readFileSync(new URL('../src/app/api/fair-applications/route.ts',import.meta.url),'utf8'),start=source.indexOf('export async function GET('),end=source.indexOf('\nexport async function POST(',start),exports={};let calls=0;
 vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{BLIZHNIY_AUTH_MODE:'postgres'}},NextResponse:{json:Response.json},
  isSupabaseRestConfigured:()=>false,shouldShowFallbackContent:()=>false,listStoredFairApplications:async status=>{assert.equal(status,'published');calls++;return[{id:'synthetic'}];}});
 assert.deepEqual(await (await exports.GET()).json(),{applications:[{id:'synthetic'}]});assert.equal(calls,1);
});
test('fair images keep guarded same-origin service photo URLs rather than routing them into old public storage',()=>{
 const source=readFileSync(new URL('../src/components/FairPages.tsx',import.meta.url),'utf8'),start=source.indexOf('function fairPhotoUrl('),end=source.indexOf('\nexport ',start),exports={};
 vm.runInNewContext(ts.transpileModule('export '+source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,publicMediaUrl:()=>{throw Error('Do not remap a guarded image');}});
 const path='/api/service-publications/10000000-0000-4000-8000-000000000001/photos/10000000-0000-4000-8000-000000000002';assert.equal(exports.fairPhotoUrl(path),path);
});
