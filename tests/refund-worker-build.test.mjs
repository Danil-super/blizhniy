import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

test('isolated refund artifact loads both canonical consumers and its complete schema guard in plain Node',async()=>{
 const {buildRefundWorker}=await import('../scripts/build-refund-worker.mjs');
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-refund-build-'));
 try{
  const destination=join(owned,'artifact'),manifest=buildRefundWorker(destination);
  assert.equal(manifest.schema,54);
  for(const name of ['placement-refund-worker','application-compensation-worker','postgres'])assert.ok(manifest.sources.includes('lib/'+name+'.js'));
  assert.ok(manifest.sources.every(path=>/^lib\/[a-z0-9-]+\.js$/.test(path)));
  for(const path of ['src','scripts/bootstrap-postgres.mjs','scripts/payment-worker.mjs','scripts/payment-worker-runtime.mjs'])assert.equal(existsSync(join(destination,path)),false);
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
  const script=`
   import assert from 'node:assert/strict';
   import {createRequire} from 'node:module';
   import net from 'node:net';
   let queries=0,http=0,network=0,poolCalls=0;
   const forbidden=()=>{network++;throw Error('Network forbidden');};
   globalThis.fetch=forbidden;net.Socket.prototype.connect=forbidden;
   const require=createRequire(import.meta.url),pg=require('pg');
   pg.Pool.prototype.query=pg.Pool.prototype.connect=()=>{poolCalls++;throw Error('Database forbidden');};
   const {PostgresDatabase}=require('./compiled/lib/postgres.js');
   const {createPlacementRefundWorker}=require('./compiled/lib/placement-refund-worker.js');
   const {createApplicationCompensationWorker}=require('./compiled/lib/application-compensation-worker.js');
   const {getRefundWorkerRolePlan,verifyRefundWorkerDatabase}=await import('./scripts/refund-worker-role.mjs');
   const {createLocalRefundWorkerRuntime}=await import('./scripts/local-refund-worker-runtime.mjs');
   const {runRefundWorkerService}=await import('./scripts/refund-worker-service.mjs');
   assert.equal(typeof createLocalRefundWorkerRuntime,'function');assert.equal(typeof runRefundWorkerService,'function');
   const db={transaction:async()=>{queries++;throw Error('synthetic');}};
   const fetcher=async()=>{http++;throw Error('Network forbidden');};
   const merchant={shopId:'synthetic',isTest:true,secretKey:'test_synthetic'};
   const workers=[createPlacementRefundWorker(db,merchant,fetcher),createApplicationCompensationWorker(db,merchant,fetcher)];
   assert.deepEqual({queries,http,network,poolCalls},{queries:0,http:0,network:0,poolCalls:0});
   for(const worker of workers)await assert.rejects(worker.tick());
   console.log(JSON.stringify({postgres:typeof PostgresDatabase,preflight:typeof verifyRefundWorkerDatabase,journal:getRefundWorkerRolePlan('fixture').journal.length,queries,http,network,poolCalls}));
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:destination,env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{postgres:'function',preflight:'function',journal:54,queries:2,http:0,network:0,poolCalls:0});
  const {getRefundWorkerRolePlan}=await import('../scripts/refund-worker-role.mjs');
  for(const {name,sha256} of getRefundWorkerRolePlan('fixture').journal)
   assert.equal(createHash('sha256').update(readFileSync(join(destination,'database/migrations',name))).digest('hex'),sha256);
  assert.deepEqual(readFileSync(join(destination,'database/refund-schema-0054.json')),readFileSync(new URL('../database/refund-schema-0054.json',import.meta.url)));
  const before=readFileSync(join(destination,'manifest.json'));
  assert.throws(()=>buildRefundWorker(destination),/destination|exists/i);
  assert.deepEqual(readFileSync(join(destination,'manifest.json')),before);
  assert.throws(()=>buildRefundWorker('.'),/destination|exists/i);
  const alias=join(owned,'alias');symlinkSync(owned,alias,'dir');
  assert.throws(()=>buildRefundWorker(join(alias,'rejected')),/destination/i);
  assert.equal(existsSync(join(owned,'rejected')),false);
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/build-refund-worker.mjs',import.meta.url))],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.match(cli.stderr,/Refund worker build failed/);
 }finally{rmSync(owned,{recursive:true,force:true});}
});

test('refund build refuses a migration changed after journal calculation without creating a complete artifact',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-refund-build-race-'));
 try{
  const destination=join(owned,'rejected');
  const script=`
   import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const read=fs.readFileSync;let replaced=0;
   fs.readFileSync=(path,...args)=>{
    const bytes=read(path,...args);
    if(typeof path==='string'&&path.endsWith('/database/migrations/0054-refund-worker-locks.sql')){replaced++;return Buffer.concat([bytes,Buffer.from('\\n-- synthetic replacement\\n')]);}
    return bytes;
   };
   syncBuiltinESMExports();
   const {buildRefundWorker}=await import(process.argv[2]);
   assert.throws(()=>buildRefundWorker(process.argv[1]),/Refund migration changed during build/);
   assert.equal(fs.existsSync(process.argv[1]),false);assert.equal(replaced,1);
   console.log(JSON.stringify({refused:true}));
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,destination,new URL('../scripts/build-refund-worker.mjs',import.meta.url).href],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{refused:true});
 }finally{rmSync(owned,{recursive:true,force:true});}
});
