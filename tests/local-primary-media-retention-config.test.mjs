import assert from 'node:assert/strict';import {test} from 'node:test';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {readLocalMediaRetentionConfig} from '../scripts/local-primary-media-retention-config.mjs';
test('media cleanup credentials are private, bounded and tied to the exact stand with an independent password',()=>{
 const directory=mkdtempSync(join(tmpdir(),'blizhniy-media-config-')),file=join(directory,'media-retention.json');
 const state={project:process.cwd(),containerId:'a'.repeat(64),origin:'https://127.0.0.1:3045',database:'blizhniy_prod',ownerPassword:'b'.repeat(64),runtimePassword:'c'.repeat(64),rateSecret:'d'.repeat(64)};
 const refunds={workerPassword:'f'.repeat(64),operatorPassword:'a'.repeat(64)};
 const value={version:1,project:state.project,containerId:state.containerId,password:'e'.repeat(64)};
 try{
  writeFileSync(file,JSON.stringify(value),{mode:0o600});assert.deepEqual(readLocalMediaRetentionConfig(file,state,refunds),value);
  for(const patch of [{version:2},{project:'/foreign'},{containerId:'f'.repeat(64)},{password:state.ownerPassword},{password:state.runtimePassword},{password:state.rateSecret},{password:refunds.workerPassword},{password:refunds.operatorPassword},{password:''},{extra:true}]){writeFileSync(file,JSON.stringify({...value,...patch}));assert.throws(()=>readLocalMediaRetentionConfig(file,state,refunds),{message:'Local media cleanup configuration unavailable'});}
  writeFileSync(file,JSON.stringify(value));symlinkSync(file,join(directory,'symlink'));assert.throws(()=>readLocalMediaRetentionConfig(join(directory,'symlink'),state,refunds));
  linkSync(file,join(directory,'hardlink'));assert.throws(()=>readLocalMediaRetentionConfig(file,state,refunds));rmSync(join(directory,'hardlink'));
  chmodSync(file,0o644);assert.throws(()=>readLocalMediaRetentionConfig(file,state,refunds));chmodSync(file,0o600);
  writeFileSync(file,'x'.repeat(2049));assert.throws(()=>readLocalMediaRetentionConfig(file,state,refunds));writeFileSync(file,JSON.stringify(value));
  chmodSync(directory,0o755);assert.throws(()=>readLocalMediaRetentionConfig(file,state,refunds));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
