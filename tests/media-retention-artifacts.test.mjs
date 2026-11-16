import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';
import {getRefundOperatorRolePlan} from '../scripts/refund-operator-role.mjs';
test('local58 artifacts load the copied candidate and exact schema without broadening financial rights',async()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-media58-artifacts-'));
 try{
  for(const [name,build,plan] of [['worker',buildRefundWorker,getRefundWorkerRolePlan],['operator',buildRefundOperator,getRefundOperatorRolePlan]]){
   assert.throws(()=>plan('artifact',{schema:58}));assert.throws(()=>plan('artifact',{schema:59,localPrimary:true}));
   assert.throws(()=>build(join(owned,name+'-denied'),{schema:58}));assert.throws(()=>build(join(owned,name+'-unknown'),{schema:59,localPrimary:true}));
   assert.deepEqual(plan('artifact',{schema:58,localPrimary:true}).grants,plan('artifact',{schema:57}).grants);
   const path=join(owned,name),manifest=build(path,{schema:58,localPrimary:true});assert.equal(manifest.schema,58);
   const module=await import(pathToFileURL(join(path,'scripts/refund-'+name+'-role.mjs')));
   const copied=module[name==='worker'?'getRefundWorkerRolePlan':'getRefundOperatorRolePlan']('artifact',{schema:58,localPrimary:true});
   assert.deepEqual(copied,plan('artifact',{schema:58,localPrimary:true}));assert.equal(copied.journal.length,58);
   for(const {name,sha256} of copied.journal){const directory=name.startsWith('0058-')?'candidates':'migrations';assert.equal(createHash('sha256').update(readFileSync(join(path,'database',directory,name))).digest('hex'),sha256);}
   assert.deepEqual(readFileSync(join(path,'database/refund-schema-local-primary-0058.json')),readFileSync(new URL('../database/refund-schema-local-primary-0058.json',import.meta.url)));
   const {assertRefundSchema}=await import(pathToFileURL(join(path,'scripts/refund-worker-schema.mjs')));
   await assert.rejects(assertRefundSchema({query(){throw Error('must reject before SQL');}},58),/version/);
  }
 }finally{rmSync(owned,{recursive:true,force:true});}
});
