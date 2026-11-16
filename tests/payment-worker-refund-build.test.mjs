import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';

test('payment artifact carries exact schema54 admission metadata without compiling refund consumers or operators',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-payment-refund-build-'));
 try{
  const destination=join(owned,'artifact'),manifest=buildPaymentWorker(destination);
  for(const name of ['placement-refund-worker','application-compensation-worker','postgres-refund-approvals','primary-refund-recovery'])
   assert.equal(manifest.sources.includes('lib/'+name+'.js'),false);
  for(const {name,sha256} of getRefundWorkerRolePlan('fixture').journal)
   assert.equal(createHash('sha256').update(readFileSync(join(destination,'database/migrations',name))).digest('hex'),sha256);
  assert.deepEqual(readFileSync(join(destination,'database/refund-schema-0054.json')),readFileSync(new URL('../database/refund-schema-0054.json',import.meta.url)));
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
  const script=`import assert from 'node:assert/strict';import net from 'node:net';
   let calls=0;globalThis.fetch=net.Socket.prototype.connect=()=>{calls++;throw Error('Network forbidden');};
   const {verifyPaymentReconciliationDatabase,getPaymentReconciliationRolePlan}=await import('./scripts/payment-reconciliation-role.mjs');
   assert.equal(typeof verifyPaymentReconciliationDatabase,'function');assert.equal(getPaymentReconciliationRolePlan('fixture').journal.length,24);
   assert.equal(calls,0);console.log('offline');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:destination,env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'offline');
 }finally{rmSync(owned,{recursive:true,force:true});}
});

test('payment artifact rejects migration bytes changed after journal calculation before creating its destination',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-payment-refund-race-'));
 try{
  const destination=join(owned,'rejected');
  const script=`import assert from 'node:assert/strict';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const read=fs.readFileSync;let replaced=0;
   fs.readFileSync=(path,...args)=>{const bytes=read(path,...args);
    if(typeof path==='string'&&path.endsWith('/database/migrations/0054-refund-worker-locks.sql')){replaced++;return Buffer.concat([bytes,Buffer.from('\\n-- synthetic replacement\\n')]);}return bytes;};
   syncBuiltinESMExports();const {buildPaymentWorker}=await import(process.argv[3]);
   assert.throws(()=>buildPaymentWorker(process.argv[2]),/Worker migration changed during build/);
   assert.equal(fs.existsSync(process.argv[2]),false);assert.equal(replaced,1);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,fileURLToPath(import.meta.url),destination,new URL('../scripts/build-payment-worker.mjs',import.meta.url).href],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(existsSync(destination),false);
 }finally{rmSync(owned,{recursive:true,force:true});}
});
