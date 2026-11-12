import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {createRequire} from 'node:module';
import {createLocalRefundOperatorRuntime,createLocalPrimaryRefundOperatorRuntime} from '../scripts/local-refund-operator-runtime.mjs';
import {localPrimaryImage} from '../scripts/local-primary-config.mjs';
import {verifyLocalPrimaryRefundTarget,assertLocalPrimaryRefundTrust} from '../scripts/local-primary-refund-target.mjs';
const project=process.cwd(),load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-owned-refund-proof-')),stateFile=join(directory,'state.json'),caFile=join(directory,'ca.crt');
 const state={version:1,project,origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:'a'.repeat(64),containerName:'blizhniy-primary-local-'+'b'.repeat(12),dbPort:54321,database:'blizhniy_prod',runtimePassword:'1'.repeat(64),ownerPassword:'2'.repeat(64),rateSecret:'3'.repeat(64)};
 const metadata={Id:state.containerId,Name:'/'+state.containerName,Config:{Image:localPrimaryImage,Labels:{'blizhniy.primary-local':project}},HostConfig:{NetworkMode:'bridge',PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:''}]}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(state.dbPort)}]}},State:{Running:true}};
 const env={BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_PORT:String(state.dbPort),BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_CA_FILE:caFile};
 await writeFile(stateFile,JSON.stringify(state),{mode:0o600});await writeFile(caFile,rootCertificates[0],{mode:0o644});const calls=[];
 const docker=async args=>{calls.push(args);if(args[0]==='inspect')return JSON.stringify([metadata]);assert.deepEqual(args,['exec',state.containerId,'cat','/var/lib/postgresql/refund-server.crt']);return rootCertificates[0];};
 return{directory,stateFile,caFile,state,metadata,env,calls,docker,close:()=>rm(directory,{recursive:true,force:true})};
}
test('owned target proof requires the exact private state, running local Docker binding and matching TLS trust',async()=>{
 const f=await fixture();try{
  assert.equal(await verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project},f.docker),rootCertificates[0].trim());assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],['inspect',f.state.containerId]);
  for(const change of [{BLIZHNIY_DB_HOST:'217.149.30.35'},{BLIZHNIY_DB_PORT:'54322'},{BLIZHNIY_DB_NAME:'blizhniy_test'}])await assert.rejects(verifyLocalPrimaryRefundTarget({...f.env,...change},{stateFile:f.stateFile,project},f.docker),{message:'Local refund target unavailable'});
  await assert.rejects(verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project:'/foreign'},f.docker));
  const original=structuredClone(f.metadata);
  for(const change of [m=>m.State.Running=false,m=>m.Id='c'.repeat(64),m=>m.Config.Labels['blizhniy.primary-local']='/foreign',m=>m.Config.Image='postgres:latest',m=>m.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0',m=>m.NetworkSettings.Ports['5432/tcp'][0].HostPort='54322',m=>m.HostConfig.NetworkMode='host']){
   Object.assign(f.metadata,structuredClone(original));change(f.metadata);await assert.rejects(verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project},f.docker));
  }
  Object.assign(f.metadata,original);const pinned=await verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project},f.docker);assertLocalPrimaryRefundTrust({ssl:{ca:rootCertificates[0],rejectUnauthorized:true}},pinned);
  for(const ssl of [false,{ca:rootCertificates[1],rejectUnauthorized:true},{ca:rootCertificates[0],rejectUnauthorized:false}])assert.throws(()=>assertLocalPrimaryRefundTrust({ssl},pinned));
  const configured={...f.env,NODE_ENV:'production',BLIZHNIY_DB_USER:'blizhniy_refund_operator',BLIZHNIY_DB_PASSWORD:'synthetic',BLIZHNIY_DB_SSL_MODE:'verify-full'},config=load('postgres').readPostgresConfig(configured);
  await writeFile(f.caFile,rootCertificates[1]);assertLocalPrimaryRefundTrust(config,pinned);assert.throws(()=>assertLocalPrimaryRefundTrust(load('postgres').readPostgresConfig(configured),pinned));
 }finally{await f.close();}
});
test('proof rejects unsafe state files and redacts Docker details without modifying a container',async()=>{
 const f=await fixture();try{
  await chmod(f.stateFile,0o644);await assert.rejects(verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project},f.docker));assert.equal(f.calls.length,0);await chmod(f.stateFile,0o600);
  const link=join(f.directory,'state-link');await symlink(f.stateFile,link);await assert.rejects(verifyLocalPrimaryRefundTarget(f.env,{stateFile:link,project},f.docker));
  await assert.rejects(verifyLocalPrimaryRefundTarget(f.env,{stateFile:f.stateFile,project},async()=>{throw Error('private Docker credential');}),{message:'Local refund target unavailable'});
  assert.equal(f.calls.some(args=>['start','stop','rm','rename','cp'].includes(args[0])),false);
 }finally{await f.close();}
});

test('invalid default options and missing owned proof are redacted before any module or pool admission',async()=>{
 await assert.rejects(createLocalRefundOperatorRuntime(undefined,null),{message:'Local refund operator unavailable'});
 let loads=0;await assert.rejects(createLocalPrimaryRefundOperatorRuntime({BLIZHNIY_DB_HOST:'127.0.0.1',BLIZHNIY_DB_NAME:'blizhniy_prod'},{loadModules:()=>{loads++;throw Error('Unexpected module load');}}),{message:'Local refund operator unavailable'});assert.equal(loads,0);
});
