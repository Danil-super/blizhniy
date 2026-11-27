import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {createTimewebMailer} from '../src/lib/timeweb-mail.ts';
import {workPublicationModule} from './work-publication-module.mjs';

export async function testBusinessEmail(suite,admin,config,credentials){
 const execute=path=>readFile(new URL('../database/'+path,import.meta.url),'utf8').then(sql=>admin.query(sql));
 const password=randomBytes(24).toString('hex'),user='blizhniy_business_email';
 const recipients=Array.from({length:3},()=>randomUUID());
 const addresses=recipients.map(id=>`email-${id}@example.invalid`);
 const [a,b,c]=recipients;
 let worker,producer;
 await suite.test('new business events enqueue once and the restricted worker reads only recipient and delivery state',async()=>{
  await execute('candidates/0085-business-email.sql');
  await admin.query(`create role ${user} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)}`);
  await execute('permissions/business-email.sql');
  worker=new PostgresDatabase(new pg.Pool({...config,user,password}));
  producer=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password}));
  const {enqueueNotificationInTransaction}=workPublicationModule('postgres-notification-inbox');
  const event=(key,category='booking')=>({eventKey:`s52:${key}`,category,tone:'info',title:'Синтетический заголовок',body:'Приватное содержимое тестового события',actionHref:'/cabinet/bronirovaniya',bookingRequestId:null});
  const enqueue=(id,input)=>producer.transaction(tx=>enqueueNotificationInTransaction(tx,id,input));
  const prefs=(id,profile)=>admin.query(`insert into app.cabinet_profiles(user_id,profile) values($1,$2)
   on conflict(user_id) do update set profile=excluded.profile`,[id,profile]);
  const state=async id=>(await admin.query('select state,attempts,last_code from notification_delivery.business_email where notification_id=$1',[id])).rows[0];
  const {runBusinessEmailBatch}=await import('../src/lib/business-email-worker.ts');
  const sent=[];
  let providerFailure;
  const mailer=createTimewebMailer({BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'local-fixture-only'},
   ()=>({verify:async()=>true,async sendMail(message){
    sent.push(message);
    if(providerFailure)throw providerFailure;
    return{accepted:message.envelope.to,rejected:[]};
   }}));
  const run=()=>runBusinessEmailBatch(worker,mailer);
  try{
   for(const [i,id] of recipients.entries())await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,addresses[i],`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   assert.equal((await worker.query('select current_user as role')).rows[0].role,user);
   assert.equal((await admin.query('select count(*)::int as n from notification_delivery.business_email')).rows[0].n,0);
   await assert.rejects(worker.query('select email from app.users'),{code:'42501'});
   await assert.rejects(worker.query('select * from notification_delivery.business_email'),{code:'42501'});
   await assert.rejects(producer.query('select * from notification_delivery.claim_business_email($1)',[randomUUID()]),{code:'42501'});
   await prefs(b,{notifyBookings:false});
   await prefs(c,{emailNotifications:false});
   const [first,duplicate]=await Promise.all([enqueue(a,event('received')),enqueue(a,event('received'))]);
   assert.equal(first,duplicate);
   const categoryOff=await enqueue(b,event('received'));
   const emailOff=await enqueue(c,event('received'));
   assert.equal(await state(categoryOff),undefined);
   assert.equal(await state(emailOff),undefined);
   await prefs(b,{notifyBookings:true});
   await prefs(c,{emailNotifications:true});
   assert.equal(await enqueue(b,event('received')),categoryOff);
   assert.equal(await enqueue(c,event('received')),emailOff);
   assert.equal(await state(categoryOff),undefined);
   assert.equal(await state(emailOff),undefined);
   await assert.rejects(producer.transaction(async tx=>{await enqueueNotificationInTransaction(tx,a,event('rolled-back'));throw Error('domain rollback');}),/domain rollback/);
   await Promise.all([run(),run()]);
   assert.deepEqual(await state(first),{state:'accepted',attempts:1,last_code:'accepted'});
   assert.deepEqual(sent.map(mail=>mail.envelope.to),[[addresses[0]]]);
   assert.equal(sent[0].messageId,`<${first}@xn----9sbphbgks4a4a.xn--p1ai>`);
   assert.doesNotMatch(sent[0].text,/Приватное содержимое|Синтетический заголовок|бронь/);
   assert.match(sent[0].text,/https:\/\/xn----9sbphbgks4a4a\.xn--p1ai\/cabinet/);

   const changed=await enqueue(a,event('disabled-after-queue'));
   const blocked=await enqueue(b,event('blocked-after-queue','publication'));
   const expired=await enqueue(a,event('expired'));
   await admin.query("update notification_delivery.business_email set queued_at=clock_timestamp()-interval '25 hours' where notification_id=$1",[expired]);
   await prefs(a,{emailNotifications:false});
   await admin.query('update app.users set is_blocked=true where id=$1',[b]);
   await run();
   assert.equal((await state(changed)).state,'cancelled');
   assert.equal((await state(blocked)).state,'cancelled');
   assert.equal((await state(expired)).last_code,'expired');
   assert.equal(sent.length,1);
   await prefs(a,{emailNotifications:true});
   const categoryChanged=await enqueue(a,event('category-off-after-queue','message'));
   await prefs(a,{notifyMessages:false});
   await run();
   assert.equal((await state(categoryChanged)).state,'cancelled');
   assert.equal(sent.length,1);
   await prefs(a,{});

   const transient=await enqueue(a,event('definitive-smtp-4xx'));
   providerFailure={responseCode:450};
   await run();
   assert.deepEqual(await state(transient),{state:'ready',attempts:1,last_code:'TEMPORARY'});
   await run();
   assert.equal(sent.length,2);
   await admin.query('update notification_delivery.business_email set available_at=clock_timestamp() where notification_id=$1',[transient]);
   providerFailure=undefined;
   await run();
   assert.deepEqual(await state(transient),{state:'accepted',attempts:2,last_code:'accepted'});
   assert.equal(sent[1].messageId,sent[2].messageId);

   const unknown=await enqueue(a,event('smtp-ack-lost'));
   providerFailure=Error('Synthetic provider response missing');
   await run();
   assert.deepEqual(await state(unknown),{state:'unknown',attempts:1,last_code:'UNKNOWN'});
   await run();
   assert.equal(sent.length,4);

   const stranded=await enqueue(a,event('process-crash'));
   const claim=randomUUID();
   assert.equal((await worker.query('select * from notification_delivery.claim_business_email($1)',[claim])).rows[0].id,stranded);
   assert.equal((await worker.query("select notification_delivery.finish_business_email($1,$2,'accepted') as state",[stranded,randomUUID()])).rows[0].state,null);
   await admin.query("update notification_delivery.business_email set lease_until=clock_timestamp()-interval '1 second' where notification_id=$1",[stranded]);
   await run();
   assert.deepEqual(await state(stranded),{state:'unknown',attempts:1,last_code:'lost_worker'});
   await assert.rejects(execute('candidates/0085-business-email.down.sql'),/journal is not empty/i);
   await admin.query('rollback');
   assert.equal(sent.length,4);
   const finishLost=await enqueue(a,event('db-finish-ack-lost'));
   providerFailure=undefined;
   const lostAck={async query(sql,values){
    const result=await worker.query(sql,values);
    if(sql.includes('finish_business_email'))throw Error('Synthetic commit acknowledgement lost');
    return result;
   }};
   await assert.rejects(runBusinessEmailBatch(lostAck,mailer),/commit acknowledgement lost/);
   await run();
   assert.deepEqual(await state(finishLost),{state:'accepted',attempts:1,last_code:'accepted'});
   assert.equal(sent.length,5);
  }finally{
   await worker?.close();await producer?.close();
   await admin.query('delete from app.users where id=any($1::uuid[])',[recipients]);
   await execute('candidates/0085-business-email.down.sql');
  }
 });
}
