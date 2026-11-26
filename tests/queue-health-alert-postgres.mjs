import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { runQueueHealthAlert } from '../scripts/queue-health-alert.mjs';

export async function testQueueHealthAlert(t,{admin,config,load,verifyFinance}){
 const apply=async file=>admin.query(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
 await apply('operations/queue-health.sql');
 const user='blizhniy_queue_monitor',password=randomBytes(24).toString('hex');
 await admin.query('create role '+user+' login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '+pg.escapeLiteral(password));
 await apply('permissions/queue-health.sql');
 await verifyFinance();
 const db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user,password,max:1}));
 t.after(()=>db.close());
 for(const statement of [
  'select email from app.users','select payload from app.mail_outbox',
  'select endpoint from app_push.subscriptions',
  'select * from notification_delivery.business_email',
  'select * from app.payment_reconciliation_jobs',
  "select app.payment_reconciliation_alert_needed('synthetic-other-shop')",
  'create table operations_health.extra(id bigint)',
 ]){
  await assert.rejects(db.query(statement),{code:'42501'});
 }
 await assert.rejects(db.query("select * from operations_health.queue_backlog('wrong shop')"),{code:'22023'});
 const status=async()=>(await db.query('select * from operations_health.queue_backlog($1)',['synthetic-queue-other-shop'])).rows[0];
 assert.deepEqual(await status(),{auth_mail:false,business_email:false,push:false,payment_test:false});
 const account=randomUUID(),token=randomBytes(32).toString('hex'),hash=load('identity').hashSessionToken(token),authJob=randomUUID();
 await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
  [account,account+'@operations.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
 await admin.query("insert into app.cabinet_profiles(user_id,profile) values($1,'{\"pushNotifications\":true}')",[account]);
 await admin.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash,account]);
 await admin.query('insert into app_push.subscriptions(session_hash,endpoint,p256dh,auth) values($1,$2,$3,$4)',
  [hash,'https://fcm.googleapis.com/fcm/send/operations-'+account,'A'.repeat(87),'A'.repeat(22)]);
 const event=(await admin.query(`insert into app.notifications(user_id,event_key,category,tone,title,body)
  values($1,'queue-health-fixture','booking','info','Тестовый заголовок','Тестовое содержимое') returning id`,[account])).rows[0].id;
 await admin.query(`insert into app.mail_outbox(id,user_id,purpose,key_id,payload,created_at,expires_at,available_at)
  values($1,$2,'recover',$3,$4,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '10 minutes',
   clock_timestamp()-interval '3 minutes')`,[authJob,account,'f'.repeat(32),Buffer.concat([Buffer.from([1]),randomBytes(40)])]);
 await admin.query("update notification_delivery.business_email set available_at=clock_timestamp()-interval '6 minutes' where notification_id=$1",[event]);
 await admin.query(`update app_push.deliveries set state='sending',attempts=1,claim_id=$2,lease_until=clock_timestamp()-interval '2 minutes'
  where notification_id=$1`,[event,randomUUID()]);
 assert.deepEqual(await status(),{auth_mail:true,business_email:true,push:true,payment_test:false});

 const directory=await mkdtemp(join(tmpdir(),'blizhniy-postgres-queue-health-'));
 t.after(()=>rm(directory,{recursive:true}));
 const messages=[];
 const run=()=>runQueueHealthAlert({db,database:config.database,shop:'synthetic-queue-other-shop',directory,
  recipient:'operator@example.invalid',notify:async message=>messages.push(message)});
 const alerts=await run();
 assert.deepEqual(alerts.filter(row=>row.delivery==='accepted').map(row=>row.result),['auth-mail-backlog','business-email-backlog','push-backlog']);
 await run();
 assert.equal(messages.length,3);
 await admin.query("update app.mail_outbox set available_at=clock_timestamp()+interval '1 minute' where id=$1",[authJob]);
 await admin.query("update notification_delivery.business_email set available_at=clock_timestamp()+interval '1 minute' where notification_id=$1",[event]);
 await admin.query("update app_push.deliveries set state='unknown',claim_id=null,lease_until=null,last_code='unknown' where notification_id=$1",[event]);
 assert.ok((await run()).every(row=>row.delivery==='healthy'));
 assert.equal(messages.filter(row=>row.subject.endsWith('очередь восстановлена')).length,3);
 assert.doesNotMatch(JSON.stringify(messages),/Тестовое содержимое|synthetic-queue-other-shop/);
}
