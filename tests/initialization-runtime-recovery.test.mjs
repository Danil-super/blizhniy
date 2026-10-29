import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {ReadOnlyInitialization,DependencyNotReadyError} from '../src/lib/read-only-initialization.ts';
import {MailPayloadCipher} from '../src/lib/mail-outbox.ts';
import {loadProductionAuth} from './production-auth-module.mjs';

const require=createRequire(import.meta.url),ts=require('typescript');
const config={origin:'https://xn----9sbphbgks4a4a.xn--p1ai',rateSecret:'r'.repeat(64),mailKeyFile:'/synthetic/key'};
function authFixture(failure){
 delete globalThis.blizhniyProductionAuth;
 let now=0,pools=0,closed=0,verified=0;
 const init={ReadOnlyInitialization:class extends ReadOnlyInitialization{constructor(create){super(create,()=>now);}}};
 const db={query:async()=>({rows:[]}),close:async()=>{closed++;}};
 const runtime=loadProductionAuth('production-auth-runtime',{
  './read-only-initialization.ts':init,'./postgres':{createPostgresDatabase:()=>{pools++;return db;}},
  './production-auth-config':{readConfirmationNoticeEnabled:()=>false,readMailEncryptionKey:()=>randomBytes(32)},
  './production-auth-database.ts':{verifyProductionAuthDatabase:async()=>{verified++;if(pools===1)throw failure;}},
  './mail-outbox':{MailPayloadCipher},'./mail-delivery':{},'./timeweb-mail':{},'./production-account-http':{},
  './registration':{RegistrationStore:class{}},'./password-recovery':{PasswordRecoveryStore:class{}},
  './identity':{IdentityStore:class{}},'./turnstile':{},
 });
 return {runtime,db,time:value=>{now=value;},counts:()=>({pools,closed,verified})};
}
test('real auth runtime discards a failed startup pool and recovers once after the dependency returns',async()=>{
 const f=authFixture(Object.assign(new Error('Synthetic DB connection refusal'),{code:'ECONNREFUSED'}));
 try{
  await assert.rejects(f.runtime.getProductionAccountDatabase(config),{code:'ECONNREFUSED'});
  assert.deepEqual(f.counts(),{pools:1,closed:1,verified:1});f.time(4999);
  await assert.rejects(f.runtime.getProductionAccountDatabase(config));assert.equal(f.counts().pools,1);
  f.time(5000);const values=await Promise.all(Array.from({length:20},()=>f.runtime.getProductionAccountDatabase(config)));
  assert.ok(values.every(value=>value.db===f.db));assert.deepEqual(f.counts(),{pools:2,closed:1,verified:2});
 }finally{delete globalThis.blizhniyProductionAuth;}
});
test('real auth runtime never retries schema, privilege or TLS failures as transport recovery',async()=>{
 for(const code of ['42P01','42501','CERT_HAS_EXPIRED']){
  const f=authFixture(Object.assign(new Error('Synthetic permanent failure'),{code}));
  try{
   await assert.rejects(f.runtime.getProductionAccountDatabase(config));f.time(999999);
   await assert.rejects(f.runtime.getProductionAccountDatabase(config));assert.deepEqual(f.counts(),{pools:1,closed:1,verified:1});
  }finally{delete globalThis.blizhniyProductionAuth;}
 }
});
function mediaFixture(unsafe=false,missingParent=false,unsafeParent=false){
 delete globalThis.blizhniyProductionMedia;
 let now=0,socketReady=false,checks=0,stores=0;
 const source=readFileSync(new URL('../src/lib/production-media-runtime.ts',import.meta.url),'utf8');
 const read=async()=>Buffer.alloc(0),exports={};
 const modules={
  'node:crypto':{randomUUID},'node:fs':{realpathSync:path=>path,lstatSync:path=>{
   checks++;
   if(path==='/run/blizhniy-media'&&missingParent&&!socketReady)throw Object.assign(new Error('Synthetic absent socket parent'),{code:'ENOENT'});
   if(path==='/run/blizhniy-media/decoder.sock'){
    if(!socketReady)throw Object.assign(new Error('Synthetic absent socket'),{code:'ENOENT'});
    return {isSocket:()=>true,uid:process.getuid(),gid:process.getgid(),mode:unsafe?0o666:0o600,nlink:1};
   }
   return {isDirectory:()=>true,uid:path==='/run/blizhniy-media'&&unsafeParent?42:0,mode:0o755};
  }},
  './read-only-initialization.ts':{DependencyNotReadyError,ReadOnlyInitialization:class extends ReadOnlyInitialization{constructor(create){super(create,()=>now);}}},
  './media-runtime-policy':{assertMediaRuntime:()=>({root:'/synthetic/media',app:'/synthetic/app',socket:'/run/blizhniy-media/decoder.sock'})},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>({db:{query:async()=>({rows:[]})},limiter:{}})},
  './media-files':{createLocalMediaFileStore:async()=>{stores++;return {read};}},
  './media-file-worker':{createLocalMediaFileWorker:async()=>({})},
  './media-socket':{createMediaSocketClient:()=>({})},
  './media-metadata':{MediaMetadataRepository:class{}},'./media-write':{LocalMediaWriter:class{}},
  './media-upload':{LocalMediaUpload:class{}},'./identity':{IdentityStore:class{}},
  './auth-http':{},'./production-auth-config':{},'./production-media-http':{},
 };
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  assert.ok(Object.hasOwn(modules,name),`Unexpected import: ${name}`);return modules[name];
 },exports);
 return {runtime:exports,read,time:value=>{now=value;},ready:()=>{socketReady=true;},counts:()=>({checks,stores})};
}
function randomUUID(){return '11111111-1111-4111-8111-111111111111';}
test('real media runtime recovers after its absent decoder socket appears without restarting the process',async()=>{
 const f=mediaFixture();
 try{
  await assert.rejects(f.runtime.getProductionMediaFileReader(config),DependencyNotReadyError);
  const before=f.counts();f.ready();f.time(4999);await assert.rejects(f.runtime.getProductionMediaFileReader(config));assert.deepEqual(f.counts(),before);
  f.time(5000);const results=await Promise.all(Array.from({length:20},()=>f.runtime.getProductionMediaFileReader(config)));
  assert.ok(results.every(value=>value.read===f.read));assert.equal(f.counts().stores,1);
 }finally{delete globalThis.blizhniyProductionMedia;}
});
test('real media runtime keeps unsafe socket permissions closed despite later requests',async()=>{
 const f=mediaFixture(true);f.ready();
 try{
  await assert.rejects(f.runtime.getProductionMediaFileReader(config));const before=f.counts();f.time(999999);
  await assert.rejects(f.runtime.getProductionMediaFileReader(config));assert.deepEqual(f.counts(),before);assert.equal(f.counts().stores,0);
 }finally{delete globalThis.blizhniyProductionMedia;}
});
test('real media runtime recovers when systemd creates the previously missing socket parent',async()=>{
 const f=mediaFixture(false,true);
 try{
  await assert.rejects(f.runtime.getProductionMediaFileReader(config),DependencyNotReadyError);
  f.ready();f.time(5000);assert.equal((await f.runtime.getProductionMediaFileReader(config)).read,f.read);
  assert.equal(f.counts().stores,1);
 }finally{delete globalThis.blizhniyProductionMedia;}
});
test('real media runtime never retries an existing socket parent with an unsafe owner',async()=>{
 const f=mediaFixture(false,false,true);f.ready();
 try{
  await assert.rejects(f.runtime.getProductionMediaFileReader(config));const before=f.counts();f.time(999999);
  await assert.rejects(f.runtime.getProductionMediaFileReader(config));assert.deepEqual(f.counts(),before);
  assert.equal(f.counts().stores,0);
 }finally{delete globalThis.blizhniyProductionMedia;}
});
