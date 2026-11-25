import assert from 'node:assert/strict';
import {createECDH,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';

export async function testPushDelivery(suite,admin,config,credentials){
 await suite.test('Push delivery keeps owner, category, retries and expired provider targets bound to the journal',async()=>{
  const apply=async path=>admin.query(await readFile(new URL('../database/'+path,import.meta.url),'utf8'));
  await apply('candidates/0086-push-subscriptions.sql');
  await apply('permissions/push-subscriptions.sql');
  await apply('candidates/0087-push-delivery.sql');
  const password=randomBytes(24).toString('hex');
  await admin.query('create role blizhniy_push_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '+pg.escapeLiteral(password));
  await apply('permissions/push-delivery-worker.sql');
  const web=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password}));
  const worker=new PostgresDatabase(new pg.Pool({...config,user:'blizhniy_push_worker',password}));
  const users=Array.from({length:3},()=>({id:randomUUID(),hash:hashSessionToken(randomBytes(32).toString('hex'))}));
  const [a,b,c]=users;
  const vapid=createECDH('prime256v1');
  const vapidPublic=vapid.generateKeys().toString('base64url');
  const privateBytes=vapid.getPrivateKey();
  const vapidPrivate=Buffer.concat([Buffer.alloc(32-privateBytes.length),privateBytes]).toString('base64url');
  const browserPublic=createECDH('prime256v1').generateKeys().toString('base64url');
  const browserAuth=randomBytes(16).toString('base64url');
  const endpoint=user=>'https://fcm.googleapis.com/fcm/send/synthetic-'+user.id;
  const {runPushDeliveryBatch}=await import('../src/lib/push-delivery-worker.ts');
  const {createWebPushTransport}=await import('../src/lib/push-web-transport.ts');
  const seen=[];
  let simulate=()=>new Response(null,{status:201});
  const send=createWebPushTransport({subject:'https://push.example.invalid',publicKey:vapidPublic,privateKey:vapidPrivate},
   async (url,options)=>{seen.push({url,options});return simulate();});
  const run=(connection=worker)=>runPushDeliveryBatch(connection,send);
  const insert=async(user,key,category='booking')=>(await web.query(
   "insert into app.notifications(user_id,event_key,category,tone,title,body) values($1,$2,$3,'info','Synthetic','Private synthetic details') on conflict do nothing returning id",
   [user.id,'push:'+key,category])).rows[0]?.id;
  const list=async event=>(await admin.query('select id,state,attempts,last_code from app_push.deliveries where notification_id=$1',[event])).rows;
  const entry=async event=>(await list(event))[0];
  const approve=async(user,id)=>(await web.query('select app_push.may_display($1,$2) as allowed',[user.hash,id])).rows[0].allowed;
  const pref=(user,profile)=>admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2) on conflict(user_id) do update set profile=excluded.profile',[user.id,profile]);
  const enroll=user=>web.query('select app_push.set_subscription($1,$2,$3,$4,$5,null)',[user.hash,user.id,endpoint(user),browserPublic,browserAuth]);
  try{
   for(const user of users){
    await admin.query("insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())",[user.id,user.id+'@example.invalid','scrypt$131072$8$1$'+'c'.repeat(32)+'$'+'d'.repeat(128)]);
    await admin.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[user.hash,user.id]);
    await pref(user,{pushNotifications:true});
   }
   await enroll(a);await enroll(b);
   await assert.rejects(web.query('select * from app_push.claim_delivery($1)',[randomUUID()]),{code:'42501'});
   await assert.rejects(worker.query('select endpoint,auth from app_push.subscriptions'),{code:'42501'});
   await assert.rejects(worker.query('select body from app.notifications'),{code:'42501'});
   await assert.rejects(worker.query('select * from app_push.deliveries'),{code:'42501'});

   const first=await insert(a,'received');
   assert.equal(await insert(a,'received'),undefined);
   const noSubscription=await insert(c,'unsubscribed');
   await pref(b,{pushNotifications:true,notifyBookings:false});
   const noCategory=await insert(b,'category-off');
   await pref(b,{pushNotifications:false});
   const noPush=await insert(b,'push-off');
   await pref(b,{pushNotifications:true});
   for(const id of [noSubscription,noCategory,noPush])assert.deepEqual(await list(id),[]);
   const {id}=await entry(first);
   assert.equal(await approve(a,id),false);
   await Promise.all([run(),run()]);
   assert.deepEqual(await entry(first),{id,state:'accepted',attempts:1,last_code:'accepted'});
   assert.deepEqual(seen.map(request=>request.url),[endpoint(a)]);
   assert.equal(seen[0].options.method,'POST');
   assert.equal(seen[0].options.redirect,'manual');
   assert.equal(seen[0].options.headers['Content-Encoding'],'aes128gcm');
   assert.match(seen[0].options.headers.Authorization,/^vapid /);
   assert.ok(seen[0].options.body.byteLength>100);
   assert.equal(Buffer.from(seen[0].options.body).includes(id),false);
   assert.equal(Buffer.from(seen[0].options.body).includes('Private synthetic details'),false);
   assert.equal(await approve(a,id),true);
   assert.equal(await approve(b,id),false);
   assert.equal(await approve(c,id),false);
   await pref(a,{pushNotifications:true,notifyBookings:false});
   assert.equal(await approve(a,id),false);
   await pref(a,{pushNotifications:true});

   const flip=await insert(a,'category-turned-off');
   await pref(a,{pushNotifications:true,notifyBookings:false});
   await run();
   assert.equal((await entry(flip)).state,'cancelled');
   await pref(a,{pushNotifications:true});
   assert.equal(seen.length,1);

   const throttled=await insert(a,'provider-throttled');
   simulate=()=>new Response(null,{status:429,headers:{'Retry-After':'90'}});
   await run();
   assert.equal((await entry(throttled)).state,'ready');
   assert.equal((await admin.query("select available_at>=clock_timestamp()+interval '80 seconds' as waited from app_push.deliveries where notification_id=$1",[throttled])).rows[0].waited,true);
   await run();
   assert.equal(seen.length,2);
   await admin.query('update app_push.deliveries set available_at=clock_timestamp() where notification_id=$1',[throttled]);
   simulate=()=>new Response(null,{status:201});
   await run();
   assert.equal((await entry(throttled)).attempts,2);
   assert.equal(seen[1].options.headers.Topic,seen[2].options.headers.Topic);

   const uncertain=await insert(a,'provider-lost-ack');
   simulate=()=>{throw Error('Synthetic network failure');};
   await run();await run();
   assert.equal((await entry(uncertain)).state,'unknown');
   assert.equal(seen.length,4);
   const lost=await insert(a,'worker-crash');
   const claim=randomUUID();
   assert.equal((await worker.query('select id from app_push.claim_delivery($1)',[claim])).rows[0].id,(await entry(lost)).id);
   await admin.query("update app_push.deliveries set lease_until=clock_timestamp()-interval '1 second' where notification_id=$1",[lost]);
   await run();
   assert.equal((await entry(lost)).last_code,'lost_worker');
   assert.equal(seen.length,4);
   const removed=await insert(a,'stale-endpoint');
   simulate=()=>new Response(null,{status:410});
   await run();
   assert.equal((await entry(removed)).last_code,'gone');
   assert.equal((await web.query('select app_push.subscription_state($1,$2) as state',[a.hash,a.id])).rows[0].state,'ready');
   assert.equal(await approve(a,id),false);
   assert.equal((await web.query('select app_push.subscription_state($1,$2) as state',[b.hash,b.id])).rows[0].state,'active');
   assert.deepEqual(await list(await insert(a,'no-endpoint-after-410')),[]);
   await assert.rejects(apply('candidates/0087-push-delivery.down.sql'),/journal is not empty/i);
   await admin.query('rollback');
  }finally{
   await web.close();await worker.close();
   await admin.query('delete from app.users where id=any($1::uuid[])',[users.map(user=>user.id)]);
   await apply('candidates/0087-push-delivery.down.sql');
   await apply('candidates/0086-push-subscriptions.down.sql');
  }
 });
}
