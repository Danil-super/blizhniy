import assert from 'node:assert/strict';
import {grantWorkPublicationPermissions} from '../scripts/grant-work-publications.mjs';
export async function testWorkPublicationGrants(suite,admin,config){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`;
 await suite.test('work permission expansion refuses changed migration hashes before any new grant',async()=>{
  const original=(await admin.query("select sha256 from blizhniy_meta.migrations where name='0016-work-publications.sql'")).rows[0].sha256;
  await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0016-work-publications.sql'",['0'.repeat(64)]);
  try{await assert.rejects(grantWorkPublicationPermissions(admin,target));
   assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.work_publications','SELECT') as access")).rows[0].access,false);
  }finally{await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0016-work-publications.sql'",[original]);}
 });
 await suite.test('work grants enable only the pinned form/photo/review column surface and preserve all prior journal entries',async()=>{
  const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  assert.deepEqual(await grantWorkPublicationPermissions(admin,target),{tables:3});assert.deepEqual(await grantWorkPublicationPermissions(admin,target),{tables:3});
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
  const check=(await admin.query("select has_column_privilege('blizhniy_runtime','app.work_publications','form','UPDATE') as form,has_column_privilege('blizhniy_runtime','app.work_publications','is_paid','UPDATE') as payment,has_column_privilege('blizhniy_runtime','app.work_publications','author_id','UPDATE') as owner,has_table_privilege('blizhniy_runtime','app.work_publications','DELETE') as deletion")).rows[0];
  assert.deepEqual(check,{form:true,payment:false,owner:false,deletion:false});
 });
 await suite.test('work grant repair refuses residual financial and delegation powers instead of silently adopting or revoking them',async()=>{
  await admin.query('grant update(is_paid) on app.work_publications to blizhniy_runtime');
  try{await assert.rejects(grantWorkPublicationPermissions(admin,target));}finally{await admin.query('revoke update(is_paid) on app.work_publications from blizhniy_runtime');}
  await admin.query('grant update(form) on app.work_publications to blizhniy_runtime with grant option');
  try{await assert.rejects(grantWorkPublicationPermissions(admin,target));}finally{await admin.query('revoke grant option for update(form) on app.work_publications from blizhniy_runtime');}
 });
 await suite.test('unknown work-grant COMMIT acknowledgement is not automatically retried',async()=>{
  const query=admin.query.bind(admin);let commits=0;
  admin.query=async(...args)=>{const value=await query(...args);if(args[0]==='commit'){commits++;throw Error('Synthetic lost acknowledgement');}return value;};
  try{await assert.rejects(grantWorkPublicationPermissions(admin,target));assert.equal(commits,1);}finally{admin.query=query;}
 });
}
