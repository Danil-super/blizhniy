import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {workPublicationModule} from './work-publication-module.mjs';
import {loadAdminModule} from './admin-module.mjs';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';

export async function testNotificationInbox(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const {PostgresNotificationInbox,enqueueNotificationInTransaction}=workPublicationModule('postgres-notification-inbox');
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'});
 const users=[],store=new PostgresNotificationInbox(db),event=(key,title='Техническое уведомление')=>({eventKey:key,category:'system',tone:'info',title,body:'Синтетическое сообщение',actionHref:'/cabinet',bookingRequestId:null});
 let notice;
 try{
  for(let i=0;i<2;i++){
   const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`inbox-${id}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  }
  const [owner,other]=users;
  const enqueue=(recipient,input)=>db.transaction(tx=>enqueueNotificationInTransaction(tx,recipient,input));
  await suite.test('server inbox events deduplicate concurrently, reject changed payloads and roll back with their domain transaction',async()=>{
   const results=await Promise.all([enqueue(owner.id,event('synthetic:once')),enqueue(owner.id,event('synthetic:once'))]);
   assert.equal(results[0],results[1]);notice=results[0];
   await assert.rejects(enqueue(owner.id,event('synthetic:once','Другой текст')),{name:'NotificationEventConflictError'});
   assert.notEqual(await enqueue(other.id,event('synthetic:once')),notice);
   await assert.rejects(db.transaction(async tx=>{await enqueueNotificationInTransaction(tx,owner.id,event('synthetic:rollback'));throw Error('Synthetic domain failure');}));
   assert.equal((await admin.query("select count(*)::int as n from app.notifications where user_id=$1 and event_key='synthetic:rollback'",[owner.id])).rows[0].n,0);
  });
  await suite.test('inbox list exposes only the current owner display fields, never recipient, event identity or session authority',async()=>{
   const page=await store.list(owner.token,owner.id,null);
   assert.equal(page.items.length,1);assert.equal(page.items[0].id,notice);assert.equal(page.items[0].read,false);
   assert.deepEqual(Object.keys(page.items[0]).sort(),['id','category','tone','title','message','createdAt','read','actionHref','bookingRequestId'].sort());
   assert.equal(JSON.stringify(page).includes(owner.id),false);assert.equal(JSON.stringify(page).includes('synthetic:once'),false);
   await assert.rejects(store.list(owner.token,other.id,null),{name:'AppSessionAccessError'});
  });
  await suite.test('descending inbox pagination preserves microseconds and neither duplicates nor skips equal-time rows',async()=>{
   for(let i=0;i<23;i++)await enqueue(owner.id,event(`synthetic:page:${i}`));
   await admin.query("update app.notifications set created_at='2026-10-18T12:00:00.123456Z' where user_id=$1",[owner.id]);
   const first=await store.list(owner.token,owner.id,null),second=await store.list(owner.token,owner.id,first.nextCursor);
   assert.equal(first.items.length,20);assert.equal(second.items.length,4);assert.equal(second.nextCursor,null);
   assert.equal(first.nextCursor.updatedAt,'2026-10-18T12:00:00.123456Z');
   assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,24);
  });
  await suite.test('read and dismiss affect only explicit seen IDs of the owner; arrivals, foreign IDs and data remain intact',async()=>{
   const first=await store.list(owner.token,owner.id,null),foreign=(await store.list(other.token,other.id,null)).items[0].id;
   const arrival=await enqueue(owner.id,event('synthetic:arrival'));
   await store.mark(owner.token,owner.id,'read',[...first.items.slice(0,19).map(item=>item.id),foreign]);
   const rows=(await admin.query('select id,read_at is not null as read,dismissed_at is not null as dismissed from app.notifications where id=any($1::uuid[])',[[arrival,foreign,first.items[0].id]])).rows;
   assert.equal(rows.find(row=>row.id===arrival).read,false);assert.equal(rows.find(row=>row.id===foreign).read,false);assert.equal(rows.find(row=>row.id===first.items[0].id).read,true);
   await store.mark(owner.token,owner.id,'dismiss',[first.items[0].id]);await store.mark(owner.token,owner.id,'dismiss',[first.items[0].id]);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where id=$1 and dismissed_at is not null',[first.items[0].id])).rows[0].n,1);
   assert.equal((await store.list(owner.token,owner.id,null)).items.some(item=>item.id===first.items[0].id),false);
   for(const [action,ids] of [['unknown',[notice]],['read',[]],['read',Array(21).fill(notice)],['read',['invalid']],['read',[notice,notice]]])await assert.rejects(store.mark(owner.token,owner.id,action,ids),{name:'ListingDraftInputError'});
  });
  await suite.test('cookie inbox HTTP performs real restricted-role reads and idempotent marks, denying another owner',async()=>{
   const {createProductionNotificationInboxHandler}=workPublicationModule('production-notification-inbox-http',{
    'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
    './app-session-transaction':loadAdminModule('app-session-transaction'),'./listing-draft-contract.ts':drafts});
   const origin='https://owned-inbox.example.invalid',events=[],handler=createProductionNotificationInboxHandler({origin},()=>({store,limiter:{allowProduction:async()=>true}}),event=>events.push(event));
   const request=(body,method='POST')=>new Request(origin+'/api/account/notifications',{method,headers:{host:'owned-inbox.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+owner.token},body:JSON.stringify(body)});
   const read=await handler(request({action:'list',expectedOwnerId:owner.id,after:null}));assert.equal(read.status,200);
   const page=await read.json();assert.equal(page.items.length,20);
   const body={action:'read',expectedOwnerId:owner.id,ids:page.items.map(item=>item.id)};
   assert.equal((await handler(request(body,'PUT'))).status,200);
   const before=(await admin.query('select id,read_at from app.notifications where id=any($1::uuid[]) order by id',[body.ids])).rows;
   assert.equal((await handler(request(body,'PUT'))).status,200);
   assert.deepEqual((await admin.query('select id,read_at from app.notifications where id=any($1::uuid[]) order by id',[body.ids])).rows,before);
   assert.equal((await handler(request({action:'list',expectedOwnerId:other.id,after:null}))).status,401);
   assert.equal(JSON.stringify(events).includes(owner.token),false);
  });
  await suite.test('inbox reads and mutations reject revoked, blocked and data-subject-only sessions without affecting stored notices',async()=>{
   await admin.query("update app.sessions set scope='data-subject' where token_hash=$1",[hashSessionToken(owner.token)]);
   await assert.rejects(store.list(owner.token,owner.id,null),{name:'AppSessionAccessError'});
   await assert.rejects(store.mark(owner.token,owner.id,'dismiss',[notice]),{name:'AppSessionAccessError'});
   await admin.query("update app.sessions set scope='app' where token_hash=$1",[hashSessionToken(owner.token)]);
   await admin.query('update app.users set is_blocked=true where id=$1',[owner.id]);
   await assert.rejects(store.list(owner.token,owner.id,null),{name:'AppSessionAccessError'});
   await admin.query('update app.users set is_blocked=false,auth_version=auth_version+1 where id=$1',[owner.id]);
   await assert.rejects(store.mark(owner.token,owner.id,'dismiss',[notice]),{name:'AppSessionAccessError'});
  });
  await suite.test('a session expiring during an inbox mutation rolls the mutation back before commit',async()=>{
   const foreign=(await store.list(other.token,other.id,null)).items[0].id;
   const slow=new PostgresNotificationInbox({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    if(sql.startsWith('update app.notifications set read_at'))await tx.query('select pg_sleep(0.4)');
    return tx.query(sql,values);
   }}))});
   await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '300 milliseconds' where token_hash=$1",[hashSessionToken(other.token)]);
   await assert.rejects(slow.mark(other.token,other.id,'read',[foreign]),{name:'AppSessionAccessError'});
   assert.equal((await admin.query('select read_at is null as unread from app.notifications where id=$1',[foreign])).rows[0].unread,true);
  });
 }finally{for(const user of users)await admin.query('delete from app.users where id=$1',[user.id]);await db.close();}
}
