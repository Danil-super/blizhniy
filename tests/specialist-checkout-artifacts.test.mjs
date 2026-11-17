import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';
import {getRefundOperatorRolePlan} from '../scripts/refund-operator-role.mjs';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';

test('local60 financial packages pin 59 exact migrations and preserve previous rights',async()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-specialist60-artifacts-'));
 try{
  for(const [name,build,plan] of [['worker',buildRefundWorker,getRefundWorkerRolePlan],['operator',buildRefundOperator,getRefundOperatorRolePlan]]){
   assert.throws(()=>plan('artifact',{schema:60}));
   assert.throws(()=>plan('artifact',{schema:59,localPrimary:true}));
   assert.throws(()=>plan('artifact',{schema:61,localPrimary:true}));
   assert.throws(()=>build(join(owned,name+'-denied'),{schema:60}));
   const expected=plan('artifact',{schema:60,localPrimary:true});
   assert.deepEqual(expected.grants,plan('artifact',{schema:58,localPrimary:true}).grants);
   assert.equal(expected.journal.length,59);assert.equal(expected.journal.at(-2).name,'0058-media-reference-journal.sql');
   assert.equal(expected.journal.at(-1).name,'0060-local-specialist-checkout.sql');
   assert.equal(expected.journal.some(row=>row.name.startsWith('0059-')),false);
   const path=join(owned,name),manifest=build(path,{schema:60,localPrimary:true});assert.equal(manifest.schema,60);
   const module=await import(pathToFileURL(join(path,'scripts/refund-'+name+'-role.mjs')));
   const copied=module[name==='worker'?'getRefundWorkerRolePlan':'getRefundOperatorRolePlan'];
   assert.deepEqual(copied('artifact',{schema:60,localPrimary:true}),expected);
   for(const {name,sha256} of expected.journal){
    const directory=/^(0058|0060)-/.test(name)?'candidates':'migrations';
    assert.equal(createHash('sha256').update(readFileSync(join(path,'database',directory,name))).digest('hex'),sha256);
   }
   assert.deepEqual(readFileSync(join(path,'database/refund-schema-local-primary-0060.json')),readFileSync(new URL('../database/refund-schema-local-primary-0060.json',import.meta.url)));
   const {assertRefundSchema}=await import(pathToFileURL(join(path,'scripts/refund-worker-schema.mjs')));
   await assert.rejects(assertRefundSchema({query(){throw Error('unexpected SQL');}},60),/version/);
   appendFileSync(join(path,'database/candidates/0060-local-specialist-checkout.sql'),'-- changed copied candidate\n');
   assert.throws(()=>copied('artifact',{schema:60,localPrimary:true}),/migration/);
  }
 }finally{rmSync(owned,{recursive:true,force:true});}
});

test('existing payment packages load shared guards while local60 remains unavailable to that worker',async()=>{
 const owned=mkdtempSync(join(tmpdir(),'blizhniy-specialist60-old-worker-'));
 try{
  assert.throws(()=>buildPaymentWorker(join(owned,'denied'),{schema:60}));
  for(const [name,options] of [['schema54',{schema:54}],['production36',{publicationTest:true}]]){
   const target=join(owned,name);buildPaymentWorker(target,options);
   const module=await import(pathToFileURL(join(target,'scripts/payment-reconciliation-role.mjs')));
   assert.equal(typeof module.verifyPaymentReconciliationDatabase,'function');
   const {getRefundWorkerRolePlan:plan}=await import(pathToFileURL(join(target,'scripts/refund-worker-role.mjs')));
   if(name==='schema54')assert.equal(plan('artifact').journal.length,54);
   assert.throws(()=>plan('artifact',{schema:60}));
  }
 }finally{rmSync(owned,{recursive:true,force:true});}
});
