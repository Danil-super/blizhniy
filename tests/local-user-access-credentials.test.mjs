import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,chmod,copyFile,writeFile,rm,symlink,link,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
test('candidate credential reader admits only a private bound distinct secret and redacts all failures',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-user-credentials-'));await chmod(directory,0o700);
 try{
  await copyFile(new URL('../docs/review/user-access61/local-user-access-credentials.mjs.candidate',import.meta.url),join(directory,'reader.mjs'));
  const {readLocalUserAccessCredentials:read}=await import(pathToFileURL(join(directory,'reader.mjs'))),file=join(directory,'user-access.json');
  const state={origin:'https://127.0.0.1:3045',database:'blizhniy_prod',project:'/synthetic/project',containerId:'1'.repeat(64),ownerPassword:'2'.repeat(64),runtimePassword:'3'.repeat(64),rateSecret:'4'.repeat(64)};
  const value={version:1,project:state.project,containerId:state.containerId,password:'5'.repeat(64)};
  const save=async body=>{await writeFile(file,JSON.stringify(body),{mode:0o600});await chmod(file,0o600);};
  await save(value);assert.deepEqual(read(file,state),value);
  for(const patch of [{version:2},{project:'/other'},{containerId:'6'.repeat(64)},{password:state.ownerPassword},{password:state.runtimePassword},{password:state.rateSecret},{password:'bad'},{role:'owner'}]){
   await save({...value,...patch});assert.throws(()=>read(file,state),error=>error.message==='Local user operator credentials unavailable');
  }
  await save(value);await chmod(file,0o644);assert.throws(()=>read(file,state));await chmod(file,0o600);
  await chmod(directory,0o755);assert.throws(()=>read(file,state));await chmod(directory,0o700);
  const other=join(directory,'other');await link(file,other);assert.throws(()=>read(file,state));await unlink(other);
  await unlink(file);await writeFile(other,JSON.stringify(value),{mode:0o600});await symlink(other,file);assert.throws(()=>read(file,state));
 }finally{await rm(directory,{recursive:true,force:true});}
});
