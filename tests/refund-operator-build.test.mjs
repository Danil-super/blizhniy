import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,readFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {getRefundOperatorRolePlan} from '../scripts/refund-operator-role.mjs';

test('private operator artifact imports existing approval/recovery without network, sending consumers or installed roles',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-operator-build-'));
 try{
  const artifact=join(owned,'artifact'),manifest=buildRefundOperator(artifact);assert.equal(manifest.schema,55);
  assert.ok(manifest.sources.includes('lib/postgres-refund-approvals.js'));assert.ok(manifest.sources.includes('lib/primary-refund-recovery.js'));
  for(const name of ['placement-refund-worker','application-compensation-worker','primary-yookassa-refund-sender'])assert.equal(manifest.sources.includes('lib/'+name+'.js'),false);
  for(const {name,sha256} of getRefundOperatorRolePlan('artifact').journal)assert.equal(createHash('sha256').update(readFileSync(join(artifact,'database/migrations',name))).digest('hex'),sha256);
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const script=`import assert from 'node:assert/strict';import net from 'node:net';import {createRequire} from 'node:module';
   let calls=0;globalThis.fetch=net.Socket.prototype.connect=()=>{calls++;throw Error('Network forbidden');};
   const require=createRequire(import.meta.url),{PostgresRefundApprovalStore}=require('./compiled/lib/postgres-refund-approvals.js'),{createPrimaryRefundRecovery}=require('./compiled/lib/primary-refund-recovery.js');
   const {verifyRefundOperatorDatabase}=await import('./scripts/refund-operator-role.mjs');
   const {createLocalRefundOperatorRuntime}=await import('./scripts/local-refund-operator-runtime.mjs');assert.equal(typeof createLocalRefundOperatorRuntime,'function');
   const {startLocalRefundOperatorServer}=await import('./scripts/local-refund-operator-server.mjs');assert.equal(typeof startLocalRefundOperatorServer,'function');
   const db={transaction:()=>{throw Error('Database forbidden');}},merchant={shopId:'synthetic',isTest:true,secretKey:'test_synthetic'};
   assert.equal(typeof new PostgresRefundApprovalStore(db,merchant).approve,'function');assert.equal(typeof createPrimaryRefundRecovery(db,merchant).recover,'function');
   assert.equal(typeof verifyRefundOperatorDatabase,'function');assert.equal(calls,0);console.log('offline');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:artifact,env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'offline');
  assert.equal(existsSync(join(artifact,'scripts/bootstrap-postgres.mjs')),false);assert.equal(existsSync(join(artifact,'scripts/refund-worker-service.mjs')),false);
  const before=readFileSync(join(artifact,'manifest.json'));assert.throws(()=>buildRefundOperator(artifact),/destination|exists/i);assert.deepEqual(readFileSync(join(artifact,'manifest.json')),before);
 }finally{rmSync(owned,{recursive:true,force:true});}
});

test('operator build refuses altered copied55 bytes before creating the destination',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-operator-build-race-'));
 try{
  const destination=join(owned,'rejected');
  const script=`import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const read=fs.readFileSync;let replaced=0;fs.readFileSync=(path,...args)=>{const bytes=read(path,...args);
    if(typeof path==='string'&&path.endsWith('/database/migrations/0055-refund-operator-locks.sql')){replaced++;return Buffer.concat([bytes,Buffer.from('\\n-- synthetic replacement\\n')]);}return bytes;};
   syncBuiltinESMExports();const {buildRefundOperator}=await import(process.argv[2]);
   assert.throws(()=>buildRefundOperator(process.argv[1]),/Refund migration changed during build/);assert.equal(replaced,1);assert.equal(fs.existsSync(process.argv[1]),false);`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,destination,new URL('../scripts/build-refund-operator.mjs',import.meta.url).href],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(existsSync(destination),false);
 }finally{rmSync(owned,{recursive:true,force:true});}
});
