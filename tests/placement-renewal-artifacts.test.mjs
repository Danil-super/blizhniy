import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {getRefundOperatorRolePlan} from '../scripts/refund-operator-role.mjs';
test('both local56 artifacts contain exact copied bytes, snapshots and offline-loadable modules; defaults remain old boundaries',()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-renewal-artifacts-'));
 try{
  assert.equal(getRefundOperatorRolePlan('artifact').journal.length,55);
  for(const [name,build] of [['operator',buildRefundOperator],['worker',buildRefundWorker]]){
   const path=join(owned,name),result=build(path,{schema:56});assert.equal(result.schema,56);assert.deepEqual(JSON.parse(readFileSync(join(path,'manifest.json'),'utf8')),result);
   for(const {name,sha256} of getRefundOperatorRolePlan('artifact',{schema:56}).journal)assert.equal(createHash('sha256').update(readFileSync(join(path,'database/migrations',name))).digest('hex'),sha256);
   for(const profile of ['refund-schema-0056.json','refund-schema-local-primary-0056.json'])assert.deepEqual(readFileSync(join(path,'database',profile)),readFileSync(new URL('../database/'+profile,import.meta.url)));
   symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(path,'node_modules'),'dir');
   const proof=execFileSync(process.execPath,['--input-type=module','-e',`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);let calls=0;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};Object.defineProperty(require('pg'),'Pool',{value:class{constructor(){calls++;throw Error('pool forbidden');}}});await import('./scripts/local-refund-${name}-runtime.mjs');for(const file of ${JSON.stringify(result.sources)})require('./compiled/'+file);if(calls!==0)throw Error('Import started work');console.log('offline');`],{cwd:path,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},encoding:'utf8',timeout:10000});assert.equal(proof.trim(),'offline');
   const rejected=join(owned,name+'-58');assert.throws(()=>build(rejected,{schema:58}));assert.equal(existsSync(rejected),false);
  }
 }finally{rmSync(owned,{recursive:true,force:true});}
});
