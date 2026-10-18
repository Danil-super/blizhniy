import assert from 'node:assert/strict';import pg from 'pg';
import {grantServicePublicationPermissions,getServicePublicationGrantPlan} from '../scripts/grant-service-publications.mjs';
export async function testServicePublicationGrants(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`,runtime=new pg.Client({...config,...credentials});await runtime.connect();
 try{
  await suite.test('service grants pin all seventeen hashes and reject mismatched targets or history before assigning privileges',async()=>{
   const plan=getServicePublicationGrantPlan();assert.equal(plan.migrations.length,17);assert.equal(plan.tables.length,3);
   await assert.rejects(grantServicePublicationPermissions(admin,'wrong:target'));
   const last=plan.migrations.at(-1);await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',['0'.repeat(64),last.name]);
   try{await assert.rejects(grantServicePublicationPermissions(admin,target));await assert.rejects(runtime.query('select * from app.service_publications limit 0'),{code:'42501'});}
   finally{await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',[last.sha256,last.name]);}
  });
  await suite.test('service grants permit only form, associations and review columns, never payment, owner, publication dates or row deletion',async()=>{
   assert.deepEqual(await grantServicePublicationPermissions(admin,target),{tables:3});assert.deepEqual(await grantServicePublicationPermissions(admin,target),{tables:3});
   for(const table of ['service_publications','service_publication_photos','service_moderation'])assert.equal((await runtime.query(`select * from app.${table} limit 0`)).rowCount,0);
   for(const sql of ["update app.service_publications set status='published' where false",'update app.service_publications set is_paid=true where false',
    'update app.service_publications set author_id=gen_random_uuid() where false','update app.service_publications set published_at=now() where false',
    'delete from app.service_publications where false','truncate app.service_publications'])await assert.rejects(runtime.query(sql),{code:'42501'});
  });
  await suite.test('service grants refuse residual financial, maintenance and delegation powers rather than silently adopting them',async()=>{
   for(const [grant,revoke] of [['update(status)','update(status)'],['maintain','maintain'],['update(form) with grant option','grant option for update(form)']]){
    await admin.query(`grant ${grant.replace(' with grant option','')} on app.service_publications to blizhniy_runtime${grant.endsWith(' with grant option')?' with grant option':''}`);
    try{await assert.rejects(grantServicePublicationPermissions(admin,target));}
    finally{await admin.query(`revoke ${revoke} on app.service_publications from blizhniy_runtime`);}
   }
   await grantServicePublicationPermissions(admin,target);
  });
  await suite.test('unknown service-grant commit result never starts a second transaction or automatic retry',async()=>{
   let commits=0;const uncertain={connectionParameters:admin.connectionParameters,query:async(sql,values)=>{const result=await admin.query(sql,values);if(sql==='commit'){commits++;throw Error('Synthetic lost commit');}return result;}};
   await assert.rejects(grantServicePublicationPermissions(uncertain,target));assert.equal(commits,1);
  });
 }finally{await runtime.end();}
}
