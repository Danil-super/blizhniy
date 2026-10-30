// Independent disposable PG18 fixture. No .env, production endpoint or shared local stand.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {promisify} from 'node:util';
import pg from 'pg';

const require=createRequire(import.meta.url);
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const run=promisify(execFile);
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-deletion-test-'+randomBytes(8).toString('hex');
const label='blizhniy.account-deletion-integration';
const password=randomBytes(24).toString('hex');
const runtimePassword=randomBytes(24).toString('hex');
const applicationName='deletion-regression-'+randomBytes(8).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
 env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024,
})).stdout.trim();
const denied=error=>/AccessError$/.test(error?.name);
const syntheticHash='scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);

test('account deletion: isolated PostgreSQL owner, administrator, CAS and immutable audit', {timeout:90000}, async suite=>{
 // Missing implementation/migration is RED, before a fixture can be allocated.
 const {PostgresAccountDeletionStore}=load('postgres-account-deletion');
 const {PostgresDatabase}=load('postgres');
 const {hashSessionToken,hashPassword,IdentityStore}=load('identity');
 const migration=await readFile(new URL('../database/migrations/0033-account-deletion.sql',import.meta.url),'utf8');
 const permissions=await readFile(new URL('../database/permissions/account-deletion.sql',import.meta.url),'utf8');
 let containerId,owner,runtime,otherRuntime;
 try{
  containerId=await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,
   '--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432',
   '--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const metadata=JSON.parse(await docker(['inspect',containerId]))[0];
  assert.equal(metadata.Id,containerId);assert.equal(metadata.Config.Labels[label],name);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const deadline=Date.now()+20000;
  for(;;){
   try{await docker(['exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}
   catch{if(Date.now()>deadline)throw Error('Isolated deletion PostgreSQL did not start');}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  owner=new pg.Pool({...config,max:3});
  assert.match((await owner.query("select current_setting('server_version') as version")).rows[0].version,/^18\.6/);
  await owner.query(await readFile(new URL('../database/migrations/0001-identity.sql',import.meta.url),'utf8'));
  await owner.query(migration);
  await owner.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
   revoke all on database blizhniy_test from public;
   grant connect on database blizhniy_test to blizhniy_runtime;
   grant usage on schema app to blizhniy_runtime;
   grant select on app.users,app.sessions to blizhniy_runtime;
   grant update(auth_version) on app.users to blizhniy_runtime;
   grant insert,delete on app.sessions to blizhniy_runtime;
   grant update(last_seen_at) on app.sessions to blizhniy_runtime`);
  await owner.query(permissions);
  const runtimeConfig={...config,user:'blizhniy_runtime',password:runtimePassword,max:3,application_name:applicationName,
   statement_timeout:6000,lock_timeout:3000,idle_in_transaction_session_timeout:8000};
  runtime=new PostgresDatabase(new pg.Pool(runtimeConfig));
  otherRuntime=new PostgresDatabase(new pg.Pool(runtimeConfig));
  const first=new PostgresAccountDeletionStore(runtime),second=new PostgresAccountDeletionStore(otherRuntime);
  const user=async(email,role='user',blocked=false,verified=true)=>{
   const id=(await owner.query(`insert into app.users(email,password_hash,role,is_blocked,email_verified_at)
    values($1,$2,$3,$4,case when $5 then clock_timestamp() else null end) returning id`,[email,syntheticHash,role,blocked,verified])).rows[0].id;
   return{id,email,isBlocked:blocked};
  };
  const session=async(principal,scope='app',lifeSeconds=3600)=>{
   const token=randomBytes(32).toString('hex');
   await owner.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
    select $1,id,auth_version,$3,clock_timestamp()+$4*interval '1 second' from app.users where id=$2`,
   [hashSessionToken(token),principal.id,scope,lifeSeconds]);return token;
  };
  const alice=await user('alice@deletion.invalid'),bob=await user('bob@deletion.invalid');
  const blocked=await user('blocked@deletion.invalid','user',true),admin=await user('admin@deletion.invalid','admin');
  const aliceToken=await session(alice),bobToken=await session(bob),blockedToken=await session(blocked,'data-subject'),adminToken=await session(admin);
  let aliceRequest;

  await suite.test('restricted principal discovery works for a verified blocked owner and does not expose credentials',async()=>{
   assert.deepEqual(await first.session(blockedToken),blocked);
   assert.deepEqual(await first.session(aliceToken),alice);
   assert.equal(JSON.stringify(await first.session(blockedToken)).includes('password'),false);
  });
  await suite.test('owner reads only their latest request and cross-account read/write is denied',async()=>{
   assert.deepEqual(await first.read(aliceToken,alice.id),{request:null});
   await assert.rejects(first.read(aliceToken,bob.id),denied);
   await assert.rejects(first.request(aliceToken,bob.id),denied);
   assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_requests')).rows[0].count,0);
  });
  await suite.test('concurrent retries from two instances return one active persisted request and one audit event',async()=>{
   const results=await Promise.all(Array.from({length:8},(_,index)=>(index%2?first:second).request(aliceToken,alice.id)));
   aliceRequest=results[0].request;
   assert.ok(results.every(result=>result.request.id===aliceRequest.id));
   assert.equal(aliceRequest.status,'requested');assert.equal(aliceRequest.revision,'1');
   assert.equal(aliceRequest.reviewStartedAt,null);assert.equal(aliceRequest.resolvedAt,null);assert.equal(aliceRequest.resolution,null);
   assert.ok(Number.isFinite(Date.parse(aliceRequest.requestedAt)));
   assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_requests where user_id=$1',[alice.id])).rows[0].count,1);
   assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_events where request_id=$1',[aliceRequest.id])).rows[0].count,1);
   assert.deepEqual((await first.read(bobToken,bob.id)).request,null);
  });
  await suite.test('verified blocked account may submit and read its own rights request',async()=>{
   const requested=(await first.request(blockedToken,blocked.id)).request;
   assert.equal((await second.read(blockedToken,blocked.id)).request.id,requested.id);
   await assert.rejects(first.read(blockedToken,alice.id),denied);
  });
  await suite.test('restricted scope never gains admin authority, even for a real administrator',async()=>{
   const limitedAdmin=await session(admin,'data-subject');
   await assert.rejects(first.list(limitedAdmin,admin.id,0),denied);
   await assert.rejects(first.begin(limitedAdmin,admin.id,aliceRequest.id,'1'),denied);
   await assert.rejects(first.list(aliceToken,alice.id,0),denied);
   await assert.rejects(first.list(adminToken,alice.id,0),denied);
  });
  await suite.test('unverified owner, revoked token, expired token, idle token and old auth version fail closed',async()=>{
   const pending=await user('pending@deletion.invalid','user',false,false);
   const pendingToken=await session(pending,'data-subject');
   await assert.rejects(first.request(pendingToken,pending.id),denied);
   const revoked=await session(bob,'data-subject');
   await owner.query('delete from app.sessions where token_hash=$1',[hashSessionToken(revoked)]);
   await assert.rejects(first.request(revoked,bob.id),denied);
   const expired=await session(bob,'data-subject');
   await owner.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '90 minutes',expires_at=clock_timestamp()-interval '1 hour' where token_hash=$1",[hashSessionToken(expired)]);
   await assert.rejects(first.request(expired,bob.id),denied);
   const idle=await session(bob,'data-subject');
   await owner.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=$1",[hashSessionToken(idle)]);
   await assert.rejects(first.request(idle,bob.id),denied);
   const obsolete=await session(bob,'data-subject');
   await owner.query('update app.users set auth_version=auth_version+1 where id=$1',[bob.id]);
   await assert.rejects(first.request(obsolete,bob.id),denied);
   assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_requests where user_id=$1',[bob.id])).rows[0].count,0);
  });
  await suite.test('administrator queue exposes active requests and does not leak internal case references to owners',async()=>{
   const queue=await first.list(adminToken,admin.id,0);
   assert.equal(queue.hasMore,false);assert.equal(queue.requests.length,2);
   const row=queue.requests.find(row=>row.id===aliceRequest.id);
   assert.equal(row.ownerId,alice.id);assert.equal(row.email,alice.email);
   assert.equal(Object.hasOwn((await first.read(aliceToken,alice.id)).request,'caseReference'),false);
  });
  await suite.test('only current unblocked administrator can mutate the queue',async()=>{
   const mutable=await user('mutable-admin@deletion.invalid','admin');
   const token=await session(mutable);
   await owner.query("update app.users set role='user' where id=$1",[mutable.id]);
   await assert.rejects(first.begin(token,mutable.id,aliceRequest.id,'1'),denied);
   await owner.query("update app.users set role='admin',is_blocked=true where id=$1",[mutable.id]);
   await assert.rejects(first.begin(token,mutable.id,aliceRequest.id,'1'),denied);
   assert.equal((await first.read(aliceToken,alice.id)).request.status,'requested');
  });
  await suite.test('administrator review is a revision-checked transition with append-only audit',async()=>{
   const started=(await first.begin(adminToken,admin.id,aliceRequest.id,'1')).request;
   assert.equal(started.status,'in_review');assert.equal(started.revision,'2');
   assert.ok(Date.parse(started.reviewStartedAt)>=Date.parse(started.requestedAt));
   await assert.rejects(second.begin(adminToken,admin.id,aliceRequest.id,'1'),{name:'DeletionConflictError'});
   assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_events where request_id=$1',[aliceRequest.id])).rows[0].count,2);
   assert.equal((await first.request(aliceToken,alice.id)).request.id,aliceRequest.id);
  });
  await suite.test('manual decision needs confirmation, preserves immutable request identity and records the operator',async()=>{
   const decision={resolution:'partly_retained',caseReference:'CASE_20261030_ALICE',confirmedManualDecision:true};
   await assert.rejects(async()=>first.resolve(adminToken,admin.id,aliceRequest.id,'2',{...decision,confirmedManualDecision:false}),{name:'DeletionInputError'});
   await assert.rejects(first.resolve(adminToken,admin.id,aliceRequest.id,'1',decision),{name:'DeletionConflictError'});
   const resolved=(await first.resolve(adminToken,admin.id,aliceRequest.id,'2',decision)).request;
   assert.equal(resolved.status,'resolved');assert.equal(resolved.revision,'3');
   assert.equal(resolved.resolution,'partly_retained');assert.equal(resolved.caseReference,decision.caseReference);
   assert.equal(resolved.id,aliceRequest.id);assert.equal(resolved.requestedAt,aliceRequest.requestedAt);
   assert.ok(Date.parse(resolved.resolvedAt)>=Date.parse(resolved.reviewStartedAt));
   const audit=(await owner.query('select actor_id,status,resolution,case_reference from app.account_deletion_events where request_id=$1 order by created_at,id',[aliceRequest.id])).rows;
   assert.deepEqual(audit.map(row=>row.status),['requested','in_review','resolved']);
   assert.deepEqual(audit.map(row=>row.actor_id),[alice.id,admin.id,admin.id]);
   assert.equal(audit[2].case_reference,decision.caseReference);
   const own=(await first.read(aliceToken,alice.id)).request;
   assert.equal(own.resolution,'partly_retained');assert.equal(Object.hasOwn(own,'caseReference'),false);
   assert.ok(!(await first.list(adminToken,admin.id,0)).requests.some(row=>row.id===aliceRequest.id));
   // Recording a manual disposition must not masquerade as physical erasure.
   assert.equal((await owner.query('select count(*)::int as count from app.users where id=$1',[alice.id])).rows[0].count,1);
  });
  await suite.test('resolved request stays immutable and a new owner request creates a new case',async()=>{
   await assert.rejects(first.resolve(adminToken,admin.id,aliceRequest.id,'3',{resolution:'declined',caseReference:'CASE_20261030_OTHER',confirmedManualDecision:true}),{name:'DeletionConflictError'});
   const next=(await first.request(aliceToken,alice.id)).request;
   assert.notEqual(next.id,aliceRequest.id);assert.equal(next.status,'requested');assert.equal(next.revision,'1');
   assert.equal((await first.read(aliceToken,alice.id)).request.id,next.id);
  });
  await suite.test('runtime grants cannot modify owner, dates, revision, audit or erase requests',async()=>{
   const snapshot=(await owner.query('select * from app.account_deletion_requests where id=$1',[aliceRequest.id])).rows[0];
   const forbidden=[
    ['update app.account_deletion_requests set user_id=$2 where id=$1',[aliceRequest.id,bob.id]],
    ['update app.account_deletion_requests set revision=99 where id=$1',[aliceRequest.id]],
    ["update app.account_deletion_requests set requested_at=clock_timestamp() where id=$1",[aliceRequest.id]],
    ["update app.account_deletion_requests set resolved_at=clock_timestamp() where id=$1",[aliceRequest.id]],
    ['delete from app.account_deletion_requests where id=$1',[aliceRequest.id]],
    ["insert into app.account_deletion_events(request_id,actor_id,status) values($1,$2,'requested')",[aliceRequest.id,bob.id]],
    ["update app.account_deletion_events set status='resolved' where request_id=$1",[aliceRequest.id]],
    ['delete from app.account_deletion_events where request_id=$1',[aliceRequest.id]],
    ['update app.users set role=\'admin\' where id=$1',[bob.id]],
   ];
   for(const [sql,values]of forbidden)await assert.rejects(runtime.query(sql,values),{code:'42501'});
   assert.deepEqual((await owner.query('select * from app.account_deletion_requests where id=$1',[aliceRequest.id])).rows[0],snapshot);
   // Even the migration owner cannot casually rewrite historical decisions.
   await assert.rejects(owner.query("update app.account_deletion_events set status='resolved' where request_id=$1",[aliceRequest.id]),{code:'42501'});
   await assert.rejects(owner.query('delete from app.account_deletion_events where request_id=$1',[aliceRequest.id]),{code:'42501'});
  });
  await suite.test('expiry during a resource row-lock wait rolls back both state and audit',async()=>{
   const target=(await second.request(await session(bob),bob.id)).request;
   const expiring=await session(admin,'app',1);
   const lock=await owner.connect();
   try{
    await lock.query('begin');
    await lock.query('select id from app.account_deletion_requests where id=$1 for update',[target.id]);
    // Attach the rejection handler before deliberately holding the resource lock.
    const outcome=first.begin(expiring,admin.id,target.id,'1').then(value=>({value}),error=>({error}));
    const waitDeadline=Date.now()+2500;let waiting=false;
    while(Date.now()<waitDeadline){
     waiting=(await owner.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock' and query like '%account_deletion_requests%') as waiting",[applicationName])).rows[0].waiting;
     if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(waiting,true,'the authorized mutation must actually be waiting for the resource');
    await owner.query('select pg_sleep(1.1)');
    await lock.query('commit');
    const result=await outcome;assert.ok(result.error,'expired operation must reject');assert.ok(denied(result.error));
    const stored=(await owner.query('select status,revision from app.account_deletion_requests where id=$1',[target.id])).rows[0];
    assert.deepEqual(stored,{status:'requested',revision:'1'});
    assert.equal((await owner.query('select count(*)::int as count from app.account_deletion_events where request_id=$1',[target.id])).rows[0].count,1);
   }finally{await lock.query('rollback');lock.release();}
  });
  await suite.test('real blocked-owner credentials issue a one-hour restricted session and never authorize normal login',async()=>{
   const principal=await user('real-credentials@deletion.invalid','user',true);
   const credential='Synthetic deletion credentials 2026!';
   await owner.query('update app.users set password_hash=$2 where id=$1',[principal.id,await hashPassword(credential)]);
   const identity=new IdentityStore(runtime);
   assert.equal(await identity.login(principal.email,credential),null);
   const issued=await identity.loginForDataSubject(principal.email,credential);
   assert.ok(issued);assert.equal(issued.scope,'data-subject');assert.equal(issued.user.id,principal.id);
   assert.equal(issued.user.isBlocked,true);
   const stored=(await owner.query('select scope,extract(epoch from (expires_at-created_at))::int as seconds,expires_at from app.sessions where token_hash=$1',[hashSessionToken(issued.token)])).rows[0];
   assert.equal(stored.scope,'data-subject');assert.equal(stored.seconds,3600);
   assert.equal(issued.expiresAt.getTime(),stored.expires_at.getTime());
   assert.equal(await identity.resolveSession(issued.token),null);
   assert.deepEqual(await first.session(issued.token),principal);
   await assert.rejects(first.list(issued.token,principal.id,0),denied);
   await identity.revokeSession(issued.token);
   await assert.rejects(first.session(issued.token),denied);
  });
  await suite.test('operator account erasure redacts the request owner FK while preserving the full decision audit',async()=>{
   const principal=await user('operator-erasure@deletion.invalid');
   const token=await session(principal);
   const requested=(await first.request(token,principal.id)).request;
   await first.begin(adminToken,admin.id,requested.id,'1');
   await first.resolve(adminToken,admin.id,requested.id,'2',{resolution:'partly_retained',caseReference:'CASE_ERASURE_20261030',confirmedManualDecision:true});
   const before=(await owner.query('select * from app.account_deletion_requests where id=$1',[requested.id])).rows[0];
   const audit=(await owner.query('select * from app.account_deletion_events where request_id=$1 order by created_at,id',[requested.id])).rows;
   assert.equal(before.user_id,principal.id);assert.equal(audit.length,3);
   const removed=await owner.query('delete from app.users where id=$1',[principal.id]);
   assert.equal(removed.rowCount,1);
   const after=(await owner.query('select * from app.account_deletion_requests where id=$1',[requested.id])).rows[0];
   assert.deepEqual(after,{...before,user_id:null});
   assert.deepEqual((await owner.query('select * from app.account_deletion_events where request_id=$1 order by created_at,id',[requested.id])).rows,audit);
   assert.equal((await owner.query('select count(*)::int as count from app.sessions where user_id=$1',[principal.id])).rows[0].count,0);
  });
  await suite.test('PUBLIC has no direct request or audit access',async()=>{
   await owner.query('create role deletion_anonymous nologin; grant usage on schema app to deletion_anonymous');
   const client=await owner.connect();
   try{
    for(const table of ['account_deletion_requests','account_deletion_events']){
     await client.query('begin');await client.query('set local role deletion_anonymous');
     await assert.rejects(client.query(`select * from app.${table}`),{code:'42501'});await client.query('rollback');
    }
   }finally{await client.query('rollback');client.release();}
  });
 }finally{
  await Promise.allSettled([runtime?.close(),otherRuntime?.close(),owner?.end()]);
  if(containerId){
   const metadata=JSON.parse(await docker(['inspect',containerId]))[0];
   if(metadata.Id!==containerId||metadata.Name!==`/${name}`||metadata.Config.Labels[label]!==name)throw Error('Refusing to remove a foreign deletion container');
   await docker(['rm','--force',containerId]);
  }
 }
});
