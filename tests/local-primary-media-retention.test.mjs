import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('one-shot composition uses the fixed web media root, preflights before files, closes on failure and respects abort',()=>{
 const script=`import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import Module,{syncBuiltinESMExports} from 'node:module';import child from 'node:child_process';import pg from 'pg';
 const owned=fs.mkdtempSync(path.join(os.tmpdir(),'blizhniy-cleanup-runner-')),project=fs.realpathSync(process.cwd()),trace=[];let abortAfterPreflight=false,failClose=false,failRetire=false,controller;
 const parent=path.join(owned,'.local/state/blizhniy/local-primary-private');fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const state={version:1,project,origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:'a'.repeat(64),containerName:'blizhniy-primary-local-123456abcdef',dbPort:45678,database:'blizhniy_prod',ownerPassword:'b'.repeat(64),runtimePassword:'c'.repeat(64),rateSecret:'d'.repeat(64)};
 for(const [name,value] of [['state.json',state],['refunds.json',{version:1,project,containerId:state.containerId,workerPassword:'e'.repeat(64),operatorPassword:'f'.repeat(64)}],['media-retention.json',{version:1,project,containerId:state.containerId,password:'1'.repeat(64)}]])fs.writeFileSync(path.join(parent,name),JSON.stringify(value),{mode:0o600});
 os.homedir=()=>owned;
 const certificate='synthetic-public-certificate',metadata={Id:state.containerId,Name:'/'+state.containerName,State:{Running:true},Config:{Image:'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',Labels:{'blizhniy.primary-local':project}},HostConfig:{NetworkMode:'bridge',PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:''}]}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(state.dbPort)}]}}};
 child.execFile=(file,args,options,callback)=>{assert.equal(file,'/usr/bin/docker');queueMicrotask(()=>callback(null,{stdout:args.includes('inspect')?JSON.stringify([metadata]):certificate,stderr:''}));};syncBuiltinESMExports();
 const originalLoad=Module._load;Module._load=function(request,...rest){if(request==='./local-primary-modules.cjs')return{loadLocalPrimaryModule:name=>({postgres:{readPostgresConfig:env=>{assert.equal(env.BLIZHNIY_DB_USER,'blizhniy_media_cleanup');assert.equal(env.BLIZHNIY_DB_CA_FILE,path.join(parent,'refund-db-ca.pem'));return{ssl:{ca:certificate,rejectUnauthorized:true}};},PostgresDatabase:class{constructor(pool){assert.equal(pool.config.max,2);}async transaction(){trace.push('preflight');if(abortAfterPreflight)controller.abort();}async close(){trace.push('close');if(failClose)throw Error('private database details');}}},'media-file-worker':{createLocalMediaFileWorker:async(app,root)=>{assert.equal(app,project);assert.equal(root,path.join(parent,'media'));trace.push('files');return{};}},'media-retirement':{LocalMediaRetirement:class{async retire(id,signal){assert.equal(signal,controller.signal);trace.push('retire');if(failRetire)throw Error('private path');return{id,status:'completed'};}}}}[name])};return originalLoad.call(this,request,...rest);};
 pg.Pool=class{constructor(config){trace.push('pool');this.config=config;}};
 Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_MEDIA_RETENTION:'local-v1'});
 try{
  const {retireLocalPrimaryMedia}=await import('./scripts/local-primary-media-retention.mjs'),id='12345678-1234-4123-8123-123456789abc';controller=new AbortController();
  assert.equal((await retireLocalPrimaryMedia({id,signal:controller.signal,stateFile:'/copied/state.json'})).status,'completed');assert.deepEqual(trace,['pool','preflight','files','retire','close']);
  trace.length=0;abortAfterPreflight=true;controller=new AbortController();await assert.rejects(retireLocalPrimaryMedia({id,signal:controller.signal}),{message:'Local media cleanup unavailable'});assert.deepEqual(trace,['pool','preflight','close']);abortAfterPreflight=false;
  for(const failure of ['retire','close']){trace.length=0;controller=new AbortController();failRetire=failure==='retire';failClose=failure==='close';await assert.rejects(retireLocalPrimaryMedia({id,signal:controller.signal}),{message:'Local media cleanup unavailable'});assert.equal(trace.at(-1),'close');}failRetire=false;failClose=false;
  trace.length=0;await assert.rejects(retireLocalPrimaryMedia({id:'invalid'}));assert.deepEqual(trace,[]);
  delete process.env.BLIZHNIY_MEDIA_RETENTION;await assert.rejects(retireLocalPrimaryMedia({id}));assert.deepEqual(trace,[]);
 }finally{fs.rmSync(owned,{recursive:true,force:true});}
 `;
 execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{cwd:process.cwd(),env:{PATH:process.env.PATH,LANG:'C.UTF-8'},stdio:'pipe',timeout:10000});
});
