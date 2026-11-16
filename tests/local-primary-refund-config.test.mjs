import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLocalPrimaryRefundConfig} from '../scripts/local-primary-refund-config.mjs';
import {spawnSync} from 'node:child_process';

test('refund credentials are private, bounded and bound to the exact owned project and container',()=>{
 const directory=mkdtempSync(join(tmpdir(),'blizhniy-refund-config-')),file=join(directory,'refunds.json');
 const state={project:process.cwd(),containerId:'a'.repeat(64),origin:'https://127.0.0.1:3045',database:'blizhniy_prod',ownerPassword:'b'.repeat(64),runtimePassword:'c'.repeat(64)};
 const value={version:1,project:state.project,containerId:state.containerId,operatorPassword:'d'.repeat(64),workerPassword:'e'.repeat(64)};
 try{
  chmodSync(directory,0o700);writeFileSync(file,JSON.stringify(value),{mode:0o600});assert.deepEqual(readLocalPrimaryRefundConfig(file,state),value);
  for(const patch of [{version:2},{project:'/foreign'},{containerId:'f'.repeat(64)},{operatorPassword:state.ownerPassword},{workerPassword:state.runtimePassword},{workerPassword:value.operatorPassword},{workerPassword:''},{extra:true}]){
   writeFileSync(file,JSON.stringify({...value,...patch}));assert.throws(()=>readLocalPrimaryRefundConfig(file,state),{message:'Local refund configuration unavailable'});
  }
  writeFileSync(file,JSON.stringify(value));symlinkSync(file,join(directory,'link'));assert.throws(()=>readLocalPrimaryRefundConfig(join(directory,'link'),state));
  linkSync(file,join(directory,'hardlink'));assert.throws(()=>readLocalPrimaryRefundConfig(file,state));rmSync(join(directory,'hardlink'));
  chmodSync(file,0o644);assert.throws(()=>readLocalPrimaryRefundConfig(file,state));chmodSync(file,0o600);
  writeFileSync(file,'x'.repeat(2049));assert.throws(()=>readLocalPrimaryRefundConfig(file,state));writeFileSync(file,JSON.stringify(value));
  chmodSync(directory,0o755);assert.throws(()=>readLocalPrimaryRefundConfig(file,state));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('refund config caps actual reads when its inode grows after stat',()=>{
 const directory=mkdtempSync(join(tmpdir(),'blizhniy-refund-growing-')),file=join(directory,'refunds.json');
 try{
  chmodSync(directory,0o700);writeFileSync(file,' '.repeat(4096),{mode:0o600});
  const script=`import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const stat=fs.fstatSync,read=fs.readSync;let total=0,checking=false;fs.fstatSync=fd=>checking?({...stat(fd),isFile:()=>true,size:100}):stat(fd);
   fs.readSync=(fd,buffer,offset,length,position)=>{if(checking)assert.ok(buffer.length<=2049);const count=read(fd,buffer,offset,length,position);if(checking)total+=count;return count;};syncBuiltinESMExports();
   const {readLocalPrimaryRefundConfig}=await import('./scripts/local-primary-refund-config.mjs');checking=true;
   assert.throws(()=>readLocalPrimaryRefundConfig(process.argv[1],{origin:'https://127.0.0.1:3045',database:'blizhniy_prod'}),{message:'Local refund configuration unavailable'});assert.equal(total,2049);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,file],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
