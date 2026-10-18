import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
export async function testInteractionsSchema(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`,before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const runtime=new pg.Client({...config,...credentials});await runtime.connect();const owner=randomUUID(),guest=randomUUID();let listing,work,specialist,application,booking;
 const down=readFileSync(new URL('../database/migrations/0018-interactions.down.sql',import.meta.url),'utf8');
 try{
  await suite.test('interactions schema is opt-in, additive and preserves every earlier migration hash',async()=>{
   assert.equal(before.length,17);assert.equal((await bootstrapPostgres(admin,target,{includeInteractions:true})).applied,1);
   const after=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
   assert.deepEqual(after.slice(0,17),before);assert.deepEqual(after,getBootstrapPlan({includeInteractions:true}).map(({name,sha256})=>({name,sha256})));assert.equal((await bootstrapPostgres(admin,target,{includeInteractions:true})).applied,0);
  });
  await suite.test('new interaction tables are private and cannot be accessed by runtime before explicit grants',async()=>{
   for(const table of ['applications','booking_requests','notifications']){
    await assert.rejects(runtime.query(`select * from app.${table} limit 0`),{code:'42501'});
    const {exposed}=(await admin.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='app' and c.relname=$1 and a.grantee=0) as exposed",[table])).rows[0];assert.equal(exposed,false);
   }
   for(const id of [owner,guest])await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`interaction-schema-${id}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   listing=(await admin.query("insert into app.listings(author_id,listing_type,title) values($1,'rent','Техническое жильё') returning id",[owner])).rows[0].id;
   work=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',gen_random_uuid(),$2::jsonb) returning id",[owner,JSON.stringify({kind:'workRequest',title:'Технический заказ'})])).rows[0].id;
   specialist=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'specialist',gen_random_uuid(),$2::jsonb) returning id",[guest,JSON.stringify({kind:'specialist',title:'Технический специалист'})])).rows[0].id;
  });
  await suite.test('application SQL defaults unpaid and requires real paid delivery before employer states',async()=>{
   const key=randomUUID(),insert='insert into app.applications(applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,$4,1,1,$5::jsonb) returning id,status,is_paid,sent_at,revision::text';
   const values=[guest,work,specialist,key,JSON.stringify({name:'Технический специалист'})],row=(await admin.query(insert,values)).rows[0];application=row.id;
   assert.equal(row.status,'pending_payment');assert.equal(row.is_paid,false);assert.equal(row.sent_at,null);assert.equal(row.revision,'1');await assert.rejects(admin.query(insert,values),{code:'23505'});
   for(const sql of ["status='sent'","status='selected'","is_paid=true","revision=0","target_revision=0","updated_at='infinity'::timestamptz","snapshot='[]'::jsonb"])
    await assert.rejects(admin.query(`update app.applications set ${sql} where id=$1`,[application]),{code:'23514'});
   await admin.query('update app.applications set revision=9007199254740993 where id=$1',[application]);assert.equal((await admin.query('select revision::text from app.applications where id=$1',[application])).rows[0].revision,'9007199254740993');
  });
  await suite.test('booking periods, exact totals and pending decisions are enforced without accepting SQL NULL as approval',async()=>{
   const values=[listing,guest,randomUUID()],row=(await admin.query("insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot) values($1,$2,$3,'stay','2026-10-20','2026-10-22',2,1250.50,'{}') returning id,status,total::text,revision::text",values)).rows[0];booking=row.id;
   assert.equal(row.status,'pending');assert.equal(row.total,'1250.50');assert.equal(row.revision,'1');
   for(const sql of ["status='accepted'","end_date=null","end_date=start_date","end_date=start_date+31","total='NaN'::numeric","total=-1","guests=0","start_date='infinity'::date","revision=0"])
    await assert.rejects(admin.query(`update app.booking_requests set ${sql} where id=$1`,[booking]),{code:'23514'});
   await admin.query("update app.booking_requests set status='accepted',decided_at=clock_timestamp() where id=$1",[booking]);
  });
  await suite.test('notifications deduplicate each recipient event and refuse foreign navigation or malformed inbox records',async()=>{
   const insert="insert into app.notifications(user_id,event_key,category,tone,title,body,action_href,booking_request_id) values($1,'booking_request:synthetic','booking','info','Заявка','Техническое уведомление','/cabinet/obyavleniya',$2) returning id",values=[owner,booking];
   const {id}=(await admin.query(insert,values)).rows[0];await assert.rejects(admin.query(insert,values),{code:'23505'});
   for(const sql of ["action_href='https://foreign.invalid'","action_href='//foreign.invalid'","action_href='/cabinet?token=private'","category='unknown'","tone='unknown'","title=''","read_at='infinity'::timestamptz"])
    await assert.rejects(admin.query(`update app.notifications set ${sql} where id=$1`,[id]),{code:'23514'});
  });
  await suite.test('interaction rollback refuses any row, then removes only empty new tables and can reapply without changing history',async()=>{
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty interactions/);}finally{await admin.query('rollback');}
   assert.equal((await admin.query('select count(*)::int as n from app.applications where id=$1',[application])).rows[0].n,1);
   for(const id of [owner,guest])await admin.query('delete from app.users where id=$1',[id]);await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0018-interactions.sql'");
   assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);assert.equal((await bootstrapPostgres(admin,target,{includeInteractions:true})).applied,1);
  });
 }finally{for(const id of [owner,guest])await admin.query('delete from app.users where id=$1',[id]);await runtime.end();}
}
