// Disposable synthetic PG18; no dotenv, persistent stand, provider or production access.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-compensation-'+randomBytes(8).toString('hex'),label='blizhniy.compensation',password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('paid-response compensation cases serialize with actual contact disclosure and selection',{timeout:120000},async suite=>{
 const migration=await readFile(new URL('../database/migrations/0043-application-compensation-cases.sql',import.meta.url),'utf8');
 const {PostgresDatabase}=load('postgres'),{PostgresPaymentIntentStore}=load('postgres-payment-intents');
 const {PostgresApplicationCompensationStore}=load('postgres-application-compensation');
 const merchant={shopId:'compensation-fixture',isTest:true};let container,admin,db,ownerDb;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Image,image);assert.equal(meta.Config.Labels[label],name);
  const binding=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  admin=new pg.Pool({...config,max:5});assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const names=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|4[0-2])-[a-z-]+\.sql$/.test(n)).sort();assert.equal(names.length,42);
  for(const file of names)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  await admin.query(migration);
  await admin.query(`create role compensation_worker login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to compensation_worker;grant usage on schema app to compensation_worker;
   grant select on app.application_compensation_cases to compensation_worker;
   grant insert(payment_intent_id,merchant_shop_id) on app.application_compensation_cases to compensation_worker;
   grant execute on function app.lock_application_compensation_source(uuid,text) to compensation_worker`);
  db=new PostgresDatabase(new pg.Pool({...config,user:'compensation_worker',max:5}));ownerDb=new PostgresDatabase(new pg.Pool({...config,max:5}));
  const store=new PostgresApplicationCompensationStore(db,merchant);
  async function user(){const id=randomUUID();await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@compensation.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);return id;}
  async function purchase({ageDays=6,kind='workRequest',workId=null,payerId=null,captured=true,receipt=false}={}){
   const applicant=payerId??await user(),recipient=await user();
   const work=workId??(await admin.query('insert into app.work_publications(author_id,kind,creation_key,form) values($1,$2,$3,$4) returning id',[recipient,kind,randomUUID(),{kind,title:'Синтетический заказ'}])).rows[0].id;
   const owner=(await admin.query('select author_id from app.work_publications where id=$1',[work])).rows[0].author_id;
   const application=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot,is_paid,status,created_at,sent_at) values($1,$2,$3,1,1,'{}',true,'sent',clock_timestamp()-($4::text||' days')::interval-interval '1 hour',clock_timestamp()-($4::text||' days')::interval) returning id",[applicant,work,randomUUID(),ageDays])).rows[0].id;
   const id=randomUUID(),providerPaymentId=randomUUID(),metadata={localPaymentId:id,targetId:application,targetType:'application',tariffId:'job-response'};
   const requestBody=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata,...(receipt?{receipt:{customer:{email:'receipt@compensation.invalid'},internet:true,items:[{description:'Отклик',quantity:1,amount:{value:'99.00',currency:'RUB'},vat_code:1,payment_mode:'full_payment',payment_subject:'service'}]}}:{})});
   await ownerDb.transaction(async tx=>{await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{id,ownerId:applicant,targetType:'application',targetId:application,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,...merchant,requestBody});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,applicant,randomUUID(),application]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);});
   if(captured){await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,new Date(Date.now()-ageDays*86400000-1000).toISOString()]);}
   return{id,application,applicant,recipient:owner,work,providerPaymentId,requestBody};
  }
  const view=item=>admin.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2) on conflict do nothing',[item.application,item.recipient]);
  const choose=item=>admin.query("update app.applications set status='selected',revision=revision+1,updated_at=clock_timestamp() where id=$1",[item.application]);
  await suite.test('claims original full TEST amount once and derives original fiscal mode',async()=>{
   for(const receipt of [false,true]){const item=await purchase({receipt}),result=await store.claim(item.id);assert.equal(result.state,'claimed');assert.equal(result.case.paymentIntentId,item.id);assert.equal(result.case.applicationId,item.application);assert.equal(result.case.amount,'99.00');assert.equal(result.case.reason,'unread-five-days');assert.equal(result.case.fiscalMode,receipt?'provider-automatic-full':'test-without-receipt');assert.deepEqual(await store.claim(item.id),result);}
  });
  await suite.test('recent delivery waits and early disclosure prevents both JS and direct SQL claims',async()=>{
   const item=await purchase({ageDays:1});assert.equal((await store.claim(item.id)).state,'waiting');
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]),{code:'PBC01'});
   await view(item);
   assert.deepEqual(await store.claim(item.id),{state:'ineligible',reason:'viewed'});
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]),{code:'PBC01'});
  });
  await suite.test('disclosure before another specialist is selected blocks an otherwise matured SQL case',async()=>{
   const chosen=await purchase({ageDays:1}),other=await purchase({ageDays:1,workId:chosen.work});await view(other);await choose(chosen);
   assert.deepEqual(await store.claim(other.id),{state:'ineligible',reason:'viewed'});
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[other.id,merchant.shopId]),{code:'PBC01'});
  });
  await suite.test('late disclosure and selection preserve accrued five-day eligibility',async()=>{
   const item=await purchase();await view(item);await choose(item);const result=await store.claim(item.id);assert.equal(result.state,'claimed');assert.equal(result.case.reason,'unread-five-days');
  });
  await suite.test('durable other-executor selection qualifies unseen responses; mutable updated_at is not used',async()=>{
   const chosen=await purchase({ageDays:1}),other=await purchase({ageDays:1,workId:chosen.work});await choose(chosen);
   await admin.query("update app.applications set updated_at=clock_timestamp()+interval '1 day' where id=$1",[chosen.application]);
   const result=await store.claim(other.id);assert.equal(result.state,'claimed');assert.equal(result.case.reason,'other-selected-unread');assert.equal(result.case.selectedApplicationId,chosen.application);
   assert.deepEqual(await store.claim(chosen.id),{state:'ineligible',reason:'selected-self'});
  });
  await suite.test('claim COMMIT uncertainty is recovered by reading the same original payment case',async()=>{
   const item=await purchase();const uncertain=new PostgresApplicationCompensationStore({transaction:async work=>{await db.transaction(work);throw Error('Synthetic lost COMMIT acknowledgement');}},merchant);
   await assert.rejects(uncertain.claim(item.id));const saved=await store.read(item.id);assert.ok(saved);assert.deepEqual((await store.claim(item.id)).case,saved);
   assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_cases where payment_intent_id=$1',[item.id])).rows[0].n,1);
  });
  await suite.test('wrong merchant and missing capture fail closed; worker cannot mutate money, evidence or case history',async()=>{
   const item=await purchase({captured:false});await assert.rejects(store.claim(item.id));const paid=await purchase();await assert.rejects(new PostgresApplicationCompensationStore(db,{...merchant,shopId:'other'}).claim(paid.id));
   for(const sql of ["select email from app.users","select request_body from app.payment_checkout_intents","update app.payment_orders set status='refunded' where false","update app.applications set is_paid=false where false","delete from app.application_compensation_cases where false","update app.application_compensation_cases set amount=1 where false","insert into app.application_contact_views default values","insert into app.application_selection_events default values","insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id,amount) values(gen_random_uuid(),'compensation-fixture',1)"]){await assert.rejects(db.query(sql),{code:'42501'});}
  });
  await suite.test('application locks serialize claim versus actual disclosure without deadlock',async()=>{
   const item=await purchase({ageDays:1}),locker=await admin.connect();
   try{await locker.query('begin');await locker.query('select id from app.applications where id=$1 for update',[item.application]);
    await assert.rejects(store.claim(item.id),{name:'ApplicationCompensationBusyError'});await locker.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2)',[item.application,item.recipient]);await locker.query('commit');
   }finally{await locker.query('rollback');locker.release();}
   assert.deepEqual(await store.claim(item.id),{state:'ineligible',reason:'viewed'});
  });
  await suite.test('untrusted disclosure timestamps are derived after locks, not backdated by an INSERT',async()=>{
   const item=await purchase();await admin.query("insert into app.application_contact_views(application_id,recipient_id,recorded_at) values($1,$2,clock_timestamp()-interval '5 days')",[item.application,item.recipient]);
   assert.equal((await store.claim(item.id)).state,'claimed');
  });
  await suite.test('a concurrent direct disclosure cannot cross the uncommitted case boundary',async()=>{
   const item=await purchase(),locker=await admin.connect();
   try{await locker.query('begin');await locker.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]);
    await assert.rejects(view(item),{code:'55P03'});await locker.query('commit');
   }finally{await locker.query('rollback');locker.release();}
   const saved=await store.read(item.id);assert.equal(saved.contactViewAt,null);await view(item);assert.deepEqual(await store.read(item.id),saved);
  });
  await suite.test('capture chronology is checked independently for a direct SQL claim',async()=>{
   const item=await purchase({captured:false});await admin.query("update app.payment_orders set status='succeeded' where id=$1",[item.id]);
   await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[item.id,item.providerPaymentId,new Date(Date.now()+86400000).toISOString()]);
   await assert.rejects(store.claim(item.id));
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]),{code:'23514'});
  });
  await suite.test('legacy disclosure and historical selection remain manual recovery, never invented timestamps',async()=>{
   const item=await purchase(),legacy=await admin.connect();
   try{await legacy.query('begin');await legacy.query('alter table app.application_contact_views disable trigger application_contact_view_guard');
    await legacy.query("insert into app.application_contact_views(application_id,recipient_id,evidence) values($1,$2,'legacy_unknown')",[item.application,item.recipient]);
    await legacy.query('alter table app.application_contact_views enable always trigger application_contact_view_guard');await legacy.query('commit');
   }finally{await legacy.query('rollback');legacy.release();}
   assert.deepEqual(await store.claim(item.id),{state:'ineligible',reason:'legacy-unknown'});
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]),{code:'PBC01'});
   const chosen=await purchase({ageDays:1}),other=await purchase({ageDays:1,workId:chosen.work});
   const history=await admin.connect();try{await history.query('begin');await history.query('alter table app.applications disable trigger zz_application_selection_event');
    await history.query("update app.applications set status='selected',revision=revision+1,updated_at=clock_timestamp() where id=$1",[chosen.application]);
    await history.query('alter table app.applications enable always trigger zz_application_selection_event');await history.query('commit');
   }finally{await history.query('rollback');history.release();}
   await assert.rejects(store.claim(other.id),{name:'ApplicationCompensationAccessError'});
  });
  await suite.test('concurrent compensation requests converge on one case and never rewrite its evidence',async()=>{
   const item=await purchase(),outcomes=await Promise.allSettled([store.claim(item.id),store.claim(item.id)]);
   for(const outcome of outcomes)if(outcome.status==='rejected')assert.equal(outcome.reason.name,'ApplicationCompensationBusyError');
   const result=await store.claim(item.id);assert.equal(result.state,'claimed');await view(item);assert.deepEqual(await store.claim(item.id),result);
   assert.equal((await admin.query('select count(*)::int as n from app.application_compensation_cases where application_id=$1',[item.application])).rows[0].n,1);
   await assert.rejects(admin.query("update app.application_compensation_cases set amount=1 where payment_intent_id=$1",[item.id]),{code:'42501'});
   await assert.rejects(admin.query('delete from app.application_compensation_cases where payment_intent_id=$1',[item.id]),{code:'42501'});
   await assert.rejects(admin.query('truncate app.application_compensation_cases'),{code:'42501'});
  });
  await suite.test('source and SQL use exactly120 elapsed hours under a DST-observing session timezone',async()=>{
   const item=await purchase(),client=await admin.connect();
   try{await client.query('begin');await client.query("set local time zone 'America/New_York'");
    await client.query("update app.applications set created_at='2026-03-06T10:00:00Z',sent_at='2026-03-06T10:00:01.000001Z' where id=$1",[item.application]);
    const source=(await client.query('select app.lock_application_compensation_source($1,$2) as source',[item.id,merchant.shopId])).rows[0].source;
    const {assessApplicationCompensation}=load('application-compensation-policy');const assessed=assessApplicationCompensation(source.facts,source.observedAt);
    assert.equal(assessed.eligibleAt,'2026-03-11T10:00:01.000001Z');
    await client.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]);
    const persisted=(await client.query("select to_char(eligible_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as deadline from app.application_compensation_cases where payment_intent_id=$1",[item.id])).rows[0];
    assert.equal(persisted.deadline,assessed.eligibleAt);await client.query('rollback');
   }finally{await client.query('rollback');client.release();}
  });
  await suite.test('the existing authorized read and choose-executor flow remains compatible with the new evidence',async()=>{
   const keys=['BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN'],previous=keys.map(key=>process.env[key]);
   Object.assign(process.env,{BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'});
   try{
    const {PostgresApplicationStore}=load('postgres-applications'),{hashSessionToken}=load('identity');
    const chosen=await purchase({ageDays:1}),other=await purchase({ageDays:1,workId:chosen.work}),token=randomBytes(32).toString('hex');
    await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),chosen.recipient]);
    const apps=new PostgresApplicationStore(ownerDb,{localActions:true,contactViews:true});
    const opened=await apps.read(token,chosen.recipient,chosen.application);assert.equal(opened.view,'recipient');assert.equal(opened.status,'sent');
    const selected=await apps.decide(token,chosen.recipient,chosen.application,opened.revision,'selected');assert.equal(selected.status,'selected');
    assert.equal((await store.claim(other.id)).case.reason,'other-selected-unread');
    assert.deepEqual(await store.claim(chosen.id),{state:'ineligible',reason:'selected-self'});
    assert.equal((await admin.query("select count(*)::int as n from app.notifications where user_id=$1 and event_key=$2",[other.applicant,'application_other_selected:'+other.application])).rows[0].n,1);
   }finally{keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
  });
  await suite.test('a durable case survives subsequent payment finalization without a replacement operation',async()=>{
   const item=await purchase(),result=await store.claim(item.id);
   // Synthetic owner-only finalization; no provider or refund processor is invoked.
   await admin.query("update app.payment_orders set status='refunded' where id=$1",[item.id]);
   assert.deepEqual(await store.claim(item.id),result);assert.deepEqual(await store.read(item.id),result.case);
  });
  await suite.test('a coherent checksum does not admit a malformed original response receipt',async()=>{
   const item=await purchase({receipt:true}),body=JSON.parse(item.requestBody);body.receipt=null;const fault=await admin.connect();
   try{await fault.query('begin');await fault.query('alter table app.payment_checkout_intents disable trigger payment_intent_immutable');
    await fault.query('alter table app.payment_checkout_intents disable trigger reconciliation_lock_only');
    await fault.query("update app.payment_checkout_intents set request_body=$2,request_sha256=encode(sha256(convert_to($2,'UTF8')),'hex') where id=$1",[item.id,JSON.stringify(body)]);
    await fault.query('alter table app.payment_checkout_intents enable trigger payment_intent_immutable');
    await fault.query('alter table app.payment_checkout_intents enable always trigger reconciliation_lock_only');await fault.query('commit');
   }finally{await fault.query('rollback');fault.release();}
   await assert.rejects(store.claim(item.id));
   await assert.rejects(db.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[item.id,merchant.shopId]),{code:'23514'});
   assert.equal(await store.read(item.id),null);
  });
 }finally{
  await db?.close();await ownerDb?.close();await admin?.end();
  if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels[label],name);await docker(['rm','--force','--volumes',container]);}
 }
});
