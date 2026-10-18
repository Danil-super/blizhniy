import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {grantInteractionPermissions,getInteractionGrantPlan} from '../scripts/grant-interactions.mjs';
export async function testInteractionGrants(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`,runtime=new pg.Client({...config,...credentials});await runtime.connect();const owner=randomUUID();
 try{
  await suite.test('interaction grants require the exact target and all eighteen reviewed migration hashes',async()=>{
   const plan=getInteractionGrantPlan();assert.equal(plan.migrations.length,18);await assert.rejects(grantInteractionPermissions(admin,'wrong:target'));
   const last=plan.migrations.at(-1);await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',['0'.repeat(64),last.name]);
   try{await assert.rejects(grantInteractionPermissions(admin,target));await assert.rejects(runtime.query('select * from app.notifications limit 0'),{code:'42501'});}
   finally{await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',[last.sha256,last.name]);}
  });
  await suite.test('interaction runtime has only reviewed columns, never payment, identity, immutable booking values or hard deletion',async()=>{
   assert.deepEqual(await grantInteractionPermissions(admin,target),{tables:3});assert.deepEqual(await grantInteractionPermissions(admin,target),{tables:3});
   for(const table of ['applications','booking_requests','notifications'])assert.equal((await runtime.query(`select * from app.${table} limit 0`)).rowCount,0);
   for(const sql of ["update app.applications set is_paid=true where false","update app.applications set sent_at=clock_timestamp() where false","update app.applications set applicant_id=gen_random_uuid() where false",
    "update app.booking_requests set guest_id=gen_random_uuid() where false","update app.booking_requests set total=0 where false","update app.booking_requests set start_date=current_date where false",
    "update app.notifications set user_id=gen_random_uuid() where false","update app.notifications set body='Forged' where false",'delete from app.notifications where false','delete from app.applications where false','truncate app.booking_requests'])await assert.rejects(runtime.query(sql),{code:'42501'});
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`interaction-grants-${owner}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   const {id}=(await runtime.query("insert into app.notifications(user_id,event_key,category,tone,title,body,action_href) values($1,'synthetic:grant','system','info','Техническое уведомление','Проверка прав','/cabinet') returning id",[owner])).rows[0];
   assert.equal((await runtime.query('update app.notifications set read_at=clock_timestamp(),dismissed_at=clock_timestamp() where id=$1 returning id',[id])).rowCount,1);
  });
  await suite.test('interaction grant checks reject residual finance, maintenance and delegation authority instead of adopting it',async()=>{
   for(const [grant,revoke] of [['update(is_paid)','update(is_paid)'],['maintain','maintain'],['update(status) with grant option','grant option for update(status)']]){
    await admin.query(`grant ${grant.replace(' with grant option','')} on app.applications to blizhniy_runtime${grant.endsWith(' with grant option')?' with grant option':''}`);
    try{await assert.rejects(grantInteractionPermissions(admin,target));}finally{await admin.query(`revoke ${revoke} on app.applications from blizhniy_runtime`);}
   }
   await grantInteractionPermissions(admin,target);
  });
  await suite.test('an unknown interaction grant commit never triggers an automatic second grant transaction',async()=>{
   let commits=0;const uncertain={connectionParameters:admin.connectionParameters,query:async(sql,values)=>{const result=await admin.query(sql,values);if(sql==='commit'){commits++;throw Error('Synthetic lost commit');}return result;}};
   await assert.rejects(grantInteractionPermissions(uncertain,target));assert.equal(commits,1);
  });
 }finally{await admin.query('delete from app.users where id=$1',[owner]);await runtime.end();}
}
