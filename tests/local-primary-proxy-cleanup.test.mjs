import assert from 'node:assert/strict';import {test} from 'node:test';import {spawnSync} from 'node:child_process';

test('proxy startup unwinds both pools and the mail timer on auth and late TLS failures without reading the manual fixture',()=>{
 const script=`
  import assert from 'node:assert/strict';import fs from 'node:fs';import childProcess from 'node:child_process';import {syncBuiltinESMExports,createRequire} from 'node:module';import pg from 'pg';
  const state={project:process.cwd(),origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:'a'.repeat(64),containerName:'blizhniy-primary-local-123456789abc',dbPort:35432,database:'blizhniy_prod',runtimePassword:'b'.repeat(64),ownerPassword:'c'.repeat(64),rateSecret:'d'.repeat(64)};
  const metadata={Id:state.containerId,Name:'/'+state.containerName,Config:{Image:'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',Labels:{'blizhniy.primary-local':state.project}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'35432'}]}}};
  childProcess.execFile=(_cmd,args,_options,callback)=>{assert.equal(args.includes('inspect'),true);callback(null,{stdout:JSON.stringify([metadata])});};
  let stage,pools=0,closed=0,timers=0,cleared=0,network=0;
  globalThis.fetch=()=>{network++;throw Error('Network forbidden');};
  globalThis.setInterval=()=>{timers++;return{};};globalThis.clearInterval=value=>{if(value)cleared++;};
  pg.Pool=class{constructor(){pools++;}};
  const read=fs.promises.readFile;fs.promises.readFile=async(file,...args)=>{
   if(String(file).endsWith('/tls-key.pem')||String(file).endsWith('/tls-cert.pem')){if(stage==='read')throw Error('Synthetic TLS read failure');return Buffer.from('synthetic invalid PEM');}
   if(String(file).endsWith('/mail-key.bin'))return Buffer.alloc(32);
   if(String(file).includes('/.local/state/'))throw Error('Permanent fixture access forbidden');return read(file,...args);
  };syncBuiltinESMExports();
  const fake=()=>({}),require=createRequire(import.meta.url);
  require('./scripts/local-primary-modules.cjs').loadLocalPrimaryModule=name=>{
   if(name==='postgres')return{PostgresDatabase:class{async close(){closed++;}}};
   if(name==='production-auth-database')return{verifyProductionAuthDatabase:async()=>{if(stage==='auth')throw Error('Synthetic auth failure');}};
   if(name==='telegram-phone-config')return{readTelegramPhoneConfig:()=>null};
   return new Proxy({}, {get:()=>function(){return fake();}});
  };
  const {createLocalPrimaryProxy}=await import('./scripts/local-primary-proxy.mjs');
  for(stage of ['read','auth','tls']){pools=closed=timers=cleared=0;await assert.rejects(createLocalPrimaryProxy(state));assert.equal(pools,stage==='read'?0:2);assert.equal(closed,pools);assert.equal(timers,stage==='tls'?1:0);assert.equal(cleared,timers);}
  assert.equal(network,0);console.log('cleanup verified');
 `;
 const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'test'},encoding:'utf8',timeout:20000});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'cleanup verified');
});
