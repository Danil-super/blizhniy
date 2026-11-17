import assert from 'node:assert/strict';import{test}from'node:test';import{createRequire}from'node:module';
import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{assertPrebuiltImageConfig}from'../scripts/prebuilt-image-config-policy.mjs';
const require=createRequire(import.meta.url),defaults=require('next/dist/shared/lib/image-config').imageConfigDefault;
const config=()=>({assetPrefix:'',images:{...defaults}}),source=value=>'const nextConfig = '+JSON.stringify(value)+'\n';
test('standalone image defaults are accepted without evaluating generated JavaScript',()=>{
 assert.equal(assertPrebuiltImageConfig(source(config())+'throw Error("must not execute");\n'),true);
});
test('missing, malformed or activated image matching and external prefixes fail without exposing config',()=>{
 const variants=[null,{},[],{...config(),assetPrefix:'https://static.example.invalid'},
  {...config(),images:null},{...config(),images:[]},
  {...config(),images:{...defaults,localPatterns:[]}},
  {...config(),images:{...defaults,localPatterns:[{pathname:'+(*a)'}]}},
  {...config(),images:{...defaults,remotePatterns:[{hostname:'+(*a)'}]}},
  {...config(),images:{...defaults,domains:['example.invalid']}}];
 for(const value of variants)assert.throws(()=>assertPrebuiltImageConfig(source(value)),{message:'Prebuilt image matcher policy failed'});
 for(const value of ['',source(config())+source(config()),'const nextConfig = {"private":"synthetic-must-not-print",\n','x'.repeat(2*1024*1024+1)]){
  assert.throws(()=>assertPrebuiltImageConfig(value),error=>error.message==='Prebuilt image matcher policy failed'&&!error.message.includes('synthetic-must-not-print'));
 }
});
test('actual bundled Next image helpers never compile user-controlled paths under the accepted defaults',()=>{
 const matcher=require('next/dist/compiled/picomatch'),original=matcher.makeRe;let calls=0;
 matcher.makeRe=()=>{calls++;throw Error('Image matcher must stay inactive');};
 try{
  const local=require('next/dist/shared/lib/match-local-pattern').hasLocalMatch,remote=require('next/dist/shared/lib/match-remote-pattern').hasRemoteMatch,c=config();assertPrebuiltImageConfig(source(c));
  for(const path of ['/images/photo.webp','/'+ 'a'.repeat(30)+'!','/+(*a)'])assert.equal(local(c.images.localPatterns,path),true);
  for(const url of ['https://example.invalid/a','https://attacker.invalid/+(*a)'])assert.equal(remote(c.images.domains,c.images.remotePatterns,new URL(url)),false);
  assert.equal(calls,0);
 }finally{matcher.makeRe=original;}
});
test('the prebuilt runtime gate rejects activated matching before importing or starting artifact code',()=>{
 const root=mkdtempSync(join(tmpdir(),'prebuilt-image-policy-'));
 try{
  writeFileSync(join(root,'server.js'),source({...config(),images:{...defaults,localPatterns:[{pathname:'+(*a)'}]}}));
  const result=spawnSync(process.execPath,['scripts/check-prebuilt-runtime.mjs',root],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Prebuilt image matcher policy failed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
