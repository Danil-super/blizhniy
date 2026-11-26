import assert from 'node:assert/strict';
import {createECDH,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashPassword,hashSessionToken,IdentityStore} from '../src/lib/identity.ts';

export async function testPushSubscription(suite,admin,config,credentials){
 await suite.test('Push binds enrollment and display to the opting-in browser session',async()=>{
  const apply=async path=>admin.query(await readFile(new URL('../database/'+path,import.meta.url),'utf8'));
  await apply('candidates/0086-push-subscriptions.sql');
  await apply('permissions/push-subscriptions.sql');
  const db=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password}));
  const users=Array.from({length:3},()=>({id:randomUUID(),token:randomBytes(32).toString('hex')}));
  const [a,b,c]=users;
  const password="Synthetic Push fixture 23!";
  const origin='https://local-push.example.invalid';
  const publicKey=createECDH('prime256v1').generateKeys().toString('base64url');
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-device-a',expirationTime:null,
   keys:{p256dh:publicKey,auth:randomBytes(16).toString('base64url')}};
  let poolUses=0,allow=true;
  const {createPushSubscriptionHandler}=await import('../src/lib/push-subscription-http.ts');
  const handler=createPushSubscriptionHandler({origin,publicKey},()=>{poolUses++;return{db,limiter:{allowPushSubscription:async()=>allow}};});
  const request=(actor,body,extra={})=>handler(new Request(origin+'/api/account/push',{method:'POST',
   headers:{host:'local-push.example.invalid',origin,'X-Blizhniy-Request':'1','x-real-ip':'192.0.2.91','Content-Type':'application/json',
    ...(actor?{cookie:'__Host-blizhniy_session='+actor.token}:{}),...extra},body:JSON.stringify(body)}));
  const status=actor=>request(actor,{action:'status',expectedOwnerId:actor.id});
  const register=(actor,input=subscription)=>request(actor,{action:'subscribe',expectedOwnerId:actor.id,subscription:input});
  const unregister=actor=>request(actor,{action:'unsubscribe',expectedOwnerId:actor.id});
  const authorize=(actor,id)=>request(actor,{action:'authorize',id});
  const profile=(user,enabled)=>admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2) on conflict(user_id) do update set profile=excluded.profile',[user.id,{pushNotifications:enabled}]);
  const row=async()=> (await admin.query('select id,session_hash,endpoint from app_push.subscriptions')).rows;
  try{
   for(const user of users){
    await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
     [user.id,user.id+'@example.invalid',user===b?await hashPassword(password):'scrypt$131072$8$1$'+'c'.repeat(32)+'$'+'d'.repeat(128)]);
    await admin.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hashSessionToken(user.token),user.id]);
   }
   const foreign={action:'status',expectedOwnerId:a.id};
   assert.equal((await request(null,foreign)).status,401);
   assert.equal((await request(a,foreign,{origin:'https://foreign.example.invalid'})).status,403);
   assert.equal((await request(a,{...foreign,sessionHash:hashSessionToken(a.token)})).status,422);
   assert.equal((await register(a,{...subscription,endpoint:'https://example.invalid/endpoint'})).status,422);
   assert.equal(poolUses,0);
   allow=false;
   assert.equal((await status(a)).status,429);
   allow=true;
   assert.equal((await request(b,foreign)).status,401);
   assert.deepEqual(await (await status(a)).json(),{status:'preference_off',publicKey});
   assert.equal((await register(a)).status,409);
   await profile(a,true);
   await profile(b,true);
   assert.deepEqual(await (await status(a)).json(),{status:'ready',publicKey});
   for(const response of await Promise.all([register(a),register(a)]))assert.equal(response.status,204);
   const [{id,session_hash,endpoint}]=await row();
   assert.equal(endpoint,subscription.endpoint);
   assert.equal(session_hash,hashSessionToken(a.token));
   assert.deepEqual(await (await status(a)).json(),{status:'active',publicKey});
   assert.equal((await register(b)).status,409);
   assert.equal((await authorize(b,id)).status,404);
   assert.equal((await authorize(c,id)).status,404);
   const before=(await admin.query('select last_seen_at from app.sessions where token_hash=$1',[session_hash])).rows[0].last_seen_at;
   assert.equal((await authorize(a,id)).status,204);
   assert.equal((await admin.query('select last_seen_at from app.sessions where token_hash=$1',[session_hash])).rows[0].last_seen_at.getTime(),before.getTime());
   assert.equal((await unregister(b)).status,204);
   assert.equal((await authorize(a,id)).status,204);
   await profile(a,false);
   assert.equal((await authorize(a,id)).status,404);
   assert.equal((await unregister(a)).status,204);
   assert.deepEqual(await row(),[]);
   await profile(a,true);
   assert.equal((await authorize(a,id)).status,404);
   assert.equal((await register(a)).status,204);
   const [{id:second}]=await row();
   assert.notEqual(second,id);
   await admin.query("update app_push.subscriptions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[second]);
   assert.equal((await authorize(a,second)).status,404);
   assert.equal((await register(a)).status,204);
   const [{id:third}]=await row();
   await admin.query("update app.sessions set scope='data-subject' where token_hash=$1",[session_hash]);
   assert.equal((await status(a)).status,401);
   assert.equal((await authorize(a,third)).status,404);
   await admin.query("update app.sessions set scope='app' where token_hash=$1",[session_hash]);
   await assert.rejects(db.query('select endpoint,auth from app_push.subscriptions'),{code:'42501'});
   await assert.rejects(apply('candidates/0086-push-subscriptions.down.sql'),/subscriptions are not empty/i);
   await admin.query('rollback');
   const identity=new IdentityStore(db);
   const switched=await identity.login(b.id+'@example.invalid',password,a.token);
   assert.equal(switched.user.id,b.id);
   assert.deepEqual(await row(),[]);
   assert.equal((await authorize({id:b.id,token:switched.token},third)).status,404);
   assert.equal((await authorize(a,third)).status,404);
   const current={id:b.id,token:switched.token};
   assert.equal((await register(current)).status,204);
   const [{id:newDevice}]=await row();
   assert.equal((await authorize(current,newDevice)).status,204);
   assert.equal((await authorize(a,newDevice)).status,404);
   await identity.revokeSession(switched.token);
   assert.deepEqual(await row(),[]);
  }finally{
   await db.close();
   await admin.query('delete from app.users where id=any($1::uuid[])',[users.map(user=>user.id)]);
   await apply('candidates/0086-push-subscriptions.down.sql');
  }
 });
}
