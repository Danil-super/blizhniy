import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateLocalPrimaryState,validateLocalPrimaryContainer,validateLocalPrimaryContainerDefinition,readLocalPrimaryState} from '../scripts/local-primary-config.mjs';
import {mkdtemp,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const state={version:1,project:'/owned/project',origin:'https://127.0.0.1:3045',upstreamPort:3046,
 containerId:'a'.repeat(64),containerName:'blizhniy-primary-local-123456789abc',dbPort:35432,
 database:'blizhniy_prod',runtimePassword:'a'.repeat(64),ownerPassword:'b'.repeat(64),rateSecret:'c'.repeat(64)};
test('local primary state allows only exact owned loopback stand and synthetic credentials',()=>{
 assert.equal(validateLocalPrimaryState(state,'/owned/project').origin,state.origin);
 for(const patch of [{origin:'https://example.com:3045'},{origin:'http://127.0.0.1:3045'},
  {project:'/other'},{database:'other'},{dbPort:0},{containerId:'bad'},{runtimePassword:''},{extra:true}])
  assert.throws(()=>validateLocalPrimaryState({...state,...patch},'/owned/project'));
});
test('local state refuses a symlink, public permissions and an unrelated project',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-primary-config-')),file=join(directory,'state.json');
 try{
  await chmod(directory,0o700);await writeFile(file,JSON.stringify(state),{mode:0o600});
  assert.equal(readLocalPrimaryState(file,'/owned/project').containerId,state.containerId);
  assert.throws(()=>readLocalPrimaryState(file,'/foreign'));
  await chmod(file,0o644);assert.throws(()=>readLocalPrimaryState(file,'/owned/project'));
  await chmod(file,0o600);const linked=join(directory,'link.json');await symlink(file,linked);
  assert.throws(()=>readLocalPrimaryState(linked,'/owned/project'));
  await chmod(directory,0o755);assert.throws(()=>readLocalPrimaryState(file,'/owned/project'));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('production cannot accidentally import the local bridge without explicit owned state',()=>{
 assert.throws(()=>execFileSync(process.execPath,['--require','./scripts/local-primary-preload.cjs','-e','process.exit(0)'],
  {env:{PATH:process.env.PATH,NODE_ENV:'production'},stdio:'pipe'}),/Command failed/);
});
test('local primary container rejects a foreign image, label, ID or exposed port',()=>{
 const metadata={Id:state.containerId,Name:'/'+state.containerName,Config:{Image:'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',Labels:{'blizhniy.primary-local':state.project}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(state.dbPort)}]}}};
 assert.equal(validateLocalPrimaryContainer(metadata,state),state.containerId);
 for(const mutation of [m=>m.Id='b'.repeat(64),m=>m.Config.Image='postgres:latest',m=>m.Config.Labels={},m=>m.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0']){
  const copy=structuredClone(metadata);mutation(copy);assert.throws(()=>validateLocalPrimaryContainer(copy,state));
 }
});
test('local restart validates exact ownership and configured loopback before starting the same container',()=>{
 const metadata={Id:state.containerId,Name:'/'+state.containerName,Config:{Image:'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',Labels:{'blizhniy.primary-local':state.project}},HostConfig:{NetworkMode:'default',PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:''}]}}};
 assert.equal(validateLocalPrimaryContainerDefinition(metadata,state),state.containerId);
 for(const mutate of [m=>m.Id='b'.repeat(64),m=>m.Config.Image='postgres:latest',m=>m.Config.Labels={},m=>m.HostConfig.NetworkMode='host',m=>m.HostConfig.PortBindings['5432/tcp'][0].HostIp='0.0.0.0',m=>m.HostConfig.PortBindings['5432/tcp'].push({HostIp:'127.0.0.1',HostPort:''}),m=>m.HostConfig.PortBindings['80/tcp']=[]]){
  const copy=structuredClone(metadata);mutate(copy);assert.throws(()=>validateLocalPrimaryContainerDefinition(copy,state));
 }
 assert.throws(()=>validateLocalPrimaryContainer({...metadata,NetworkSettings:{Ports:{}}},state));
});

test('a separate fixture directory is explicit, synthetic and private',async()=>{
 const {resolveLocalPrimaryDirectory}=await import('../scripts/local-primary-config.mjs');
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-primary-isolated-')),alias=directory+'-alias';
 const env={NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY_FIXTURE_DIR:directory};
 try{
  assert.equal(resolveLocalPrimaryDirectory('/default',{}),'/default');
  assert.equal(resolveLocalPrimaryDirectory('/default',env),directory);
  assert.throws(()=>resolveLocalPrimaryDirectory('/default',{...env,NODE_ENV:'production'}));
  assert.throws(()=>resolveLocalPrimaryDirectory('/default',{...env,BLIZHNIY_LOCAL_PRIMARY_FIXTURE_DIR:'relative'}));
  await symlink(directory,alias);
  assert.throws(()=>resolveLocalPrimaryDirectory('/default',{...env,BLIZHNIY_LOCAL_PRIMARY_FIXTURE_DIR:alias}));
  await chmod(directory,0o750);
  assert.throws(()=>resolveLocalPrimaryDirectory('/default',env));
 }finally{
  await rm(alias,{force:true});
  await rm(directory,{recursive:true,force:true});
 }
});
