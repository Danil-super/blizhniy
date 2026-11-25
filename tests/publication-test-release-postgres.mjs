// Disposable PostgreSQL, synthetic identities and provider responses; no production credentials or network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes,randomUUID,randomInt} from 'node:crypto';
import {readFile,readdir,mkdtemp,symlink,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getListingViewsMigration,getBookingLifecycleMigration,getPublicationTestMigrationPlan,getInboxPreferenceMigration,getPaidResponseMigrations} from '../scripts/publication-test-release-plan.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';
import {getSpecialistCheckoutMigration,specialistCheckoutRuntimeGrants} from '../scripts/specialist-checkout-release.mjs';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {createRequire} from 'node:module';
import {checkSpecialistServiceStartup} from './specialist-service-startup-cases.mjs';
import {readAccountExport} from '../scripts/export-local-account-data.mjs';
import {inspectAccountDeletionCase} from '../src/lib/account-deletion-preflight.ts';
import {listingViewDigest} from '../src/lib/listing-view-history.ts';
import {testAdminPaymentJournal} from './admin-payment-journal-integration.mjs';
import {getHostedRefundMigrationPlan,getHostedRefundMigrationSql,getHostedRefundUpgradeSql,getHostedMarqueeRefundUpgradeSql,getHostedMarqueeRefundRecoveryMigration,getHostedPlacementRefundProofUpgradeSql,getHostedPlacementRefundProofMigration,getUndeliveredResponseCompensationMigration} from '../scripts/publication-test-release-plan.mjs';
import {buildRefundOperator} from '../scripts/build-refund-operator.mjs';
import {buildRefundWorker} from '../scripts/build-refund-worker.mjs';
import {getHostedMarqueeAdmissionMigration,getHostedMarqueeAdmissionUpgradeSql,getHostedPlacementRenewalMigration,getHostedPlacementRenewalUpgradeSql,getHostedSpecialistRepeatMigration,getHostedSpecialistRepeatUpgradeSql,getHostedSpecialistRefundMigration,getHostedSpecialistRefundUpgradeSql} from '../scripts/publication-test-release-plan.mjs';
import {testHostedMarqueeRefund,testHostedPlacementRefundWithReceipt,testHostedRefundWorkflow,testHostedSpecialistRefund,testHostedSpecialistRepeat,testHostedPlacementRenewals,testHostedMarqueeAdmission} from './hosted-refund-workflow-cases.mjs';
import {testHostedUndeliveredCompensation} from './hosted-undelivered-compensation-cases.mjs';
import {testHostedPaidResponses} from './hosted-paid-response-cases.mjs';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-publication-test-'+randomBytes(8).toString('hex'),label='blizhniy.publication-test-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();

const layouts=[
 {name:'release journal',specialistTerms:false,inbox:false},
 {name:'specialist terms',specialistTerms:true,inbox:false},
 {name:'inbox preferences',specialistTerms:false,inbox:true},
 {name:'specialist terms and inbox preferences',specialistTerms:true,inbox:true},
 {name:'hosted specialist admission',specialistTerms:true,inbox:false,account:true},
 {name:'hosted specialist admission and inbox preferences',specialistTerms:true,inbox:true,account:true},
];
for(const {name:layout,specialistTerms,inbox,account} of layouts)test((account?'specialist service startup on ':'candidate production TEST release: exact schema/ACL, compiled worker, original admission and one fulfillment on ')+layout,{timeout:90000},async suite=>{
 let container,admin,db,workerDb,artifactDirectory;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network forbidden');};
 const variables=['BLIZHNIY_AUTH_MODE','BLIZHNIY_AUTH_ORIGIN','BLIZHNIY_LISTING_WORKFLOW','BLIZHNIY_LOCAL_PRIMARY'];
 const saved=Object.fromEntries(variables.map(k=>[k,process.env[k]]));Object.assign(process.env,{BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});delete process.env.BLIZHNIY_LOCAL_PRIMARY;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory',account&&inbox?'768m':'512m','--cpus','1','--tmpfs',account&&inbox?'/var/lib/postgresql:rw,size=536870912':'/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({...config,max:3});db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:4}));
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d{4}-[a-z-]+\.sql$/.test(n)&&n<'0034').sort();assert.equal(migrations.length,33);
  for(const n of migrations)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  const release=getPublicationTestMigrationPlan();assert.equal(release.length,36);
  for(const migration of release.slice(33))await admin.query(migration.sql);
  await admin.query('create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public;revoke all on database blizhniy_test from public;revoke all on schema public from public');
  for(const {name,sha256} of release)await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
  const rolePlan=getPaymentReconciliationRolePlan(config.database,{cabinet:true,publicationTest:true}),workerPassword=randomBytes(32).toString('hex');await admin.query(rolePlan.createRole);await admin.query(`alter role ${rolePlan.role} login password '${workerPassword}'`);
  workerDb=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:rolePlan.role,password:workerPassword,max:2}));
  const preflight=()=>verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true});
  await suite.test('role fails before grants and passes only its exact production suffix and minimal column rights',async()=>{
   await assert.rejects(preflight());for(const grant of rolePlan.grants)await admin.query(grant);await preflight();
   await assert.rejects(verifyPaymentReconciliationDatabase(workerDb,{database:config.database}));
   await admin.query('grant select(email) on app.users to blizhniy_payment_reconciler');await assert.rejects(preflight());await admin.query('revoke select(email) on app.users from blizhniy_payment_reconciler');await preflight();
   await admin.query("insert into blizhniy_meta.migrations(name,sha256) values('0060-unknown.sql',repeat('0',64))");await assert.rejects(preflight());await admin.query("delete from blizhniy_meta.migrations where name='0060-unknown.sql'");await preflight();
  });
  await suite.test('disabled fences and changed journal hashes refuse startup',async()=>{
   for(const [table,trigger] of [['listings','listing_checkout_edit_fence'],['work_publications','work_checkout_edit_fence'],['listing_photos','listing_checkout_photo_fence'],['work_publication_photos','work_checkout_photo_fence'],['work_owner_actions','work_owner_action_guard'],['work_owner_actions','work_owner_action_effect'],['work_owner_actions','work_owner_action_truncate_guard'],['specialist_categories','reconciliation_lock_only']]){
    await admin.query(`alter table app.${table} disable trigger ${trigger}`);await assert.rejects(preflight());await admin.query(`alter table app.${table} enable always trigger ${trigger}`);
   }
   await admin.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0059-test-placement-guards.sql'");await assert.rejects(preflight());await admin.query('update blizhniy_meta.migrations set sha256=$1 where name=$2',[release.at(-1).sha256,release.at(-1).name]);await preflight();
  });
  artifactDirectory=await mkdtemp(join(tmpdir(),'blizhniy-publication-worker-test-'));const artifact=join(artifactDirectory,'artifact');buildPaymentWorker(artifact,{publicationTest:true});await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
  const compiledWorker=createRequire(import.meta.url)(join(artifact,'compiled/lib/payment-reconciliation-worker.js')).createPaymentReconciliationWorker;
  const copiedGuard=await import(pathToFileURL(join(artifact,'scripts/payment-reconciliation-role.mjs')).href);
  await suite.test('copied artifact preflight works with only packaged migrations and rejects changed copied bytes',async()=>{
   const check=()=>copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true});await check();
   const path=join(artifact,'database/candidates/0059-test-placement-guards.sql'),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('\n-- changed bytes\n')]));await assert.rejects(check());await writeFile(path,bytes);await check();
  });
  if(specialistTerms)await suite.test('compiled worker accepts the exact additive schema with its original role and merchant scope',async()=>{
   const migrate=getSpecialistCheckoutMigration();
   const check=()=>copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true});
   await admin.query('create role blizhniy_runtime nologin');await admin.query(migrate.source);
   for(const statement of specialistCheckoutRuntimeGrants)await admin.query(statement);
   await assert.rejects(check());
   await admin.query('alter table app.specialist_checkout_terms rename to incomplete_terms');
   try{await assert.rejects(check());}finally{await admin.query('alter table app.incomplete_terms rename to specialist_checkout_terms');}
   await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migrate.name,'0'.repeat(64)]);
   await assert.rejects(check());
   await admin.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[migrate.name,migrate.sha256]);
   await check();await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database}));
   const interventions=[
    ['alter table app.specialist_checkout_terms disable trigger specialist_checkout_terms_guard','alter table app.specialist_checkout_terms enable trigger specialist_checkout_terms_guard'],
    ['grant update(created_at) on app.specialist_checkout_terms to blizhniy_runtime','revoke update(created_at) on app.specialist_checkout_terms from blizhniy_runtime'],
    ['grant select(intent_id) on app.specialist_checkout_terms to blizhniy_payment_reconciler','revoke select(intent_id) on app.specialist_checkout_terms from blizhniy_payment_reconciler'],
   ];
   for(const [change,restore] of interventions){
    await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();
   }
   const path=join(artifact,'database/candidates',migrate.name),bytes=await readFile(path);assert.equal(bytes.toString(),migrate.source);
   await writeFile(path,Buffer.concat([bytes,Buffer.from('\n-- fixture\n')]));
   try{await assert.rejects(check());}finally{await writeFile(path,bytes);}await check();
   assert.equal(load('specialist-checkout-config').readSpecialistCheckoutEnabled(),false);
  });
  const inboxMigration=getInboxPreferenceMigration();
  const check=()=>copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true});
  if(inbox)await suite.test('the packaged worker admits only the reviewed inbox migration and function grants',async()=>{
   await admin.query(inboxMigration.sql);
   await assert.rejects(check());
   await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[inboxMigration.name,'f'.repeat(64)]);
   await assert.rejects(check());
   await admin.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[inboxMigration.name,inboxMigration.sha256]);
   await check();
   await admin.query('create role inbox_readonly_fixture nologin');
   for(const [change,restore] of [
    ['alter table app.notifications disable trigger apply_inbox_preference','alter table app.notifications enable trigger apply_inbox_preference'],
    ['grant execute on function app.apply_inbox_preference() to inbox_readonly_fixture','revoke execute on function app.apply_inbox_preference() from inbox_readonly_fixture'],
    ['grant execute on function app.apply_inbox_preference() to public','revoke execute on function app.apply_inbox_preference() from public'],
   ]){
    await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(restore);}await check();
   }
   const path=join(artifact,'database/candidates',inboxMigration.name),bytes=await readFile(path);
   assert.equal(bytes.toString(),inboxMigration.sql);
   await writeFile(path,Buffer.concat([bytes,Buffer.from('\n-- fixture\n')]));
   try{await assert.rejects(check());}finally{await writeFile(path,bytes);}await check();
  });
  if(account){
   await checkSpecialistServiceStartup({suite,admin,config,workerDb,copiedGuard,artifact,docker,container,
    connect:database=>new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}))});
   if(inbox)await suite.test('hosted checkout requires the exact pair of Telegram owner policies when present',async()=>{
    await admin.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
    const verify=()=>copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true,specialistAccountTest:true});
    await check();await verify();
    await admin.query('alter policy phone_binding_server on app.telegram_phone_bindings with check(true)');
    await assert.rejects(verify());
   });
   if(inbox)await suite.test('packaged worker accepts the journaled hosted booking schema with its original financial rights',async()=>{
    await admin.query('drop policy phone_binding_server on app.telegram_phone_bindings;drop policy phone_attempt_server on app.telegram_phone_attempts');
    await admin.query(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8'));
    await check();
    const booking=getBookingLifecycleMigration();
    const packaged=await readFile(join(artifact,'database/migrations',booking.name),'utf8');
    assert.equal(packaged,booking.sql);
    await admin.query(packaged);
    await admin.query(await readFile(new URL('../database/permissions/booking-lifecycle.sql',import.meta.url),'utf8'));
    await assert.rejects(check());
    await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[booking.name,booking.sha256]);
    await check();
    await copiedGuard.verifyPaymentReconciliationDatabase(workerDb,{database:config.database,publicationTest:true,specialistAccountTest:true});
    const database='booking_service_restored';
    await admin.query('create database booking_service_restored template template0');
    await admin.query('revoke all on database booking_service_restored from public;grant connect on database booking_service_restored to blizhniy_payment_reconciler');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{
     for(const specialistAccountTest of [false,true])await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true,specialistAccountTest});
    }finally{await restored.close();}
    await admin.query('alter table app.booking_requests disable trigger booking_lifecycle_guard');
    await assert.rejects(check());
    await admin.query('alter table app.booking_requests enable always trigger booking_lifecycle_guard');
    await check();
    await admin.query('grant select on app.booking_events to blizhniy_payment_reconciler');
    await assert.rejects(check());
   });
   if(inbox)await suite.test('packaged worker checks the shared views and bookings schema, exact grants and restored schema',async()=>{
    await admin.query('revoke select on app.booking_events from blizhniy_payment_reconciler');
    await check();
    const migration=getListingViewsMigration();
    const packaged=await readFile(join(artifact,'database/candidates',migration.name),'utf8');
    assert.equal(packaged,migration.sql);
    await admin.query(packaged);
    await admin.query(await readFile(new URL('../database/permissions/listing-views.sql',import.meta.url),'utf8'));
    await assert.rejects(check());
    await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);
    await check();
    for(const [change,undo] of [
     ['grant select(viewer_digest) on app_stats.listing_views to blizhniy_runtime','revoke select(viewer_digest) on app_stats.listing_views from blizhniy_runtime'],
     ['grant usage on schema app_stats to public','revoke usage on schema app_stats from public'],
     ['grant usage on schema app_stats to blizhniy_runtime with grant option','revoke grant option for usage on schema app_stats from blizhniy_runtime'],
    ]){
     await admin.query(change);try{await assert.rejects(check());}finally{await admin.query(undo);}
     await check();
    }
    const database='listing_views_service_restored';
    await admin.query('create database listing_views_service_restored template template0');
    await admin.query('revoke all on database listing_views_service_restored from public;grant connect on database listing_views_service_restored to blizhniy_payment_reconciler');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true,specialistAccountTest:true});}
    finally{await restored.close();}
   });
   if(inbox)await suite.test('paid response service also accepts the exact combined bookings and views release',async()=>{
    const verify=(db=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(db,{database,publicationTest:true,specialistAccountTest:true});
    for(const migration of getPaidResponseMigrations()){
     await admin.query(migration.sql);
     await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[migration.name,migration.sha256]);
    }
    assert.equal(await verify(),true);
    await admin.query('alter table app.booking_requests disable trigger booking_lifecycle_guard');
    try{await assert.rejects(verify());}finally{await admin.query('alter table app.booking_requests enable always trigger booking_lifecycle_guard');}
    await admin.query('grant select(viewer_digest) on app_stats.listing_views to blizhniy_runtime');
    try{await assert.rejects(verify());}finally{await admin.query('revoke select(viewer_digest) on app_stats.listing_views from blizhniy_runtime');}
    assert.equal(await verify(),true);
    const database='paid_response_bookings_views_restored';
    await admin.query('create database paid_response_bookings_views_restored template template0');
    await admin.query('revoke all on database paid_response_bookings_views_restored from public;grant connect on database paid_response_bookings_views_restored to blizhniy_payment_reconciler');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{assert.equal(await verify(restored,database),true);}finally{await restored.close();}
   });
   if(inbox)await suite.test('account export reads the hosted release without staging financial relations',async t=>{
    const {rows:[schema]}=await admin.query(`select (select count(*)::int from blizhniy_meta.migrations) as migrations,
     to_regclass('app.payment_checkout_cancellations') as cancelled_payment_relation,
     to_regclass('app.payment_renewals') as renewal_relation`);
    assert.deepEqual(schema,{migrations:43,cancelled_payment_relation:null,renewal_relation:null});
    const subject=randomUUID(),peer=randomUUID();
    const token=randomBytes(32).toString('hex'),peerToken=randomBytes(32).toString('hex');
    const options={listingViewRateSecret:randomBytes(32).toString('hex')};
    const hash=load('identity').hashSessionToken;
    const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);
    const payments=[];
    for(const [id,key] of [[subject,token],[peer,peerToken]]){
     await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
      [id,id+'@publication.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
     await admin.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash(key),id]);
     await admin.query("insert into app.notifications(user_id,event_key,category,tone,title,body) values($1,'export-fixture','system','info','Проверка',$2)",[id,id]);
     const paymentId=randomUUID(),targetId=randomUUID(),tariffId='listing-publication',amount='199.00';
     const requestBody=JSON.stringify({amount:{value:amount,currency:'RUB'},capture:true,
      confirmation:{type:'redirect',return_url:'https://example.invalid/'},
      metadata:{localPaymentId:paymentId,targetType:'listing',targetId,tariffId}});
     await db.transaction(tx=>intents.persistInTransaction(tx,{id:paymentId,ownerId:id,targetType:'listing',targetId,
      targetRevision:'1',tariffId,amount,durationDays:30,shopId:'publication-fixture',isTest:true,requestBody}));
     payments.push(paymentId);
    }
    const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
    t.after(()=>{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;});
    const category=(await admin.query("insert into app.categories(slug,name) values('export-view-fixture','Тестовая категория') returning id")).rows[0].id;
    const region=(await admin.query("insert into app.regions(slug,name) values('export-view-region','Тестовый регион') returning id")).rows[0].id;
    const city=(await admin.query("insert into app.cities(region_id,slug,name) values($1,'export-view-city','Тестовый город') returning id",[region])).rows[0].id;
    const listing=(await admin.query(`insert into app.listings(author_id,category_id,city_id,listing_type,title,description,status,is_paid,published_at,expires_at)
     values($1,$2,$3,'sell','Синтетическое объявление','Стендовая проверка просмотров','published',true,now(),now()+interval '1 day') returning id`,[peer,category,city])).rows[0].id;
    const fingerprint=listingViewDigest(options.listingViewRateSecret,listing,'user:'+subject);
    assert.equal((await admin.query('select app_stats.record_listing_view($1,$2,true) as total',[listing,fingerprint])).rows[0].total,1);
    const baseline=await readAccountExport(db,token,subject,undefined,options);
    assert.equal(baseline.account.id,subject);
    assert.deepEqual(baseline.listingViews,[{listing_id:listing}]);
    assert.deepEqual(baseline.notifications.map(row=>row.body),[subject]);
    assert.deepEqual(baseline.payments.map(row=>[row.id,row.cancelled_at]),[[payments[0],null]]);
    assert.equal(JSON.stringify(baseline).includes(payments[1]),false);
    assert.equal(JSON.stringify(baseline).includes(peer),false);
    await admin.query(await readFile(new URL('../database/permissions/local-account-export-reader.sql',import.meta.url),'utf8'));
    const readerPassword=randomBytes(32).toString('hex');
    await admin.query('alter role blizhniy_local_export_reader login password '+pg.escapeLiteral(readerPassword));
    const reader=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'blizhniy_local_export_reader',password:readerPassword,max:1}));
    t.after(async()=>{
     await reader.close();
     await admin.query('drop policy local_export_phone_owner on app.telegram_phone_bindings;drop policy local_export_phone_owner on app.telegram_phone_attempts;drop owned by blizhniy_local_export_reader;drop role blizhniy_local_export_reader');
    });
    const actual=await readAccountExport(reader,token,subject,undefined,options);
    assert.deepEqual({...actual,snapshot:null},{...baseline,snapshot:null});
    await assert.rejects(readAccountExport(reader,peerToken,subject),{name:'DeletionAccessError'});
    await assert.rejects(readAccountExport(reader,peerToken,subject,undefined,options),{name:'DeletionAccessError'});
   });
   if(inbox)await suite.test('deletion preflight detects hosted bookings and unfinished payments without staging journals',async()=>{
    const host=randomUUID(),guest=randomUUID(),token=randomBytes(32).toString('hex');
    for(const id of [host,guest])await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
     [id,id+'@publication.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
    await admin.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[load('identity').hashSessionToken(token),host]);
    const {request}=await new(load('postgres-account-deletion').PostgresAccountDeletionStore)(db).request(token,host);
    const listing=(await admin.query("insert into app.listings(author_id,listing_type,title,description) values($1,'rent','Синтетическая аренда','Стендовая проверка заявки на удаление') returning id",[host])).rows[0].id;
    const booking=await db.transaction(async tx=>{
     await tx.query("select set_config('blizhniy.booking_actor',$1,true)",[guest]);
     return(await tx.query(`insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot)
      values($1,$2,$3,'stay',current_date+2,current_date+3,1,100,'{}') returning id`,[listing,guest,randomUUID()])).rows[0].id;
    });
    const paymentId=randomUUID(),tariffId='listing-publication',amount='199.00';
    const requestBody=JSON.stringify({amount:{value:amount,currency:'RUB'},capture:true,
     confirmation:{type:'redirect',return_url:'https://example.invalid/'},
     metadata:{localPaymentId:paymentId,targetType:'listing',targetId:listing,tariffId}});
    const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);
    await db.transaction(tx=>intents.persistInTransaction(tx,{id:paymentId,ownerId:host,targetType:'listing',targetId:listing,
     targetRevision:'1',tariffId,amount,durationDays:30,shopId:'publication-fixture',isTest:true,requestBody}));
    const options={listingViewRateSecret:randomBytes(32).toString('hex')};
    const preflight=()=>db.readTransaction(tx=>inspectAccountDeletionCase(tx,request.id,request.revision,options),{timeoutMs:5000});
    const open=await preflight();
    assert.equal(open.subject.id,host);assert.equal(open.decision,'manual-review');assert.equal(open.executionAuthorized,false);
    assert.equal(open.counts.openBookings,'1');assert.equal(open.counts.openPayments,'1');
    assert.deepEqual(open.blockers.map(blocker=>blocker.code),['PAYMENT_UNSETTLED','BOOKING_OPEN']);
    await db.transaction(async tx=>{
     await tx.query("select set_config('blizhniy.booking_actor',$1,true)",[guest]);
     await tx.query("update app.booking_requests set status='cancelled',revision=revision+1,cancelled_by=$2,cancellation_reason='Синтетическая отмена' where id=$1",[booking,guest]);
    });
    const cancelled=await preflight();
    assert.equal(cancelled.counts.bookings,'1');assert.equal(cancelled.counts.openBookings,'0');
    assert.deepEqual(cancelled.blockers.map(blocker=>blocker.code),['PAYMENT_UNSETTLED']);
    assert.equal(cancelled.executionAuthorized,false);
    await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',2,2,12,$3)",
     [host,randomUUID(),'a'.repeat(64)]);
    const uploading=await preflight();
    assert.equal(uploading.counts.openUploads,'1');
    assert.deepEqual(uploading.blockers.map(blocker=>blocker.code),['PAYMENT_UNSETTLED','UPLOAD_UNSETTLED']);
    await admin.query('create table app.payment_refund_reservations(id uuid,payment_intent_id uuid)');
    try{await assert.rejects(preflight(),{name:'DeletionPreflightUnavailableError'});}
    finally{await admin.query('drop table app.payment_refund_reservations');}
   });
   if(inbox)await suite.test('the packaged worker starts on the exact checkout cancellation release and its restore',async()=>{
    const verify=(db=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(db,{
     database,publicationTest:true,specialistAccountTest:true,
    });
    assert.equal(await verify(),true);
    for(const path of ['migrations/0047-checkout-cancellation.sql','candidates/0071-checkout-cancellation-test-policy.sql']){
     const name=path.split('/').at(-1),sql=await readFile(new URL('../database/'+path,import.meta.url),'utf8');
     await admin.query(sql);
     await assert.rejects(verify());
     await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    await admin.query(await readFile(new URL('../database/permissions/checkout-cancellation.sql',import.meta.url),'utf8'));
    assert.equal(await verify(),true);
    const candidate=join(artifact,'database/candidates/0071-checkout-cancellation-test-policy.sql'),bytes=await readFile(candidate);
    await writeFile(candidate,Buffer.concat([bytes,Buffer.from('\n-- changed bytes\n')]));
    try{await assert.rejects(verify());}finally{await writeFile(candidate,bytes);}
    assert.equal(await verify(),true);
    for(const [change,restore] of [
     ['revoke insert(payment_id) on app.payment_checkout_cancellations from blizhniy_runtime',
      'grant insert(payment_id) on app.payment_checkout_cancellations to blizhniy_runtime'],
     ['alter table app.payment_dispatch_anchors disable trigger checkout_cancellation_dispatch_fence',
      'alter table app.payment_dispatch_anchors enable always trigger checkout_cancellation_dispatch_fence'],
     ['grant select(shop_id) on app.checkout_cancellation_test_enrollment to blizhniy_runtime',
      'revoke select(shop_id) on app.checkout_cancellation_test_enrollment from blizhniy_runtime'],
     ['grant update(status) on app.payment_orders to blizhniy_runtime',
      'revoke update(status) on app.payment_orders from blizhniy_runtime'],
     ['grant select on app.payment_checkout_cancellations to blizhniy_payment_reconciler',
      'revoke select on app.payment_checkout_cancellations from blizhniy_payment_reconciler'],
    ]){
     await admin.query(change);try{await assert.rejects(verify());}finally{await admin.query(restore);}
     assert.equal(await verify(),true);
    }
    const database='checkout_cancellation_release_restored';
    await admin.query('create database checkout_cancellation_release_restored template template0');
    await admin.query('revoke all on database checkout_cancellation_release_restored from public;grant connect on database checkout_cancellation_release_restored to blizhniy_payment_reconciler');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restoredWorker=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{assert.equal(await verify(restoredWorker,database),true);}finally{await restoredWorker.close();}
   });
   if(inbox)await suite.test('the packaged worker accepts audited recovery and verifies the separate operator after restore',async()=>{
    const verify=(connection=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(connection,{
     database,publicationTest:true,specialistAccountTest:true,
    });
    assert.equal(await verify(),true);
    const name='0072-payment-reconciliation-recovery.sql';
    const sql=await readFile(new URL('../database/candidates/'+name,import.meta.url),'utf8');
    await admin.query(sql);
    await assert.rejects(verify());
    await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    await admin.query('create role blizhniy_reconciliation_operator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;grant connect on database blizhniy_test to blizhniy_reconciliation_operator');
    await admin.query(await readFile(new URL('../database/permissions/payment-reconciliation-recovery.sql',import.meta.url),'utf8'));
    assert.equal(await verify(),true);
    for(const [change,restore] of [
     ['alter table app.payment_reconciliation_jobs disable trigger reconciliation_recovery_phone_budget',
      'alter table app.payment_reconciliation_jobs enable always trigger reconciliation_recovery_phone_budget'],
     ['grant select(reason) on app.payment_reconciliation_recoveries to blizhniy_payment_reconciler',
      'revoke select(reason) on app.payment_reconciliation_recoveries from blizhniy_payment_reconciler'],
     ['grant update(state) on app.payment_reconciliation_jobs to blizhniy_reconciliation_operator',
      'revoke update(state) on app.payment_reconciliation_jobs from blizhniy_reconciliation_operator'],
     ['grant execute on function app.read_payment_reconciliation_recovery_status(text,uuid,text) to blizhniy_runtime',
      'revoke execute on function app.read_payment_reconciliation_recovery_status(text,uuid,text) from blizhniy_runtime'],
    ]){
     await admin.query(change);try{await assert.rejects(verify());}finally{await admin.query(restore);}
     assert.equal(await verify(),true);
    }
    const database='reconciliation_recovery_release_restored';
    await admin.query('create database reconciliation_recovery_release_restored template template0');
    await admin.query('revoke all on database reconciliation_recovery_release_restored from public;grant connect on database reconciliation_recovery_release_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{assert.equal(await verify(restored,database),true);}finally{await restored.close();}
   });
   if(inbox)await suite.test('the packaged worker accepts the alert probe with a separate read-only monitor after restore',async()=>{
    const verify=(connection=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(connection,{
     database,publicationTest:true,specialistAccountTest:true,
    });
    assert.equal(await verify(),true);
    const name='0073-payment-reconciliation-alert.sql';
    const sql=await readFile(new URL('../database/candidates/'+name,import.meta.url),'utf8');
    await admin.query(sql);
    await assert.rejects(verify());
    await admin.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    await admin.query('create role blizhniy_reconciliation_monitor login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;grant connect on database blizhniy_test to blizhniy_reconciliation_monitor');
    await admin.query(await readFile(new URL('../database/permissions/payment-reconciliation-alert.sql',import.meta.url),'utf8'));
    assert.equal(await verify(),true);
    const sourceFile=join(artifact,'database','candidates',name),sourceBytes=await readFile(sourceFile);
    await writeFile(sourceFile,Buffer.concat([sourceBytes,Buffer.from('\n-- changed bytes\n')]));
    try{await assert.rejects(verify());}finally{await writeFile(sourceFile,sourceBytes);}
    assert.equal(await verify(),true);
    for(const [change,restore] of [
     ['grant select(intent_id) on app.payment_reconciliation_jobs to blizhniy_reconciliation_monitor',
      'revoke select(intent_id) on app.payment_reconciliation_jobs from blizhniy_reconciliation_monitor'],
     ['grant execute on function app.payment_reconciliation_alert_needed(text) to blizhniy_runtime',
      'revoke execute on function app.payment_reconciliation_alert_needed(text) from blizhniy_runtime'],
     ['revoke execute on function app.payment_reconciliation_alert_needed(text) from blizhniy_reconciliation_monitor',
      'grant execute on function app.payment_reconciliation_alert_needed(text) to blizhniy_reconciliation_monitor'],
    ]){
     await admin.query(change);try{await assert.rejects(verify());}finally{await admin.query(restore);}
     assert.equal(await verify(),true);
    }
    const database='reconciliation_alert_release_restored';
    await admin.query('create database reconciliation_alert_release_restored template template0');
    await admin.query('revoke all on database reconciliation_alert_release_restored from public;grant connect on database reconciliation_alert_release_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,blizhniy_reconciliation_monitor');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{assert.equal(await verify(restored,database),true);}finally{await restored.close();}
   });
   if(inbox){await testAdminPaymentJournal(suite,{admin,config,load,full:false});assert.equal(await check(),true);}
   if(inbox)await suite.test('the hosted refund package is atomic, preserves cancellation and is admitted by the packaged reconciler',async()=>{
    const verify=(connection=workerDb,database=config.database)=>copiedGuard.verifyPaymentReconciliationDatabase(connection,{
     database,publicationTest:true,specialistAccountTest:true,
    });
    const definitions=async()=>(await admin.query(`select pg_get_functiondef('app.guard_checkout_cancellation()'::regprocedure) as guard,
     pg_get_constraintdef(oid) as kinds from pg_constraint where conrelid='app.payment_checkout_cancellations'::regclass
      and conname='payment_checkout_cancellations_target_type_check'`)).rows[0];
    const before=await definitions(),sql=getHostedRefundMigrationSql(),plan=getHostedRefundMigrationPlan();
    const apply=async(text)=>{
     const client=await admin.connect();
     try{return await client.query(text);}
     catch(error){await client.query('rollback');throw error;}
     finally{client.release();}
    };
    const journal=async()=>(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
    const initial=await journal(), altered=initial[0];
    assert.equal(await verify(),true);
    await admin.query('update blizhniy_meta.migrations set sha256=repeat(\'0\',64) where name=$1',[altered.name]);
    try{await assert.rejects(apply(sql),{code:'55000'});}
    finally{await admin.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[altered.name,altered.sha256]);}
    await assert.rejects(apply(sql.replace(/\ncommit;\n$/,"\nselect 1/0;\ncommit;\n")),{code:'22012'});
    assert.deepEqual(await journal(),initial);
    assert.deepEqual(await definitions(),before);
    assert.equal((await admin.query("select to_regclass('app.payment_refund_reservations') as refunds")).rows[0].refunds,null);
    assert.equal(await verify(),true);
    await apply(sql);
    assert.deepEqual(await definitions(),before);
    assert.deepEqual(await journal(),[...initial,...plan.map(({name,sha256})=>({name,sha256}))].sort((a,b)=>a.name.localeCompare(b.name,'en')));
    await assert.rejects(apply(sql),{code:'55000'});
    assert.equal(await verify(),true);
    const candidate=join(artifact,'database/candidates/0075-hosted-refund-compatibility.sql'),bytes=await readFile(candidate);
    await writeFile(candidate,Buffer.concat([bytes,Buffer.from('\n-- changed bytes\n')]));
    try{await assert.rejects(verify());}finally{await writeFile(candidate,bytes);}
    for(const [change,restore] of [
     ['grant select(payment_intent_id) on app.payment_refund_reservations to blizhniy_payment_reconciler',
      'revoke select(payment_intent_id) on app.payment_refund_reservations from blizhniy_payment_reconciler'],
     ['alter table app.payment_refund_reservations disable trigger placement_refund_reservation_guard',
      'alter table app.payment_refund_reservations enable trigger placement_refund_reservation_guard'],
    ]){
     await admin.query(change);try{await assert.rejects(verify());}finally{await admin.query(restore);}
     assert.equal(await verify(),true);
    }
    const database='hosted_refunds_restored';
    await admin.query('create database hosted_refunds_restored template template0');
    await admin.query('revoke all on database hosted_refunds_restored from public;grant connect on database hosted_refunds_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,blizhniy_reconciliation_monitor');
    await docker(['exec',container,'bash','-euo','pipefail','-c',
     'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
     'restore-fixture',config.database,database]);
    const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
    try{assert.equal(await verify(restored,database),true);}finally{await restored.close();}
    assert.equal(await verify(),true);
   });
   if(inbox)await suite.test('separate hosted TEST refund artifacts admit only their own restricted database roles',async t=>{
    const PostgresDatabase=load('postgres').PostgresDatabase;
    const entries=[
     {kind:'operator',build:buildRefundOperator,plan:'getRefundOperatorRolePlan',verify:'verifyRefundOperatorDatabase'},
     {kind:'worker',build:buildRefundWorker,plan:'getRefundWorkerRolePlan',verify:'verifyRefundWorkerDatabase'},
    ];
    try{
     for(const entry of entries){
      const destination=join(artifactDirectory,'refund-'+entry.kind);
      assert.equal(entry.build(destination,{schema:75}).schema,75);
      const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
      const plan=api[entry.plan](config.database,{schema:75}),password=randomBytes(32).toString('hex');
      assert.equal(plan.journal.length,67);assert.equal(plan.journal.at(-1).name,'0075-hosted-refund-compatibility.sql');
      await admin.query(plan.createRole);
      await admin.query('alter role '+plan.role+' login password '+pg.escapeLiteral(password));
      for(const grant of plan.grants)await admin.query(grant);
      await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
      Object.assign(entry,{destination,role:plan.role,password});
      entry.db=new PostgresDatabase(new pg.Pool({...config,user:plan.role,password,max:2}));
      const options={database:config.database,merchant:{shopId:'hosted-refund-fixture',isTest:true}};
      entry.admit=connection=>api[entry.verify](connection,{...options,hostedRefunds:true});
      await entry.admit(entry.db);
      await assert.rejects(api[entry.verify](entry.db,options));
      await assert.rejects(api[entry.verify](entry.db,{...options,hostedRefunds:true,merchant:{...options.merchant,isTest:false}}));
      await assert.rejects(api[entry.verify](entry.db,{...options,hostedRefunds:true,localPrimary:true}));
     }
     const [operator,worker]=entries;
     await assert.rejects(operator.admit(worker.db));
     await assert.rejects(worker.admit(operator.db));
     await assert.rejects(operator.db.query('select app.claim_placement_refund_job($1)',['hosted-refund-fixture']),{code:'42501'});
     assert.equal((await worker.db.query("select has_column_privilege('app.payment_refund_approvals','id','INSERT') as approve")).rows[0].approve,false);
     await admin.query('grant insert(operation_id) on app.payment_refund_dispatch_anchors to blizhniy_refund_operator');
     try{await assert.rejects(operator.admit(operator.db));}
     finally{await admin.query('revoke insert(operation_id) on app.payment_refund_dispatch_anchors from blizhniy_refund_operator');}
     await operator.admit(operator.db);
     assert.equal(await check(),true);
     await t.test('real TLS roles approve and recover original refunds over IPC after both lost responses',
      workflow=>testHostedRefundWorkflow(workflow,{admin,config,load,operator,worker,docker,container,directory:artifactDirectory}));
     await t.test('the undelivered response upgrade preserves the old release and is admitted after restore',async()=>{
      const sql=getHostedRefundUpgradeSql(),migration=getUndeliveredResponseCompensationMigration();
      assert.equal(await check(),true);
      const apply=async()=>{
       const client=await admin.connect();
       try{await client.query(sql);}
       catch(error){await client.query('rollback');throw error;}
       finally{client.release();}
      };
      await apply();
      await assert.rejects(apply(),{code:'55000'});
      const database='undelivered_compensation_restored';
      await admin.query('create database undelivered_compensation_restored template template0');
      await admin.query(`revoke all on database undelivered_compensation_restored from public;
       grant connect on database undelivered_compensation_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
        blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
      await docker(['exec',container,'bash','-euo','pipefail','-c',
       'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
       'restore-fixture',config.database,database]);
      const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
      try{
       assert.equal(await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true}),true);
      }finally{await restored.close();}
      assert.equal(await check(),true);
      await admin.query('update blizhniy_meta.migrations set sha256=repeat(\'0\',64) where name=$1',[migration.name]);
      try{await assert.rejects(check());}
      finally{await admin.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[migration.name,migration.sha256]);}
      await admin.query('alter table app.payment_orders disable trigger compensated_response_order_guard');
      try{await assert.rejects(check());}
      finally{await admin.query('alter table app.payment_orders enable always trigger compensated_response_order_guard');}
      assert.equal(await check(),true);
     });
     await t.test('separate roles process a terminally undelivered response exactly once',async()=>{
      const options={database:config.database,merchant:{shopId:'9201',isTest:true},hostedRefunds:true};
      for(const entry of entries){
       const destination=join(artifactDirectory,'compensation-'+entry.kind);
       assert.equal(entry.build(destination,{schema:76}).schema,76);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       const plan=api[entry.plan](config.database,{schema:76});
       assert.equal(plan.journal.length,68);assert.equal(plan.journal.at(-1).name,'0076-undelivered-response-compensation.sql');
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       await api[entry.verify](entry.db,options);
       const database='undelivered_compensation_restored';
       const restored=new PostgresDatabase(new pg.Pool({...config,database,user:entry.role,password:entry.password,max:2}));
       try{await api[entry.verify](restored,{...options,database});}
       finally{await restored.close();}
       entry.compensationArtifact=destination;
      }
      await testHostedUndeliveredCompensation({admin,config,workerDb,compiledWorker,load,refundWorker:worker,
       artifact:worker.compensationArtifact,directory:artifactDirectory});
     });
     await t.test('exact marquee refund upgrade preserves financial roles and frees one verified advertising slot',async()=>{
      const options={database:config.database,merchant:{shopId:'hosted-refund-fixture',isTest:true,marqueeRefunds:true},hostedRefunds:true};
      const marqueeArtifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'marquee-'+entry.kind);
       assert.equal(entry.build(destination,{schema:78}).schema,78);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       const plan=api[entry.plan](config.database,{schema:78});
       assert.equal(plan.journal.length,69);assert.equal(plan.journal.at(-1).name,getHostedMarqueeRefundRecoveryMigration().name);
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       await assert.rejects(api[entry.verify](entry.db,options));
       marqueeArtifacts.push({...entry,destination,verify:api[entry.verify]});
      }
      const apply=async()=>{
       const client=await admin.connect();
       try{await client.query(getHostedMarqueeRefundUpgradeSql());}
       catch(error){await client.query('rollback');throw error;}
       finally{client.release();}
      };
      await apply();
      await assert.rejects(apply(),{code:'55000'});
      const database='marquee_refund_restored';
      await admin.query('create database marquee_refund_restored template template0');
      await admin.query(`revoke all on database marquee_refund_restored from public;
       grant connect on database marquee_refund_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
        blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
      await docker(['exec',container,'bash','-euo','pipefail','-c',
       'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
       'restore-fixture',config.database,database]);
      const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
      try{assert.equal(await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true}),true);}
      finally{await restored.close();}
      assert.equal(await check(),true);
      for(const entry of marqueeArtifacts){
       await entry.verify(entry.db,options);
       await assert.rejects(entry.verify(entry.db,{...options,merchant:{...options.merchant,marqueeRefunds:false}}));
       const recovered=new PostgresDatabase(new pg.Pool({...config,database,user:entry.role,password:entry.password,max:2}));
       try{await entry.verify(recovered,{...options,database});}
       finally{await recovered.close();}
      }
      await admin.query('alter function app.lock_refund_recovery_source(uuid,uuid) set search_path=pg_catalog');
      try{
       await assert.rejects(check());
       for(const entry of marqueeArtifacts)await assert.rejects(entry.verify(entry.db,options));
      }finally{await admin.query("alter function app.lock_refund_recovery_source(uuid,uuid) set search_path=''");}
      await testHostedMarqueeRefund({admin,config,load,operator:marqueeArtifacts[0],worker:marqueeArtifacts[1],directory:artifactDirectory});
     });
     await t.test('refunds the original hosted checkout payment including its publication marker and receipt',async()=>{
      const migration=getHostedPlacementRefundProofMigration(),sql=getHostedPlacementRefundProofUpgradeSql();
      const options={database:config.database,merchant:{shopId:'hosted-refund-fixture',isTest:true,marqueeRefunds:true},hostedRefunds:true};
      const artifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'placement-proof-'+entry.kind);
       assert.equal(entry.build(destination,{schema:79}).schema,79);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       const plan=api[entry.plan](config.database,{schema:79});
       assert.equal(plan.journal.length,70);
       assert.deepEqual(plan.journal.at(-1),{name:migration.name,sha256:migration.sha256});
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       artifacts.push({...entry,destination,verify:api[entry.verify]});
      }
      const upgrade=async()=>{
       const apply=async()=>{
        const client=await admin.connect();
        try{await client.query(sql);}
        catch(error){await client.query('rollback');throw error;}
        finally{client.release();}
       };
       assert.equal(await check(),true);
       await apply();
       await assert.rejects(apply(),{code:'55000'});
       const database='placement_refund_proof_restored';
       await admin.query('create database placement_refund_proof_restored template template0');
       await admin.query(`revoke all on database placement_refund_proof_restored from public;
        grant connect on database placement_refund_proof_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
        blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
       await docker(['exec',container,'bash','-euo','pipefail','-c',
        'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
        'restore-fixture',config.database,database]);
       const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
       try{assert.equal(await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true}),true);}
       finally{await restored.close();}
       assert.equal(await check(),true);
       for(const entry of artifacts){
        await entry.verify(entry.db,options);
        const restoredRefund=new PostgresDatabase(new pg.Pool({...config,database,user:entry.role,password:entry.password,max:2}));
        try{await entry.verify(restoredRefund,{...options,database});}
        finally{await restoredRefund.close();}
       }
       await admin.query('alter function app.placement_refund_fiscal_mode(app.payment_checkout_intents) set search_path=pg_catalog');
       try{
        await assert.rejects(check());
        for(const entry of artifacts)await assert.rejects(entry.verify(entry.db,options));
       }finally{await admin.query("alter function app.placement_refund_fiscal_mode(app.payment_checkout_intents) set search_path=''");}
      };
      await testHostedPlacementRefundWithReceipt({admin,config,load,operator:artifacts[0],worker:artifacts[1],directory:artifactDirectory,upgrade});
     });
     await t.test('refunds the exact hosted specialist period after the original enrollment closes',async()=>{
      const schema=80,migration=getHostedSpecialistRefundMigration(),sql=getHostedSpecialistRefundUpgradeSql();
      const options={database:config.database,merchant:{shopId:'900000001',isTest:true,marqueeRefunds:true,specialistRefunds:true},hostedRefunds:true};
      const artifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'specialist-refund-'+entry.kind);
       assert.equal(entry.build(destination,{schema}).schema,schema);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       const plan=api[entry.plan](config.database,{schema});
       assert.equal(plan.journal.length,71);
       assert.deepEqual(plan.journal.at(-1),{name:migration.name,sha256:migration.sha256});
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       artifacts.push({...entry,destination,verify:api[entry.verify]});
      }
      const upgrade=async()=>{
       const apply=async()=>{
        const client=await admin.connect();
        try{await client.query(sql);}
        catch(error){await client.query('rollback');throw error;}
        finally{client.release();}
       };
       assert.equal(await check(),true);
       await apply();
       await assert.rejects(apply(),{code:'55000'});
       const database='specialist_refund_restored';
       await admin.query('create database specialist_refund_restored template template0');
       await admin.query(`revoke all on database specialist_refund_restored from public;
        grant connect on database specialist_refund_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
        blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
       await docker(['exec',container,'bash','-euo','pipefail','-c',
        'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
        'restore-fixture',config.database,database]);
       const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
       try{assert.equal(await copiedGuard.verifyPaymentReconciliationDatabase(restored,{database,publicationTest:true}),true);}
       finally{await restored.close();}
       assert.equal(await check(),true);
       for(const entry of artifacts){
        await entry.verify(entry.db,options);
        await assert.rejects(entry.verify(entry.db,{...options,merchant:{...options.merchant,specialistRefunds:false}}));
        const restoredRefund=new PostgresDatabase(new pg.Pool({...config,database,user:entry.role,password:entry.password,max:2}));
        try{await entry.verify(restoredRefund,{...options,database});}
        finally{await restoredRefund.close();}
       }
       await admin.query('alter function app.guard_specialist_publication_window() set search_path=public');
       try{
        await assert.rejects(check());
        for(const entry of artifacts)await assert.rejects(entry.verify(entry.db,options));
       }finally{await admin.query('alter function app.guard_specialist_publication_window() set search_path=pg_catalog');}
      };
      await testHostedSpecialistRefund({admin,config,load,operator:artifacts[0],worker:artifacts[1],directory:artifactDirectory,upgrade});
     });
     await t.test('hosted specialist repeat preserves each receipt and starts one new period after capture',async()=>{
      const schema=81,migration=getHostedSpecialistRepeatMigration(),sql=getHostedSpecialistRepeatUpgradeSql();
      const options={database:config.database,merchant:{shopId:'900000001',isTest:true,marqueeRefunds:true,specialistRefunds:true},hostedRefunds:true};
      const verifyOptions={database:config.database,publicationTest:true,specialistAccountTest:true};
      const artifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'specialist-repeat-'+entry.kind);
       assert.equal(entry.build(destination,{schema}).schema,schema);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       const plan=api[entry.plan](config.database,{schema});
       assert.equal(plan.journal.length,72);
       assert.deepEqual(plan.journal.at(-1),{name:migration.name,sha256:migration.sha256});
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       artifacts.push({...entry,verify:api[entry.verify]});
      }
      const apply=async()=>{
       const client=await admin.connect();
       try{await client.query(sql);}
       catch(error){await client.query('rollback');throw error;}
       finally{client.release();}
      };
      const upgrade=async()=>{
       await apply();
       await assert.rejects(apply(),{code:'55000'});
       const database='specialist_repeat_restored';
       await admin.query('create database specialist_repeat_restored template template0');
       await admin.query(`revoke all on database specialist_repeat_restored from public;
        grant connect on database specialist_repeat_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
        blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
       await docker(['exec',container,'bash','-euo','pipefail','-c',
        'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
        'restore-fixture',config.database,database]);
       const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
       const hashes=await Promise.allSettled([
        copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions),
        copiedGuard.verifyPaymentReconciliationDatabase(restored,{...verifyOptions,database}),
       ]);
       await restored.close();
       assert.deepEqual(hashes,[{status:'fulfilled',value:true},{status:'fulfilled',value:true}]);
       for(const entry of artifacts)await entry.verify(entry.db,options);
       await admin.query('alter table app.payment_orders disable trigger specialist_repeat_purchase_guard');
       try{
        await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));
        for(const entry of artifacts)await assert.rejects(entry.verify(entry.db,options));
       }finally{await admin.query('alter table app.payment_orders enable always trigger specialist_repeat_purchase_guard');}
       await admin.query('grant execute on function app.specialist_repeat_basis(uuid,uuid,bigint,text) to blizhniy_runtime');
       try{await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));}
       finally{await admin.query('revoke execute on function app.specialist_repeat_basis(uuid,uuid,bigint,text) from blizhniy_runtime');}
      };
      await testHostedSpecialistRepeat({admin,config,load,reconciler:workerDb,refundOperator:operator.db,refundWorker:worker.db,upgrade});
      await copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions);
     });
     await t.test('new hosted response checkouts deliver once and only one executor closes the customer order',async()=>{
      assert.equal(await copiedGuard.verifyPaymentReconciliationDatabase(workerDb,
       {database:config.database,publicationTest:true,applicationAccountTest:true}),true);
      await testHostedPaidResponses({admin,config,workerDb,refundDb:worker.db,compiledWorker,load});
     });
     await t.test('hosted placement renewal package pins the installed and restored worker authority',async()=>{
      const sql=getHostedPlacementRenewalUpgradeSql(),migration=getHostedPlacementRenewalMigration();
      const options={database:config.database,merchant:{shopId:'900000001',isTest:true,marqueeRefunds:true,specialistRefunds:true},hostedRefunds:true};
      const artifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'placement-renewal-'+entry.kind);
       assert.equal(entry.build(destination,{schema:82}).schema,82);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       assert.deepEqual(api[entry.plan](config.database,{schema:82}).journal.at(-1),{name:migration.name,sha256:migration.sha256});
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       artifacts.push({...entry,verify:api[entry.verify]});
      }
      const apply=async()=>{
       const client=await admin.connect();
       try{await client.query(sql);}catch(error){await client.query('rollback');throw error;}
       finally{client.release();}
      };
      await apply();
      await assert.rejects(apply(),{code:'55000'});
      assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name desc limit 1')).rows,
       [{name:migration.name,sha256:migration.sha256}]);
      const database='placement_renewal_restored';
      await admin.query('create database placement_renewal_restored template template0');
      await admin.query(`revoke all on database placement_renewal_restored from public;
       grant connect on database placement_renewal_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
       blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
      await docker(['exec',container,'bash','-euo','pipefail','-c',
       'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
       'restore-fixture',config.database,database]);
      const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
      const verifyOptions={database:config.database,publicationTest:true,specialistAccountTest:true};
      try{
       const verified=await Promise.allSettled([copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions),
        copiedGuard.verifyPaymentReconciliationDatabase(restored,{...verifyOptions,database})]);
       assert.deepEqual(verified,[{status:'fulfilled',value:true},{status:'fulfilled',value:true}]);
      }finally{await restored.close();}
      for(const entry of artifacts)await entry.verify(entry.db,options);
      await admin.query('grant execute on function app.apply_hosted_placement_renewal(uuid,uuid) to blizhniy_runtime');
      try{
       await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));
       for(const entry of artifacts)await assert.rejects(entry.verify(entry.db,options));
      }finally{await admin.query('revoke execute on function app.apply_hosted_placement_renewal(uuid,uuid) from blizhniy_runtime');}
      await admin.query('revoke execute on function app.apply_hosted_placement_renewal(uuid,uuid) from blizhniy_payment_reconciler');
      try{await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));}
      finally{await admin.query('grant execute on function app.apply_hosted_placement_renewal(uuid,uuid) to blizhniy_payment_reconciler');}
     });
     await t.test('the compiled worker settles a hosted TEST renewal for all three supported kinds',
      ()=>testHostedPlacementRenewals({admin,config,load,reconciler:workerDb,compiledWorker,refundOperator:operator.db,refundWorker:worker.db}));
     await t.test('the hosted marquee admission package pins its proof and restricted roles after restore',async()=>{
      const migration=getHostedMarqueeAdmissionMigration();
      const verifyOptions={database:config.database,publicationTest:true,specialistAccountTest:true};
      const artifactOptions={database:config.database,merchant:{shopId:'900000001',isTest:true,marqueeRefunds:true,specialistRefunds:true},hostedRefunds:true};
      const artifacts=[];
      for(const entry of entries){
       const destination=join(artifactDirectory,'marquee-admission-'+entry.kind);
       assert.equal(entry.build(destination,{schema:83}).schema,83);
       const api=await import(pathToFileURL(join(destination,'scripts/refund-'+entry.kind+'-role.mjs')).href);
       assert.deepEqual(api[entry.plan](config.database,{schema:83}).journal.at(-1),{name:migration.name,sha256:migration.sha256});
       await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(destination,'node_modules'),'dir');
       artifacts.push({...entry,verify:api[entry.verify]});
      }
      const apply=async()=>{
       const client=await admin.connect();
       try{await client.query(getHostedMarqueeAdmissionUpgradeSql());}catch(error){await client.query('rollback');throw error;}
       finally{client.release();}
      };
      await apply();
      await assert.rejects(apply(),{code:'55000'});
      const database='marquee_admission_restored';
      await admin.query('create database marquee_admission_restored template template0');
      await admin.query(`revoke all on database marquee_admission_restored from public;
       grant connect on database marquee_admission_restored to blizhniy_payment_reconciler,blizhniy_reconciliation_operator,
       blizhniy_reconciliation_monitor,blizhniy_refund_operator,blizhniy_refund_worker`);
      await docker(['exec',container,'bash','-euo','pipefail','-c',
       'pg_dump --format=custom --username=postgres --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --dbname="$2"',
       'restore-fixture',config.database,database]);
      const restored=new PostgresDatabase(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
      try{
       const verified=await Promise.allSettled([copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions),
        copiedGuard.verifyPaymentReconciliationDatabase(restored,{...verifyOptions,database})]);
       assert.deepEqual(verified,[{status:'fulfilled',value:true},{status:'fulfilled',value:true}]);
      }finally{await restored.close();}
      for(const entry of artifacts)await entry.verify(entry.db,artifactOptions);
      await admin.query('grant select(shop_id) on app.marquee_test_enrollment to blizhniy_runtime');
      try{
       await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));
       for(const entry of artifacts)await assert.rejects(entry.verify(entry.db,artifactOptions));
      }finally{await admin.query('revoke select(shop_id) on app.marquee_test_enrollment from blizhniy_runtime');}
      await admin.query('alter table app.payment_dispatch_anchors disable trigger hosted_marquee_dispatch_guard');
      try{await assert.rejects(copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions));}
      finally{await admin.query('alter table app.payment_dispatch_anchors enable always trigger hosted_marquee_dispatch_guard');}
      await copiedGuard.verifyPaymentReconciliationDatabase(workerDb,verifyOptions);
     });
     await t.test('only an enrolled advertising purchase can prepare, dispatch, cancel, fulfill and refund on the hosted schema',
      ()=>testHostedMarqueeAdmission({admin,config,load,reconciler:workerDb,refundOperator:operator.db,refundWorker:worker.db}));
    }finally{for(const entry of entries)await entry.db?.close();}
   });
   return;
  }
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых');insert into app.specialist_categories(slug,name,parent_name) values('plumber','Сантехник','Строительство');insert into app.tariffs(id,action,name,price,duration_days) values('listing-publication','listing_publication','Объявление',199,30),('vacancy-publication','vacancy_publication','Вакансия',199,30),('work-request-publication','work_request_publication','Заказ',199,30)");
  const city=(await admin.query('select id from app.cities')).rows[0].id,category=(await admin.query('select id from app.categories')).rows[0].id,profession=(await admin.query('select id from app.specialist_categories')).rows[0].id;
  async function actor(){
   const owner=randomUUID(),phone='+7999'+String(randomInt(10000000)).padStart(7,'0'),token=randomBytes(32).toString('hex');
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,owner+'@publication.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:'Тестовый пользователь',phone}]);await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner,phone,'test-'+owner]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),owner]);return{owner,phone,token};
  }
  const current=await actor(),other=await actor(),merchant={shopId:'publication-fixture',isTest:true,secretKey:'test_synthetic_only'},checkout={...merchant,siteOrigin:process.env.BLIZHNIY_AUTH_ORIGIN,receiptVatCode:1};
  async function draft(kind,actor=current){
   const target=kind==='listing'?(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone) values($1,'sell',$2,$3,'ТЕСТ: новое размещение','Синтетический прогон нового размещения.',$4) returning id,revision::text",[actor.owner,category,city,actor.phone])).rows[0]:
    (await admin.query('insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id) values($1,$2,$3,$4,$5,$6) returning id,revision::text',[actor.owner,kind,randomUUID(),load('work-publication-contract').parseWorkPublicationForm(kind,{kind,title:'ТЕСТ: новое размещение',description:'Синтетический прогон нового размещения.',cityName:'Краснодар',professionName:'Сантехник',professionId:profession,contactPhone:actor.phone,placementRightConfirmed:true,...(kind==='vacancy'?{employerType:'person',organization:'Иван Иванов',salary:'3500'}:{budget:'3500'})}),city,profession])).rows[0];
   return{...actor,...target,kind};
  }
  const Store=load('postgres-listing-checkout').PostgresListingCheckoutStore;
  const store=kind=>new Store(db,checkout,{postmoderation:true,...(kind==='listing'?{}:{targetType:kind}),publicationTestOwner:current.owner});
  const provider=new Map();let posts=0,gets=0;
  const fetcher=async(url,init)=>{
   assert.equal(new URL(url).origin,'https://api.yookassa.ru');
   if(init.method==='POST'){
    posts++;const body=JSON.parse(init.body);assert.equal(body.metadata.publicationMode,'account-test-v1');const id=randomUUID();provider.set(id,{body,status:'succeeded'});
    return Response.json({id,status:'pending',paid:false,test:true,recipient:{account_id:merchant.shopId},amount:body.amount,metadata:body.metadata,confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
   }
   assert.equal(init.method,'GET');gets++;const id=new URL(url).pathname.split('/').at(-1),entry=provider.get(id);assert.ok(entry);return Response.json({id,status:entry.status,paid:entry.status==='succeeded',test:true,recipient:{account_id:merchant.shopId},amount:entry.body.amount,metadata:entry.body.metadata,...(entry.status==='succeeded'?{captured_at:new Date().toISOString()}:{})});
  };
  const worker=compiledWorker(workerDb,merchant,fetcher,current.owner);
  for(const kind of ['listing','vacancy','workRequest'])await suite.test(kind+': immutable admission, session owner, provider binding, one fulfillment and stable readback',async()=>{
   const d=await draft(kind),s=store(kind),quote=await s.preview(d.token,d.owner,d.id,d.revision),input={listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays};
   const order=await s.prepare(d.token,d.owner,input);assert.deepEqual(await s.prepare(d.token,d.owner,input),order);
   const table=kind==='listing'?'listings':'work_publications';
   await assert.rejects(admin.query(`update app.${table} set ${kind==='listing'?"title='Попытка изменения'":"form=jsonb_set(form,'{title}','\"Попытка изменения\"')"} where id=$1`,[d.id]),{code:'PBL01'});
   await assert.rejects(admin.query(`insert into app.${kind==='listing'?'listing_photos(listing_id':'work_publication_photos(publication_id'},media_id,position) values($1,$2,0)`,[d.id,randomUUID()]),{code:'PBL01'});
   const raw=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body;assert.equal(JSON.parse(raw).metadata.publicationMode,'account-test-v1');
   if(kind==='vacancy'){
    const readVacancy=async()=>(await admin.query('select form,revision::text from app.work_publications where id=$1',[d.id])).rows[0];
    const snapshot=await readVacancy();
    await admin.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{organizationName}',to_jsonb($2::text)) where user_id=$1",[d.owner,'Обновлённая организация']);
    assert.deepEqual(await readVacancy(),snapshot);
    assert.deepEqual(await s.prepare(d.token,d.owner,input),order);
    assert.equal((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body,raw);
   }
   await assert.rejects(s.preview(other.token,other.owner,d.id,d.revision));
   const payment=load('account-test-listing-payment').createAccountTestListingPayment(db,s,{...merchant,ownerId:current.owner},fetcher);
   const previousPosts=posts;
   await admin.query('update app.tariffs set price=price+0.01 where id=$1',[quote.tariff.id]);
   try{
    await assert.rejects(payment.dispatch(d.token,d.owner,order.id),{name:'ListingCheckoutConflictError'});
    assert.equal(posts,previousPosts);
    assert.equal((await admin.query('select count(*)::int n from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rows[0].n,0);
    assert.equal((await s.readOrder(d.token,d.owner,order.id)).order.amount,quote.tariff.amount);
   }finally{await admin.query('update app.tariffs set price=$2 where id=$1',[quote.tariff.id,quote.tariff.amount]);}
   await payment.dispatch(d.token,d.owner,order.id);
   assert.deepEqual(await worker.tick(),{state:'completed'});const read=await s.readOrder(d.token,d.owner,order.id);assert.equal(read.order.status,'succeeded');assert.ok(read.fulfillment);
   const fulfillment=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(workerDb,merchant,{postmoderation:true,publicationTestOwner:current.owner,...(kind==='listing'?{}:{targetType:kind})});assert.equal((await fulfillment.fulfill(order.id)).state,'fulfilled');assert.deepEqual(await s.readOrder(d.token,d.owner,order.id),read);
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,1);
   const publicRow=kind==='listing'?await new(load('postgres-public-listings').PostgresPublicListingStore)(db,{postmoderation:true}).read(d.id):await new(load('postgres-public-work').PostgresPublicWorkStore)(db,{vacancyPostmoderation:true}).read(kind,d.id);
   assert.ok(publicRow);assert.match(publicRow.title,/^ТЕСТ · /);
   assert.deepEqual(await worker.tick(),{state:'idle'});
  });
  await suite.test('old unmarked TEST success cannot enter discovery, claim or direct publication',async()=>{
   const d=await draft('listing'),s=new Store(db,checkout,{postmoderation:true}),q=await s.preview(d.token,d.owner,d.id,d.revision),order=await s.prepare(d.token,d.owner,{listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays});
   assert.equal(JSON.parse((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body).metadata.publicationMode,undefined);
   await assert.rejects(store('listing').authorizeDispatch(d.token,d.owner,order.id),{name:'ListingCheckoutUnavailableError'});
   assert.equal((await admin.query('select count(*)::int n from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rows[0].n,0);
   await assert.rejects(admin.query("update app.listings set title='Неопределённую оплату нельзя редактировать' where id=$1",[d.id]),{code:'PBL01'});
   await assert.rejects(admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[d.id,randomUUID()]),{code:'PBL01'});
   const b=await s.authorizeDispatch(d.token,d.owner,order.id),providerId=randomUUID(),intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);await intents.authorize(b);await intents.bindProvider(b,providerId);
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);
   await admin.query("update app.listings set title='Исторический тест можно редактировать' where id=$1",[d.id]);
   const photo=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,16,12,$3) returning id",[d.owner,randomUUID(),'a'.repeat(64)])).rows[0].id;
   await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[d.id,photo]);await admin.query('delete from app.listing_photos where listing_id=$1',[d.id]);
   assert.deepEqual(await worker.tick(),{state:'idle'});
   const fulfillment=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,merchant,{postmoderation:true,publicationTestOwner:current.owner});assert.deepEqual(await fulfillment.fulfill(order.id),{state:'blocked',reason:'publication_not_admitted'});
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,0);
  });
  assert.equal(posts,3);assert.equal(gets,3);
  await suite.test('LIVE unresolved success retains parent/photo fences and cannot enter the TEST worker',async()=>{
   const d=await draft('listing'),s=new Store(db,{...checkout,isTest:false},{postmoderation:true}),q=await s.preview(d.token,d.owner,d.id,d.revision),order=await s.prepare(d.token,d.owner,{listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays});
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);
   await assert.rejects(admin.query("update app.listings set title='Изменение' where id=$1",[d.id]),{code:'PBL01'});await assert.rejects(admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[d.id,randomUUID()]),{code:'PBL01'});
   assert.deepEqual(await worker.tick(),{state:'idle'});
  });
  await suite.test('profession lock permission cannot mutate data and extra publication rights remain forbidden',async()=>{
   await assert.rejects(workerDb.query('update app.specialist_categories set id=id where id=$1',[profession]),{code:'23514'});
   await assert.rejects(workerDb.query("update app.specialist_categories set name='Изменение' where id=$1",[profession]),{code:'42501'});
   await assert.rejects(workerDb.query('delete from app.work_publications'),{code:'42501'});await preflight();
  });
  await suite.test('restored pending TEST purchases publish once without sending a second charge request',async()=>{
   const pending=[];
   for(const kind of ['listing','vacancy','workRequest']){
    const item=await draft(kind),checkoutStore=store(kind);
    const quote=await checkoutStore.preview(item.token,item.owner,item.id,item.revision);
    const order=await checkoutStore.prepare(item.token,item.owner,{
     listingId:item.id,expectedRevision:item.revision,creationKey:randomUUID(),
     expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays,
    });
    const payment=load('account-test-listing-payment').createAccountTestListingPayment(db,checkoutStore,{...merchant,ownerId:current.owner},fetcher);
    await payment.dispatch(item.token,item.owner,order.id);
    const original=await checkoutStore.readOrder(item.token,item.owner,order.id);
    assert.ok(original);assert.equal(original.fulfillment,null);
    pending.push({kind,item,order,original});
   }

   const database='publication_restore';
   await admin.query('create database publication_restore template template0');
   await admin.query('revoke all on database publication_restore from public;grant connect on database publication_restore to blizhniy_payment_reconciler');
   await docker(['exec',container,'bash','-euo','pipefail','-c',
    'pg_dump --format=custom --username=postgres --no-password --dbname="$1" | pg_restore --single-transaction --exit-on-error --username=postgres --no-password --dbname="$2"',
    'restore-fixture',config.database,database]);
   const restored=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,max:2}));
   const restoredWorker=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database,user:rolePlan.role,password:workerPassword,max:2}));
   try{
    await copiedGuard.verifyPaymentReconciliationDatabase(restoredWorker,{database,publicationTest:true});
    const resumed=compiledWorker(restoredWorker,merchant,fetcher,current.owner),previousPosts=posts,previousGets=gets;
    for(let i=0;i<pending.length;i++)assert.deepEqual(await resumed.tick(),{state:'completed'});
    assert.deepEqual(await resumed.tick(),{state:'idle'});assert.equal(posts,previousPosts);assert.equal(gets-previousGets,pending.length);
    for(const {kind,item,order,original} of pending){
     const checkoutStore=new Store(restored,checkout,{postmoderation:true,publicationTestOwner:current.owner,...(kind==='listing'?{}:{targetType:kind})});
     const recovered=await checkoutStore.readOrder(item.token,item.owner,order.id);
     assert.equal(recovered.order.status,'succeeded');assert.ok(recovered.fulfillment);
     assert.equal((await restored.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,1);
     const card=kind==='listing'?await new(load('postgres-public-listings').PostgresPublicListingStore)(restored,{postmoderation:true}).read(item.id)
      :await new(load('postgres-public-work').PostgresPublicWorkStore)(restored,{vacancyPostmoderation:true}).read(kind,item.id);
     assert.ok(card);assert.match(card.title,/^ТЕСТ · /);
     assert.deepEqual(await store(kind).readOrder(item.token,item.owner,order.id),original);
    }
   }finally{await restoredWorker.close();await restored.close();}
  });
  if(layout==='specialist terms and inbox preferences')await suite.test('listing views deduplicate without new worker rights and the existing worker rejects the unapproved foreign key',async()=>{
   await preflight();
   await admin.query(await readFile(new URL('../database/candidates/0066-listing-views.sql',import.meta.url),'utf8'));
   await admin.query(await readFile(new URL('../database/permissions/listing-views.sql',import.meta.url),'utf8'));
   const {id}=await draft('listing');
   await admin.query("update app.listings set status='published',is_paid=true,published_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 day',view_count=12 where id=$1",[id]);
   const first=randomBytes(32),second=randomBytes(32);
   const record=async(digest,postmoderation=true)=>(await admin.query('select app_stats.record_listing_view($1,$2,$3) as views',[id,digest,postmoderation])).rows[0].views;
   assert.equal(await record(first,false),null);
   assert.deepEqual(await Promise.all([record(first),record(first)]),[13,13]);
   assert.equal(await record(second),14);
   await admin.query("update app.listings set status='archived' where id=$1",[id]);
   assert.equal(await record(randomBytes(32)),null);
   assert.equal((await admin.query('select count(*)::int as n from app_stats.listing_views where listing_id=$1',[id])).rows[0].n,2);
   const rights=(await admin.query(`select has_table_privilege('blizhniy_runtime','app_stats.listing_views','INSERT') as insert,
    has_column_privilege('blizhniy_runtime','app.listings','view_count','UPDATE') as update,
    has_function_privilege('blizhniy_payment_reconciler','app_stats.record_listing_view(uuid,bytea,boolean)','EXECUTE') as worker`)).rows[0];
   assert.deepEqual(rights,{insert:false,update:false,worker:false});
   await assert.rejects(preflight(), /Payment reconciliation database preflight failed/);
  });
  if(!inbox)await suite.test('a rolling inbox migration preserves three pending payments across worker restart',async()=>{
   const client=await admin.connect();
   try{
    const sql=inboxMigration.sql.trimEnd();
    assert.ok(sql.endsWith('commit;'));
    await client.query(sql.slice(0,-'commit;'.length));
    await client.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[inboxMigration.name,inboxMigration.sha256]);
    let committed=false;
    const concurrent={transaction:(work,options)=>workerDb.transaction(tx=>work({query:async(sql,values)=>{
     const result=await tx.query(sql,values);
     if(!committed&&sql.includes('from blizhniy_meta.migrations order by name')){
      await client.query('commit');committed=true;
     }
     return result;
    }}),options)};
    await copiedGuard.verifyPaymentReconciliationDatabase(concurrent,{database:config.database,publicationTest:true});
    assert.equal(committed,true);
   }catch(error){await client.query('rollback');throw error;}finally{client.release();}
   await check();
   const resumed=compiledWorker(workerDb,merchant,fetcher,current.owner);
   const receipts=async()=>(await db.query('select count(*)::int as n from app.payment_fulfillments')).rows[0].n;
   const initial=await receipts(),previousPosts=posts,previousGets=gets;
   for(let i=0;i<3;i++)assert.deepEqual(await resumed.tick(),{state:'completed'});
   assert.deepEqual(await resumed.tick(),{state:'idle'});
   assert.equal(await receipts(),initial+3);assert.equal(posts,previousPosts);assert.equal(gets,previousGets+3);
  });
 }finally{
  for(const key of variables){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}globalThis.fetch=originalFetch;
  await workerDb?.close();await db?.close();await admin?.end();if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force','--volumes',container]);}if(artifactDirectory)await rm(artifactDirectory,{recursive:true});
 }
});
