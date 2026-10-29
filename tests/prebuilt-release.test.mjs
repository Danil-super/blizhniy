import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,chmodSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {preparePrebuiltRelease} from '../scripts/verify-prebuilt-release.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),commit='a'.repeat(40);
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'prebuilt-integrity-'));chmodSync(root,0o700);
 const values={'server.js':'// server','ecosystem.config.cjs':'module.exports={}',
  'package-lock.json':'{"lockfileVersion":3}','.next/BUILD_ID':commit,
  'scripts/web-runtime.cjs':'// guard','scripts/check-auth-captcha-env.cjs':'// captcha',
  'scripts/rollback-release.sh':'#!/bin/sh\nexit 0','scripts/auth-mail-worker.mjs':'// mail',
  'node_modules/@next/env/package.json':'{"name":"@next/env"}',
  'node_modules/nodemailer/package.json':'{"name":"nodemailer"}',
  'public/image.webp':'synthetic pixels'};
 const files=Object.fromEntries(Object.entries(values).map(([name,value])=>{
  mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});writeFileSync(join(root,name),value,{mode:0o600});
  return[name,{sha256:hash(value),mode:0o644}];
 }));
 const manifest={format:2,commit,buildId:commit,lockfileSha256:hash(values['package-lock.json']),
  node:process.version,platform:'linux',arch:'x64',glibc:process.report.getReport().header.glibcVersionRuntime,files};
 const save=()=>writeFileSync(join(root,'release-manifest.json'),JSON.stringify(manifest),{mode:0o600});save();
 try{return run({root,manifest,save});}finally{rmSync(root,{recursive:true,force:true});}
}
test('verified prebuilt code becomes readable without weakening its owner or write permissions',()=>fixture(({root})=>{
 const proof=preparePrebuiltRelease(root,commit);assert.equal(proof.commit,commit);
 assert.equal(statSync(root).mode&0o777,0o755);
 assert.equal(statSync(join(root,'.next')).mode&0o777,0o755);
 assert.equal(statSync(join(root,'server.js')).mode&0o777,0o644);
 assert.equal(readFileSync(join(root,'.next/BUILD_ID'),'utf8'),commit);
}));
test('wrong commit, build ID, lockfile, platform or ABI is refused before changing permissions',()=>{
 for(const change of [m=>m.commit='b'.repeat(40),m=>m.buildId='b'.repeat(40),m=>m.lockfileSha256='0'.repeat(64),
  m=>m.platform='darwin',m=>m.arch='arm64',m=>m.node='v23.0.0',m=>m.glibc='99.0',m=>m.format=1])fixture(({root,manifest,save})=>{
  change(manifest);save();assert.throws(()=>preparePrebuiltRelease(root,commit));assert.equal(statSync(root).mode&0o777,0o700);
 });
});
test('changed or missing code and extra files are rejected before the permissions phase',()=>{
 for(const change of [root=>writeFileSync(join(root,'server.js'),'altered'),root=>rmSync(join(root,'server.js')),
  root=>writeFileSync(join(root,'extra.js'),'unexpected')])fixture(({root})=>{
  change(root);assert.throws(()=>preparePrebuiltRelease(root,commit));assert.equal(statSync(root).mode&0o777,0o700);
 });
});
test('environment files, symlinks, hardlinks and traversal paths are never adopted as code',()=>{
 for(const change of [({root})=>symlinkSync('/etc/passwd',join(root,'link')),({root})=>linkSync(join(root,'server.js'),join(root,'alias')),
  ({root,manifest,save})=>{writeFileSync(join(root,'.env.production.local'),'synthetic');manifest.files['.env.production.local']={sha256:hash('synthetic'),mode:0o644};save();},
  ({manifest,save})=>{manifest.files['../outside']={sha256:hash('x'),mode:0o644};save();}])fixture(context=>{
  change(context);assert.throws(()=>preparePrebuiltRelease(context.root,commit));assert.equal(statSync(context.root).mode&0o777,0o700);
 });
});
