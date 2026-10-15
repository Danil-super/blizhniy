import assert from 'node:assert/strict';
import { readFileSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

function fixture() {
  const ts=createRequire(import.meta.url)('typescript'), exports={};
  const config={version:1,uid:994,root:'/var/lib/blizhniy-web/media',socket:'/run/blizhniy-media/decoder.sock'};
  const context={env:{NODE_ENV:'production',BLIZHNIY_AUTH_MODE:'postgres'},platform:'linux',versions:{node:'22.23.3'},execPath:'/opt/blizhniy-node22/bin/node',getuid:()=>994,getgid:()=>985};
  const entries=new Map();
  const directory=(uid=0,mode=0o755)=>({uid,gid:0,mode,isDirectory:()=>true,isFile:()=>false});
  for(const path of ['/etc','/var','/var/www','/var/www/blizhniy-releases','/var/www/blizhniy-releases/20261015132847-54dc9af2264d'])entries.set(path,directory());
  entries.set(config.root,directory(994,0o700));
  const info={uid:0,gid:985,mode:0o640,nlink:1,size:200,isFile:()=>true};
  let closed=0,opened=0,raw;
  const fs={constants,realpathSync:path=>path==='/var/www/blizhniy'?'/var/www/blizhniy-releases/20261015132847-54dc9af2264d':path,
    lstatSync:path=>{if(!entries.has(path))throw new Error('missing');return entries.get(path);},
    openSync:(path,flags)=>{assert.equal(path,'/etc/blizhniy-media-runtime.json');assert.ok(flags&constants.O_NOFOLLOW);opened++;return 7;},
    fstatSync:fd=>{assert.equal(fd,7);return info;},readFileSync:()=>raw??JSON.stringify(config),closeSync:()=>{closed++;}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/media-runtime-policy.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,process:context,JSON,Buffer,require:path=>{assert.equal(path,'node:fs');return fs;}});
  return {exports,config,context,entries,info,fs,raw:value=>{raw=value;},closed:()=>closed,opened:()=>opened};
}
test('production media requires an operator-owned config and the dedicated Node22 web identity',()=>{
  const f=fixture(),policy=f.exports.assertMediaRuntime(f.context,f.config.root,'/var/www/blizhniy-releases/20261015132847-54dc9af2264d');
  assert.equal(policy.root,f.config.root);assert.equal(policy.socket,f.config.socket);assert.equal(f.closed(),1);
  for(const change of [f=>f.context.env.BLIZHNIY_AUTH_MODE='local',f=>f.context.versions.node='20.20.2',f=>f.context.getuid=()=>0,
    f=>f.context.execPath='/tmp/untrusted-node',f=>f.info.uid=994,f=>f.info.gid=0,f=>f.info.mode=0o660,f=>f.info.nlink=2,
    f=>f.info.size=1025,f=>f.config.root='/tmp/untrusted',f=>f.config.socket='/tmp/socket',f=>f.config.version=2,
    f=>f.config.extra=true,f=>f.entries.get('/var/www').mode=0o777,f=>f.entries.get(f.config.root).mode=0o755,
    f=>f.entries.get(f.config.root).uid=0,f=>f.raw('{broken')]){
    const f=fixture();change(f);assert.throws(()=>f.exports.assertMediaRuntime(f.context),/Restricted media runtime unavailable/);
  }
});
test('production policy refuses alternate storage/source paths and local mode never reads operator configuration',()=>{
  const f=fixture();assert.throws(()=>f.exports.assertMediaRuntime(f.context,'/tmp/other'),/Restricted media runtime unavailable/);
  assert.throws(()=>f.exports.assertMediaRuntime(f.context,f.config.root,'/tmp/other'),/Restricted media runtime unavailable/);
  for(const mode of ['test','development']){
    const f=fixture();f.context.env.NODE_ENV=mode;assert.equal(f.exports.assertMediaRuntime(f.context),null);assert.equal(f.opened(),0);
  }
  const f2=fixture();f2.context.env.NODE_ENV='';assert.throws(()=>f2.exports.assertMediaRuntime(f2.context),/Restricted media runtime unavailable/);
});
