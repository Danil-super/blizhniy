import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const origin='https://avatar.example.invalid',owner='11111111-1111-4111-8111-111111111111',token='a'.repeat(64);
const {parseProductionProfile}=load('postgres-profile');
function fixture({blocked=false}={}){
 let stored=parseProductionProfile({name:'Synthetic owner'}),decodes=0,writes=0;
 const initial=structuredClone(stored);
 const revision=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(stored).sort(([a],[b])=>a<b?-1:a>b?1:0)))).digest('hex');
 const query=async(sql,values=[])=>{
  if(sql.startsWith('select user_id,profile,updated_at'))return {rows:[],rowCount:0};
  if(sql.includes("to_regclass('app.telegram_phone_bindings')"))return {rows:[{present:false}],rowCount:1};
  if(sql.startsWith('select u.id'))return {rows:[{id:owner,role:'user',isBlocked:blocked,verified:true,authVersion:'0'}],rowCount:1};
  if(sql.startsWith('select token_hash from app.sessions')||sql.startsWith('update app.sessions'))return {rows:[],rowCount:1};
  if(sql.startsWith('select email'))return {rows:[{email:'synthetic@example.invalid'}],rowCount:1};
  if(sql.startsWith('select profile from app.cabinet_profiles'))return {rows:[{profile:structuredClone(stored)}],rowCount:1};
  if(sql.startsWith('update app.cabinet_profiles')){writes++;stored=JSON.parse(values[1]);return {rows:[{user_id:owner}],rowCount:1};}
  throw new Error('Unexpected production composition fixture SQL');
 };
 const db={query,transaction:work=>work({query})};
 const deps={
  'node:crypto':{randomUUID},'./auth-http':load('auth-http'),
  './production-auth-config':{readProductionAuthConfig:()=>({origin})},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>({db,limiter:{allowProduction:async()=>true}})},
  './production-profile-http':load('production-profile-http'),'./postgres-profile':load('postgres-profile'),'./profile-avatar':load('profile-avatar'),
  './production-media-runtime':{getProductionMediaNormalizer:async()=>({normalize:async()=>{decodes++;throw Object.assign(new Error('Synthetic decoder rejection'),{code:'INVALID_IMAGE'});}})},
 };
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../src/lib/production-profile-runtime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in deps))throw new Error('Unapproved runtime fixture import');return deps[name];},exports);
 const request=(expectedRevision=revision)=>new Request(origin+'/api/account/profile',{method:'PUT',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.91',cookie:`__Host-blizhniy_session=${token}`},body:JSON.stringify({expectedOwnerId:owner,expectedRevision,profile:{...initial,avatarDataUrl:'data:image/png;base64,iVBORw0KGgoBAgM='}})});
 return {handle:exports.handleProductionProfileRequest,request,decodes:()=>decodes,writes:()=>writes,unchanged:()=>JSON.stringify(stored)===JSON.stringify(initial)};
}
test('actual primary profile composition requires the decoder before storing a changed avatar',async()=>{
 const f=fixture(),response=await f.handle(f.request());assert.equal(response.status,422);assert.deepEqual(await response.json(),{error:{code:'INVALID_INPUT'}});assert.equal(f.decodes(),1);assert.equal(f.writes(),0);assert.equal(f.unchanged(),true);
});
test('primary composition refuses blocked and stale profile requests before starting the decoder',async()=>{
 for(const blocked of [false,true]){const f=fixture({blocked}),response=await f.handle(f.request('f'.repeat(64)));assert.equal(response.status,blocked?401:409);assert.equal(f.decodes(),0);assert.equal(f.writes(),0);assert.equal(f.unchanged(),true);}
});
