import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {startLocalPrimaryRefunds} from '../scripts/local-primary-refunds.mjs';
import {getRefundWorkerRolePlan} from '../scripts/refund-worker-role.mjs';
import {assertRefundSchema} from '../scripts/refund-worker-schema.mjs';
import {mediaRetentionRuntimeGrants} from '../scripts/media-retention-role.mjs';
import {specialistCheckoutRuntimeGrants} from '../scripts/specialist-checkout-release.mjs';

/** Extend only the parent's disposable TLS fixture after all its schema55 assertions. */
export async function testSpecialistCheckoutRefundActivation(suite,{admin,stateFile,load,actor,token}){
 const local={NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_MEDIA_RETENTION:'local-v1',BLIZHNIY_SPECIALIST_CHECKOUT:'disabled'};
 const saved=Object.fromEntries(Object.keys(local).map(key=>[key,process.env[key]]));let service;
 try{
  Object.assign(process.env,local);
  for(const {name,sha256} of getRefundWorkerRolePlan('blizhniy_prod',{schema:60,localPrimary:true}).journal.slice(55)){
   await admin.query(await readFile(new URL('../database/'+(/^(0058|0060)-/.test(name)?'candidates/':'migrations/')+name,import.meta.url),'utf8'));
   await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
  }
  for(const grant of [...mediaRetentionRuntimeGrants,...specialistCheckoutRuntimeGrants])await admin.query(grant);
  const snapshot=await admin.connect();try{await snapshot.query('begin read only');await assertRefundSchema(snapshot,60,{localPrimary:true});}finally{await snapshot.query('rollback');snapshot.release();}
  await suite.test('actual owned TLS refund launcher restarts on installed60 with specialist mode disabled or enabled',async()=>{
   for(const mode of ['disabled','local-v1']){
    process.env.BLIZHNIY_SPECIALIST_CHECKOUT=mode;const events=[];
    service=await startLocalPrimaryRefunds({stateFile,signal:new AbortController().signal,report:async event=>events.push(event)});
    assert.equal(events[0].status,'ready');
    assert.ok((await load('local-refund-operator-client').callLocalRefundOperator(service.socketPath,token,{action:'list',expectedAdminId:actor,input:null})).items.length>0);
    const sessions=(await admin.query("select s.ssl from pg_stat_activity a join pg_stat_ssl s using(pid) where a.application_name in('blizhniy-local-refund-provider','blizhniy-local-refund-worker','blizhniy-local-refund-operator')")).rows;
    assert.ok(sessions.length>=3);assert.ok(sessions.every(row=>row.ssl));
    await service.close();assert.equal(await service.done,0);service=undefined;
    assert.equal((await readdir(dirname(stateFile))).filter(name=>name.startsWith('refund-runtime-')).length,0);
   }
  });
  await suite.test('actual launcher rejects changed60 before readiness and removes temporary artifacts/connections',async()=>{
   let events=0;await admin.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0060-local-specialist-checkout.sql'");
   try{await assert.rejects(startLocalPrimaryRefunds({stateFile,signal:new AbortController().signal,report:async()=>events++}),{message:'Local primary refunds unavailable'});assert.equal(events,0);}
   finally{const row=getRefundWorkerRolePlan('blizhniy_prod',{schema:60,localPrimary:true}).journal.at(-1);await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',[row.sha256,row.name]);}
   assert.equal((await readdir(dirname(stateFile))).filter(name=>name.startsWith('refund-runtime-')).length,0);
   assert.equal((await admin.query("select count(*)::int n from pg_stat_activity where application_name='blizhniy-local-refund-provider'")).rows[0].n,0);
  });
 }finally{try{await service?.close();}finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
