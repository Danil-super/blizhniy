// Real custom-format backup and restore, restricted to owned tmpfs synthetic containers.
import assert from'node:assert/strict';import{test}from'node:test';import{randomBytes,randomUUID,createHash}from'node:crypto';import{createRequire}from'node:module';import{execFile}from'node:child_process';import{promisify}from'node:util';import{readFile,mkdtemp,open}from'node:fs/promises';import{join}from'node:path';import pg from'pg';
import{lstat,mkdir,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';
import{localPrimaryImage}from'../scripts/local-primary-config.mjs';import{stateDirectory}from'../scripts/local-primary-fixture.mjs';import{getUserAccessRolePlan}from'../scripts/user-access-role.mjs';import{getAdminUserAccessMigration}from'../scripts/admin-user-access-release.mjs';import{getAdminTariffMigration}from'../scripts/admin-tariff-release.mjs';
import{eraseAccountWithRetiredMedia,eraseBasicAccount,readBasicErasureSchema}from'../scripts/basic-account-erasure.mjs';import{exportBasicErasureLedger,reapplyBasicErasureLedger,sealBasicErasureLedger,verifyBasicErasureLedger}from'../scripts/basic-erasure-ledger.mjs';
import{prepareBasicErasurePhotos}from'../scripts/basic-erasure-ledger.mjs';
import{restoreBasicErasure63Checks}from'../scripts/restore-basic-erasure63-checks.mjs';
import{loadMediaModule}from'./media-module.mjs';import{fileWorkerModule}from'./media-file-worker-module.mjs';
const run=promisify(execFile),load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,database='blizhniy_erasure_test',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('a signed erasure ledger removes resurrected basic identities after real backup/restore',{timeout:90000},async suite=>{
 const password=randomBytes(32).toString('hex'),key=randomBytes(32),sourceId=randomUUID(),containers=[],clients=[],databases=[],checks=[],directory=await mkdtemp(join(stateDirectory,'erasure-restore63-')),old=process.env.NODE_ENV;process.env.NODE_ENV='test';let report;
 const check=async(name,work)=>suite.test(name,async()=>{await work();checks.push(name);});
 const docker=async(args,options={})=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:16777216,env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},...options})).stdout;
 async function fixture(){
  const name='blizhniy-erasure-'+randomBytes(6).toString('hex'),id=(await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.erasure-test='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB='+database,localPrimaryImage,'postgres','-c','blizhniy.erasure_fixture='+name])).trim();containers.push({id,name});
  const meta=JSON.parse(await docker(['inspect',id]))[0];assert.equal(meta.Id,id);assert.equal(meta.Config.Labels['blizhniy.erasure-test'],name);assert.equal(meta.Config.Image,localPrimaryImage);const bind=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(bind.HostIp,'127.0.0.1');
  for(const end=Date.now()+20000;;){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{assert.ok(Date.now()<end);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(bind.HostPort),database,user:'postgres',password,ssl:false,connectionTimeoutMillis:2000},owner=new pg.Client(config);await owner.connect();clients.push(owner);const db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:3}));databases.push(db);return{id,owner,db,config};
 }
 async function durable(name,bytes){const f=await open(join(directory,name),'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
 const acls=async db=>(await db.query(`with objects as (
  select 'schema' kind,nspname name,coalesce(nspacl,acldefault('n',nspowner)) acl from pg_namespace where nspname in ('app','app_admin','local_primary','blizhniy_meta')
  union all select 'relation',n.nspname||'.'||c.relname,coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','app_admin','local_primary','blizhniy_meta')
  union all select 'column',n.nspname||'.'||c.relname||'.'||a.attname,coalesce(a.attacl,'{}'::aclitem[]) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attnum>0 and not a.attisdropped and n.nspname in ('app','app_admin','local_primary','blizhniy_meta')
  union all select 'function',p.oid::regprocedure::text,coalesce(p.proacl,acldefault('f',p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','app_admin','local_primary','blizhniy_meta')
 ) select o.kind,o.name,a.grantor::regrole::text grantor,case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end grantee,a.privilege_type,a.is_grantable from objects o cross join lateral aclexplode(case when cardinality(o.acl)>0 then o.acl else null::aclitem[] end) a order by 1,2,3,4,5,6`)).rows;
 async function dataDigest(db){const out=[];for(const table of ['app.users','app.sessions','app.cabinet_profiles','app.account_deletion_requests','app.account_deletion_events','app.registration_legal','app_admin.basic_account_erasures'])out.push({table,...(await db.query(`select count(*)::text as count,encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''),'UTF8')),'hex') as sha256 from ${table} t`)).rows[0]});return out;}
 try{
  const source=await fixture(),plan=getUserAccessRolePlan(database,{tariffs:true});await source.owner.query('create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public');
  for(const row of plan.appJournal){await source.owner.query(await readFile(new URL('../database/'+(/^(0058|0060)-/.test(row.name)?'candidates/':'migrations/')+row.name,import.meta.url),'utf8'));await source.owner.query('insert into blizhniy_meta.migrations values($1,$2)',[row.name,row.sha256]);}
  await source.owner.query('create role blizhniy_runtime nologin');for(const file of ['permissions/telegram-phone.sql','local-primary-payment.sql','local-primary-refunds.sql'])await source.owner.query(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
  for(const migration of [getAdminUserAccessMigration(),getAdminTariffMigration()])await source.owner.query(migration.source);for(const row of plan.journal)await source.owner.query('insert into app_admin.migrations values($1,$2)',[row.name,row.sha256]);
  const sql=await readFile(new URL('../database/candidates/0063-basic-account-erasure.sql',import.meta.url));await source.owner.query(sql.toString());await source.owner.query('insert into app_admin.migrations values($1,$2)',['0063-basic-account-erasure.sql',sha(sql)]);
  assert.deepEqual({migrationSha256:sha(sql),schema:await readBasicErasureSchema(source.owner)},JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema63.json',import.meta.url),'utf8')));
  const requests=new(load('postgres-account-deletion').PostgresAccountDeletionStore)(source.db),hash=load('identity').hashSessionToken;
  async function person(role='user'){
   const id=randomUUID(),token=randomBytes(32).toString('hex');await source.owner.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@synthetic.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
   await source.owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,{name:'Синтетическая проверка восстановления',city:'Краснодар'}]);await source.owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash(token),id]);return{id,token,request:(await requests.request(token,id)).request};
  }
  const admin=await person('admin'),peer=await person('admin'),targets=[await person(),await person()],untouched=await person(),command=(actor,operationId)=>({operationId,requestId:actor.request.id,expectedOwnerId:actor.id,expectedAuthVersion:'0',expectedRevision:'1'});
  const draft=(await source.owner.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Черновик до восстановления') returning id",[targets[0].id])).rows[0].id;
  const form=load('work-publication-contract').parseWorkPublicationForm('workRequest',{title:'Синтетический чужой заказ'});
  const work=(await source.owner.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",
   [untouched.id,randomUUID(),form])).rows[0].id;
  const outgoing=(await source.owner.query(`insert into app.applications
   (applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot)
   values($1,$2,$3,1,1,'{}') returning id`,[targets[0].id,work,randomUUID()])).rows[0].id;
  await source.db.transaction(async tx=>{
   await tx.query("select set_config('blizhniy.application_session',$1,true)",[hash(targets[0].token)]);
   await tx.query('insert into app.application_withdrawals(application_id,owner_id,withdrawn_revision) values($1,$2,1)',[outgoing,targets[0].id]);
  });
  const empty=await exportBasicErasureLedger(source.db,key,sourceId);assert.equal(verifyBasicErasureLedger(empty.document,key,empty.checkpoint).records.length,0);
  const beforeAcl=await acls(source.owner),beforeData=await dataDigest(source.owner);
  const bytes=await docker(['exec',source.id,'pg_dump','--username=postgres','--format=custom','--no-owner',database],{encoding:'buffer'});assert.ok(bytes.length>10000);const backupSha256=sha(bytes);await durable('before.dump',bytes);
  const beforeLastSeen=(await source.owner.query('select last_seen_at::text t from app.sessions where token_hash=$1',[hash(admin.token)])).rows[0].t;
  const operations=['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];
  for(let i=0;i<targets.length;i++){const actor=i===0?admin:peer;await eraseBasicAccount(source.db,actor.token,actor.id,command(targets[i],operations[i]),source.id);}
  const afterEraseSeen=(await source.owner.query('select last_seen_at::text t from app.sessions where token_hash=$1',[hash(admin.token)])).rows[0].t;assert.notEqual(afterEraseSeen,beforeLastSeen);
  const ledger=await exportBasicErasureLedger(source.db,key,sourceId);assert.equal(verifyBasicErasureLedger(ledger.document,key,ledger.checkpoint).records.length,2);assert.equal((await source.owner.query('select last_seen_at::text t from app.sessions where token_hash=$1',[hash(admin.token)])).rows[0].t,afterEraseSeen);
  await durable('ledger.json',ledger.document);await durable('checkpoint.json',JSON.stringify(ledger.checkpoint));await durable('synthetic-key.bin',key);
  const clone=await fixture();await clone.owner.query('create role blizhniy_runtime nologin');assert.equal(sha(await readFile(join(directory,'before.dump'))),backupSha256);
  await docker(['cp',join(directory,'before.dump'),clone.id+':/tmp/owned-before.dump']);await docker(['exec',clone.id,'pg_restore','--username=postgres','--dbname='+database,'--single-transaction','--exit-on-error','--no-owner','/tmp/owned-before.dump']);
  await check('exact restore repair rejects drift then preserves schema, all saved rows and ACLs',async()=>{
   const restored=JSON.parse(await readFile(new URL('../database/basic-erasure-restored-schema63.json',import.meta.url),'utf8'));assert.deepEqual(await readBasicErasureSchema(clone.owner),restored);
   const first=plan.appJournal[0];await clone.owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[first.name,'0'.repeat(64)]);await assert.rejects(restoreBasicErasure63Checks(clone.db));assert.deepEqual(await readBasicErasureSchema(clone.owner),restored);await clone.owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[first.name,first.sha256]);
   await clone.owner.query('create table local_primary.unreviewed_restore_test(user_id text)');try{await assert.rejects(restoreBasicErasure63Checks(clone.db));}finally{await clone.owner.query('drop table local_primary.unreviewed_restore_test');}
   let mutated=false;const wrongPayload={transaction:work=>clone.db.transaction(tx=>work({query:(sql,values)=>{
    if(sql.startsWith('-- Candidate internal payload')){const changed=sql.replace('char_length(email) between 3 and 254','char_length(email) between 2 and 254');assert.notEqual(changed,sql);sql=changed;mutated=true;}return tx.query(sql,values);
   }}))};
   await assert.rejects(restoreBasicErasure63Checks(wrongPayload));assert.equal(mutated,true);assert.deepEqual(await readBasicErasureSchema(clone.owner),restored);
   await restoreBasicErasure63Checks(clone.db);assert.deepEqual(await dataDigest(clone.owner),beforeData);
   assert.deepEqual(await acls(clone.owner),beforeAcl);
  });
  const sessions=new Map();await clone.owner.query('delete from app.sessions where user_id=any($1::uuid[])',[[admin.id,peer.id]]);
  for(const actor of [admin,peer]){const token=randomBytes(32).toString('hex');await clone.owner.query('insert into app.sessions(token_hash,user_id,auth_version) select $1,id,auth_version from app.users where id=$2',[hash(token),actor.id]);sessions.set(actor.id,token);}
  const present=async()=>(await clone.owner.query('select count(*)::int n from app.users where id=any($1::uuid[])',[targets.map(row=>row.id)])).rows[0].n;
  await check('old backup really resurrects both deleted identities and original sessions',async()=>{assert.equal(await present(),2);for(const target of targets)assert.ok(await new(load('identity').IdentityStore)(clone.db).resolveSession(target.token));});
  assert.equal((await clone.owner.query('select id from app.listings where id=$1',[draft])).rowCount,1);
  assert.equal((await clone.owner.query('select id from app.applications where id=$1',[outgoing])).rowCount,1);
  assert.equal((await clone.owner.query('select application_id from app.application_withdrawals where application_id=$1',[outgoing])).rowCount,1);
  await check('old signed checkpoint, changed signature and missing actor credential stop before mutation',async()=>{
   await assert.rejects(reapplyBasicErasureLedger(clone.db,empty.document,key,ledger.checkpoint,sessions,clone.id));
   const forged=JSON.parse(ledger.document);forged.signature='0'.repeat(64);const text=JSON.stringify(forged);await assert.rejects(reapplyBasicErasureLedger(clone.db,text,key,{...ledger.checkpoint,sha256:sha(text)},sessions,clone.id));
   await assert.rejects(reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,new Map(),clone.id));assert.equal(await present(),2);
   for(const invalid of ['0'.repeat(64),sessions.get(admin.id)]){const bad=new Map(sessions);bad.set(peer.id,invalid);await assert.rejects(reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,bad,clone.id));assert.equal(await present(),2);}
   await clone.owner.query('update app.users set is_blocked=true where id=$1',[peer.id]);await assert.rejects(reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,sessions,clone.id));await clone.owner.query('update app.users set is_blocked=false where id=$1',[peer.id]);assert.equal(await present(),2);
  });
  await clone.owner.query("update app.listings set status='pending_payment' where id=$1",[draft]);
  try{
   await assert.rejects(reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,sessions,clone.id),
    error=>error.name==='ErasureRestoreIncompleteError'&&error.confirmedOperations===0&&error.reopenAuthorized===false);
   assert.equal(await present(),2);
  }finally{await clone.owner.query("update app.listings set status='draft' where id=$1",[draft]);}
  await clone.owner.query("update app.applications set status='sent',is_paid=true,sent_at=clock_timestamp() where id=$1",[outgoing]);
  try{
   await assert.rejects(reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,sessions,clone.id),
    error=>error.name==='ErasureRestoreIncompleteError'&&error.confirmedOperations===0&&error.reopenAuthorized===false);
   assert.equal(await present(),2);
  }finally{await clone.owner.query("update app.applications set status='pending_payment',is_paid=false,sent_at=null where id=$1",[outgoing]);}
  await check('lost acknowledgement in a partially replayed batch keeps restoration closed',async()=>{
   let calls=0;const interrupted={readTransaction:clone.db.readTransaction.bind(clone.db),transaction:async work=>{const result=await clone.db.transaction(work);if(++calls===2)throw Error('Synthetic lost COMMIT response');return result;}};
   await assert.rejects(reapplyBasicErasureLedger(interrupted,ledger.document,key,ledger.checkpoint,sessions,clone.id),error=>error.name==='ErasureRestoreIncompleteError'&&error.confirmedOperations===1&&error.reopenAuthorized===false);assert.equal(await present(),0);
  });
  await check('explicit repeat recovers two receipts; no identities/sessions return and third user survives',async()=>{
   const result=await reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,sessions,clone.id);assert.equal(result.listedOperations,2);assert.equal(result.reopenAuthorized,false);assert.deepEqual(await reapplyBasicErasureLedger(clone.db,ledger.document,key,ledger.checkpoint,sessions,clone.id),result);
   assert.equal(await present(),0);for(const target of targets){assert.equal(await new(load('identity').IdentityStore)(clone.db).resolveSession(target.token),null);assert.equal((await clone.owner.query('select count(*)::int n from app.account_deletion_events where request_id=$1',[target.request.id])).rows[0].n,3);}
   assert.equal((await clone.owner.query('select id from app.listings where id=$1',[draft])).rowCount,0);
   assert.equal((await clone.owner.query('select id from app.applications where id=$1',[outgoing])).rowCount,0);
   assert.equal((await clone.owner.query('select application_id from app.application_withdrawals where application_id=$1',[outgoing])).rowCount,0);
   assert.equal((await clone.owner.query('select id from app.work_publications where id=$1 and author_id=$2',[work,untouched.id])).rowCount,1);
   assert.equal((await clone.owner.query('select count(*)::int n from app.users where id=$1',[untouched.id])).rows[0].n,1);assert.equal((await clone.owner.query('select count(*)::int n from app_admin.basic_account_erasures')).rows[0].n,2);
  });
  await check('an older backup missing an entire case remains incomplete rather than skipping evidence',async()=>{
   const late=await person();await eraseBasicAccount(source.db,admin.token,admin.id,command(late,'30000000-0000-4000-8000-000000000003'),source.id);const expanded=await exportBasicErasureLedger(source.db,key,sourceId);
   await assert.rejects(reapplyBasicErasureLedger(clone.db,expanded.document,key,expanded.checkpoint,sessions,clone.id),error=>error.name==='ErasureRestoreIncompleteError'&&error.confirmedOperations===2&&error.reopenAuthorized===false);
  });
  assert.equal(checks.length,6);report={passed:true,backupSha256,restoredActualBackup:true,exactRestoredData:true,exactRestoredAcl:true,freshActorSessions:true,identitiesResurrectedBeforeReplay:2,identitiesAfterReplay:await present(),receiptCount:2,duplicateCaseEvents:false,reopenAuthorized:false,productionTouched:false,permanentStandChanged:false};
   const {MediaMetadataRepository}=loadMediaModule('media-metadata');
   const {LocalMediaWriter}=loadMediaModule('media-write'),{LocalMediaRetirement}=loadMediaModule('media-retirement');
   async function storage(fixture,t){
    const root=join(tmpdir(),'blizhniy-erasure-media-'+fixture.id);
    await mkdir(root,{mode:0o700});
    const proof=await lstat(root,{bigint:true});
    t.after(async()=>{
     const current=await lstat(root,{bigint:true});
     assert.equal(current.ino,proof.ino);assert.equal(current.dev,proof.dev);assert.equal(current.uid,BigInt(process.getuid()));assert.ok(current.isDirectory());
     await rm(root,{recursive:true});
    });
    await writeFile(join(root,'.writer.lock'),'',{mode:0o600,flag:'wx'});
    const files=await loadMediaModule('media-files').createLocalMediaFileStore(root);
    const worker=await fileWorkerModule().createLocalMediaFileWorker(process.cwd(),root);
    return{root,repo:new MediaMetadataRepository(fixture.db,files,true),worker};
   }
  await suite.test('signed photo evidence gates replay against restored PostgreSQL and WebP copies',async t=>{
   const target=await person(),value=command(target,'40000000-0000-4000-8000-000000000004');
   const media=await storage(source,t),photoBytes=Buffer.from('524946460400000057454250','hex');
   const image={mimeType:'image/webp',width:1,height:1,size:photoBytes.length,sha256:sha(photoBytes)};
   const clock=(await source.owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) ddl")).rows[0].ddl;
   const atAge=days=>"create or replace function app.media_retention_clock() returns timestamptz language sql volatile set search_path=pg_catalog,pg_temp as $$select pg_catalog.clock_timestamp()+interval '"+days+" days'$$";
   let photo,draftId,workId,serviceId;
   try{
    await source.owner.query(atAge(-8));
    photo=(await media.repo.reserve(target.token,randomUUID(),image)).id;
    await new LocalMediaWriter(media.repo,media.worker).write(target.token,photo,{...image,bytes:photoBytes});
    draftId=(await source.owner.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[target.id])).rows[0].id;
    await source.owner.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[draftId,photo]);
    workId=(await source.owner.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",
     [target.id,randomUUID(),load('work-publication-contract').parseWorkPublicationForm('workRequest',{title:'Синтетический заказ'})])).rows[0].id;
    serviceId=(await source.owner.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'specialist',$2,$3) returning id",
     [target.id,randomUUID(),load('service-publication-contract').parseServicePublicationForm('specialist',{title:'Синтетическая анкета'})])).rows[0].id;
    await source.owner.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[workId,photo]);
    await source.owner.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[serviceId,photo]);
   }finally{await source.owner.query(clock);}
   const backup=()=>docker(['exec',source.id,'pg_dump','--username=postgres','--format=custom','--no-owner',database],{encoding:'buffer'});
   const attachedArchive=await backup();
   await durable('attached-photo-before-erasure.dump',attachedArchive);
   try{
    await source.owner.query(atAge(-8));
    await source.owner.query('delete from app.listing_photos where listing_id=$1 and media_id=$2',[draftId,photo]);
    await source.owner.query('delete from app.work_publication_photos where publication_id=$1 and media_id=$2',[workId,photo]);
    await source.owner.query('delete from app.service_publication_photos where publication_id=$1 and media_id=$2',[serviceId,photo]);
   }finally{await source.owner.query(clock);}
   const archivedPhoto=await readFile(join(media.root,photo+'.webp'));
   const archive=await backup();
   await durable('before-photo-erasure.dump',archive);await durable('before-photo-erasure.webp',archivedPhoto);
   const addonName='0068-erasure-retired-media.sql',addon=await readFile(new URL('../database/candidates/'+addonName,import.meta.url));
   async function addMediaSchema(fixture){
    await fixture.owner.query(addon.toString());
    await fixture.owner.query('insert into app_admin.migrations values($1,$2)',[addonName,sha(addon)]);
   }
   await addMediaSchema(source);
   await new LocalMediaRetirement(source.db,media.worker).retire(photo);
   await eraseAccountWithRetiredMedia(source.db,admin.token,admin.id,value,source.id);
   const captureLedger=()=>exportBasicErasureLedger(source.db,key,sourceId,2,source.id);
   const signed=await captureLedger();
   const attempt=(await source.owner.query('select id from app.media_write_attempts where media_id=$1',[photo])).rows[0].id;
   for(const name of [photo+'.webp','.pending-'+attempt]){
    const restoredFile=join(media.root,name);
    await writeFile(restoredFile,archivedPhoto,{mode:0o600,flag:'wx'});
    try{
     await assert.rejects(captureLedger(),{name:'BasicErasureReviewRequired'});
     assert.deepEqual(await readFile(restoredFile),archivedPhoto);
    }finally{await rm(restoredFile);}
   }
   assert.deepEqual(await captureLedger(),signed);
   const verified=verifyBasicErasureLedger(signed.document,key,signed.checkpoint);
   assert.deepEqual(verified.records.at(-1).mediaIds,[photo]);
   await durable('ledger-photo.json',signed.document);await durable('checkpoint-photo.json',JSON.stringify(signed.checkpoint));

   async function restore(file){
    const clone=await fixture();
    await clone.owner.query('create role blizhniy_runtime nologin');
    await docker(['cp',join(directory,file),clone.id+':/tmp/owned-before.dump']);
    await docker(['exec',clone.id,'pg_restore','--username=postgres','--dbname='+database,'--single-transaction','--exit-on-error','--no-owner','/tmp/owned-before.dump']);
    await restoreBasicErasure63Checks(clone.db);await addMediaSchema(clone);
    return clone;
   }
   const restored=await restore('before-photo-erasure.dump');
   await assert.rejects(exportBasicErasureLedger(restored.db,key,sourceId,2,source.id),{name:'AssertionError'});
   const restoredMedia=await storage(restored,t),restoredPath=join(restoredMedia.root,photo+'.webp');
   await writeFile(restoredPath,await readFile(join(directory,'before-photo-erasure.webp')),{mode:0o600,flag:'wx'});
   assert.deepEqual((await restoredMedia.repo.readOwned(target.token,photo)).bytes,archivedPhoto);
   const actors=new Map([[admin.id,admin.token],[peer.id,peer.token]]);
   const replay=(document=signed.document,checkpoint=signed.checkpoint)=>reapplyBasicErasureLedger(restored.db,document,key,checkpoint,actors,restored.id);
   const incomplete=error=>error.name==='ErasureRestoreIncompleteError'&&error.confirmedOperations===3&&error.reopenAuthorized===false;
   await assert.rejects(replay(),incomplete);
   assert.deepEqual(await readFile(restoredPath),archivedPhoto);
   await new LocalMediaRetirement(restored.db,restoredMedia.worker).retire(photo);
   const wrong=sealBasicErasureLedger(verified.records.map(row=>row.operationId===value.operationId?{...row,mediaIds:[]}:row),key,sourceId,2);
   await assert.rejects(replay(wrong,{sourceId,sha256:sha(wrong)}),incomplete);
   assert.equal((await restored.owner.query('select id from app.users where id=$1',[target.id])).rowCount,1);
   assert.equal((await restored.owner.query('select id from app.listings where id=$1',[draftId])).rowCount,1);
   const result=await replay();
   assert.equal(result.listedOperations,4);assert.equal(result.reopenAuthorized,false);
   assert.deepEqual(await replay(),result);
   assert.equal(await new(load('identity').IdentityStore)(restored.db).resolveSession(target.token),null);
   assert.equal((await restored.owner.query('select id from app.listings where id=$1',[draftId])).rowCount,0);
   await assert.rejects(readFile(restoredPath),{code:'ENOENT'});
   report.signedPhotoReplay={backupSha256:sha(archive),verifiedArchivedPhotos:1,confirmedOperations:4,rejectsDifferentPhotoSet:true};

   const attached=await restore('attached-photo-before-erasure.dump'),attachedStorage=await storage(attached,t);
   const attachedPath=join(attachedStorage.root,photo+'.webp');
   await writeFile(attachedPath,await readFile(join(directory,'before-photo-erasure.webp')),{mode:0o600,flag:'wx'});
   const prepare=(document=signed.document,checkpoint=signed.checkpoint)=>prepareBasicErasurePhotos(attached.db,document,key,checkpoint,actors,attached.id);
   const preparedReplay=()=>reapplyBasicErasureLedger(attached.db,signed.document,key,signed.checkpoint,actors,attached.id);
   const references=async()=>(await attached.owner.query(`select
    (select count(*)::int from app.listing_photos where media_id=$1)+
    (select count(*)::int from app.work_publication_photos where media_id=$1)+
    (select count(*)::int from app.service_publication_photos where media_id=$1) as n`,[photo])).rows[0].n;
   assert.equal(await references(),3);
   const unmatched=sealBasicErasureLedger(verified.records.map(row=>row.operationId===value.operationId?{...row,mediaIds:[randomUUID()]}:row),key,sourceId,2);
   await assert.rejects(prepare(unmatched,{sourceId,sha256:sha(unmatched)}),{name:'ErasureRestoreIncompleteError'});
   await attached.owner.query("update app.listings set status='pending_payment' where id=$1",[draftId]);
   await assert.rejects(prepare(),{name:'ErasureRestoreIncompleteError'});
   assert.equal(await references(),3);
   await attached.owner.query("update app.listings set status='draft' where id=$1",[draftId]);
   const peerDraft=(await attached.owner.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[untouched.id])).rows[0].id;
   await attached.owner.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[peerDraft,photo]);
   await assert.rejects(prepare(),{name:'ErasureRestoreIncompleteError'});
   assert.equal(await references(),4);
   await attached.owner.query('delete from app.listing_photos where listing_id=$1 and media_id=$2',[peerDraft,photo]);
   const withPaymentHistory={
    readTransaction:attached.db.readTransaction.bind(attached.db),
    transaction:work=>attached.db.transaction(async tx=>{
     await tx.query("insert into app.media_reference_events(media_id,source,resource_id,event_type) values($1,'payment_checkout_intents',$2,'history')",
      [photo,randomUUID()]);
     return work(tx);
    }),
   };
   await assert.rejects(prepareBasicErasurePhotos(withPaymentHistory,signed.document,key,signed.checkpoint,actors,attached.id),
    {name:'ErasureRestoreIncompleteError'});
   assert.equal(await references(),3);
   const prepared=await prepare();
   assert.deepEqual(prepared,{listedOperations:1,photos:[{operationId:value.operationId,detachedLinks:3}],reopenAuthorized:false});
   assert.equal(await references(),0);
   assert.deepEqual(await readFile(attachedPath),archivedPhoto);
   assert.equal((await attached.owner.query('select 1 from app.users where id=$1',[target.id])).rowCount,1);
   assert.equal((await attached.owner.query('select 1 from app_admin.basic_account_erasures where operation_id=$1',[value.operationId])).rowCount,0);
   assert.equal((await prepare()).photos[0].detachedLinks,0);
   await assert.rejects(preparedReplay(),incomplete);
   const cleanup=new LocalMediaRetirement(attached.db,attachedStorage.worker);
   await assert.rejects(cleanup.retire(photo),{code:'MEDIA_RETIREMENT_DENIED'});
   try{
    await attached.owner.query(atAge(8));
    await cleanup.retire(photo);
   }finally{await attached.owner.query(clock);}
   const resultFromAttached=await preparedReplay();
   assert.equal(resultFromAttached.listedOperations,4);assert.equal(resultFromAttached.reopenAuthorized,false);
   assert.deepEqual(await preparedReplay(),resultFromAttached);
   assert.equal(await new(load('identity').IdentityStore)(attached.db).resolveSession(target.token),null);
   assert.equal((await attached.owner.query('select 1 from app.listings where id=$1',[peerDraft])).rowCount,1);
   assert.equal((await attached.owner.query('select 1 from app.work_publications where id=$1 union all select 1 from app.service_publications where id=$2',[workId,serviceId])).rowCount,0);
   assert.deepEqual(await prepare(),{listedOperations:1,photos:[{operationId:value.operationId,detachedLinks:0}],reopenAuthorized:false});
   await assert.rejects(readFile(attachedPath),{code:'ENOENT'});
   report.signedPhotoReplay.attachedSnapshot={backupSha256:sha(attachedArchive),detachedLinks:3,rejectsPaymentHistory:true,retentionElapsedOnSyntheticClock:true};
  });
  await suite.test('restored notifications are quarantined before a worker can resend a pre-backup task',async()=>{
   const apply=async path=>{const bytes=await readFile(new URL('../database/'+path,import.meta.url));await source.owner.query(bytes.toString());return sha(bytes);};
   const names=['0064-inbox-notification-preferences.sql','0085-business-email.sql','0086-push-subscriptions.sql','0087-push-delivery.sql'];
   for(const name of names){
    const checksum=await apply('candidates/'+name);
    await source.owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,checksum]);
   }
   for(const role of ['blizhniy_business_email','blizhniy_push_worker']){
    await source.owner.query('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls');
   }
   for(const file of ['business-email','push-subscriptions','push-delivery-worker'])await apply('permissions/'+file+'.sql');

   const target=await person(),survivor=await person();
   const {createECDH}=await import('node:crypto');
   const syntheticKey=createECDH('prime256v1').generateKeys().toString('base64url'),pushAuth=randomBytes(16).toString('base64url');
   const endpoint=user=>'https://fcm.googleapis.com/fcm/send/synthetic-restore-'+user.id;
   const addSubscription=async(db,user)=>db.query('select app_push.set_subscription($1,$2,$3,$4,$5,null)',[hash(user.token),user.id,endpoint(user),syntheticKey,pushAuth]);
   const addEvent=async(db,user,key)=>(await db.query("insert into app.notifications(user_id,event_key,category,tone,title,body) values($1,$2,'booking','info','Синтетическое уведомление','Синтетический текст') returning id",[user.id,key])).rows[0].id;
   for(const user of [target,survivor]){
    await source.owner.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{pushNotifications}','true') where user_id=$1",[user.id]);
    await addSubscription(source.owner,user);
   }
   const delivered=await addEvent(source.owner,survivor,'fixture-terminal');
   const unresolved=await addEvent(source.owner,target,'fixture-pre-backup');
   const unfinished=await addEvent(source.owner,survivor,'fixture-sending');
   const claim=randomUUID(),otherClaim=randomUUID();
   const finishMail=(db,id,lease)=>db.query("select notification_delivery.finish_business_email($1,$2,'accepted')",[id,lease]);
   const finishPush=(db,id,lease)=>db.query("select app_push.finish_delivery($1,$2,'accepted',0)",[id,lease]);
   const {rows:[oldMail]}=await source.owner.query('select id from notification_delivery.claim_business_email($1)',[claim]);
   const {rows:[oldPush]}=await source.owner.query('select id from app_push.claim_delivery($1)',[claim]);
   assert.equal(oldMail.id,delivered);
   assert.equal((await source.owner.query('select notification_id from app_push.deliveries where id=$1',[oldPush.id])).rows[0].notification_id,delivered);
   await finishMail(source.owner,oldMail.id,claim);
   await finishPush(source.owner,oldPush.id,claim);
   for(const [table,column] of [['notification_delivery.business_email','notification_id'],['app_push.deliveries','notification_id']]){
    await source.owner.query("update "+table+" set state='sending',attempts=1,claim_id=$2,lease_until=clock_timestamp()+interval '1 minute' where "+column+"=$1",[unfinished,otherClaim]);
   }
   const recovery=randomBytes(32).toString('hex'),confirm=randomBytes(32).toString('hex');
   for(const [table,token] of [['password_recoveries',recovery],['email_confirmations',confirm]]){
    await source.owner.query("insert into app."+table+"(token_hash,user_id,email,auth_version,expires_at) values($1,$2,$3,0,clock_timestamp()+interval '15 minutes')",[hash(token),target.id,target.id+'@synthetic.invalid']);
   }
   await source.owner.query("insert into app.telegram_phone_attempts(user_id,session_hash,state_hash,client_id,nonce,verifier,return_path) values($1,$2,$3,'12345',$4,$5,'/cabinet')",
    [target.id,hash(target.token),randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),randomBytes(32).toString('base64url')]);
   const authJob=randomUUID();
   await source.owner.query("insert into app.mail_outbox(id,user_id,purpose,key_id,payload,created_at,expires_at,state,claim_id,lease_until) values($1,$2,'recover',$3,$4,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '15 minutes','reserved',$5,clock_timestamp()+interval '1 minute')",[authJob,target.id,'f'.repeat(32),Buffer.concat([Buffer.from([1]),randomBytes(40)]),claim]);
   const archive=await docker(['exec',source.id,'pg_dump','--username=postgres','--format=custom','--no-owner',database],{encoding:'buffer'});
   await durable('before-notification-quarantine.dump',archive);
   const {rows:[liveEmail]}=await source.owner.query('select id from notification_delivery.claim_business_email($1)',[claim]);
   const {rows:[livePush]}=await source.owner.query('select id from app_push.claim_delivery($1)',[claim]);
   assert.equal(liveEmail.id,unresolved);
   await finishMail(source.owner,liveEmail.id,claim);
   await finishPush(source.owner,livePush.id,claim);
   const restored=await fixture();
   await restored.owner.query('create role blizhniy_runtime nologin;create role blizhniy_business_email nologin;create role blizhniy_push_worker nologin');
   await docker(['cp',join(directory,'before-notification-quarantine.dump'),restored.id+':/tmp/owned-notifications.dump']);
   await docker(['exec',restored.id,'pg_restore','--username=postgres','--dbname='+database,'--single-transaction','--exit-on-error','--no-owner','/tmp/owned-notifications.dump']);
   const counts=async sql=>(await restored.owner.query(sql)).rows[0].n;
   assert.equal(await counts("select count(*)::int n from notification_delivery.business_email where state='ready'"),1);
   assert.equal(await counts("select count(*)::int n from app_push.deliveries where state='ready'"),1);
   assert.equal(await counts('select count(*)::int n from app.telegram_phone_attempts'),1);
   const mayDisplay=async()=>(await restored.owner.query('select app_push.may_display($1,$2) as allowed',[hash(survivor.token),oldPush.id])).rows[0].allowed;
   assert.equal(await mayDisplay(),true);
   const sessionsBefore=await counts('select count(*)::int n from app.sessions');
   assert.ok(sessionsBefore>=2);
   const {quarantineRestoredNotifications}=await import('../scripts/quarantine-restored-notifications.mjs');
   const quarantine=()=>quarantineRestoredNotifications(restored.db,restored.id);
   await assert.rejects(quarantineRestoredNotifications(restored.db,source.id),/preflight failed/i);
   await restored.owner.query('alter role blizhniy_push_worker login');
   try{await assert.rejects(quarantine(),/preflight failed/i);}
   finally{await restored.owner.query('alter role blizhniy_push_worker nologin');}
   const workerSecret=randomBytes(24).toString('hex');
   await restored.owner.query('alter role blizhniy_push_worker login password '+pg.escapeLiteral(workerSecret));
   const connected=new pg.Client({...restored.config,user:'blizhniy_push_worker',password:workerSecret});
   try{
    await connected.connect();
    await restored.owner.query('alter role blizhniy_push_worker nologin');
    await assert.rejects(quarantine(),/preflight failed/i);
   }finally{await connected.end();await restored.owner.query('alter role blizhniy_push_worker nologin password null');}
   const originalHash=(await restored.owner.query('select sha256 from blizhniy_meta.migrations where name=$1',[names[2]])).rows[0].sha256;
   await restored.owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[names[2],'0'.repeat(64)]);
   try{await assert.rejects(quarantine(),/preflight failed/i);}
   finally{await restored.owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[names[2],originalHash]);}
   await restored.owner.query('create table app_push.fixture_dependency(push_id uuid references app_push.subscriptions(id) on delete cascade)');
   try{await assert.rejects(quarantine(),/preflight failed/i);}
   finally{await restored.owner.query('drop table app_push.fixture_dependency');}
   assert.equal(await counts('select count(*)::int n from app.sessions'),sessionsBefore);
   const interrupted={transaction:work=>restored.db.transaction(tx=>work({query:async(sql,values)=>{
    const result=await tx.query(sql,values);
    if(sql.startsWith('update app_push.deliveries'))throw Error('Synthetic rollback test');
    return result;
   }}))};
   await assert.rejects(quarantineRestoredNotifications(interrupted,restored.id),/preflight failed/i);
   assert.equal(await counts('select count(*)::int n from app.sessions'),sessionsBefore);
   assert.equal(await counts("select count(*)::int n from notification_delivery.business_email where state='ready'"),1);

   const result=await quarantine();
   assert.deepEqual(result,{authMail:1,businessMail:2,push:2,confirmations:1,recoveries:1,sessions:sessionsBefore,reopenAuthorized:false});
   assert.deepEqual(await quarantine(),{authMail:0,businessMail:0,push:0,confirmations:0,recoveries:0,sessions:0,reopenAuthorized:false});
   assert.equal(await counts("select count(*)::int n from app.mail_outbox where state='unknown' and last_code='UNKNOWN'"),1);
   assert.equal(await counts("select count(*)::int n from notification_delivery.business_email where state='unknown'"),2);
   assert.equal(await counts("select count(*)::int n from app_push.deliveries where state='unknown'"),2);
   assert.equal(await counts("select count(*)::int n from notification_delivery.business_email where state='accepted'"),1);
   assert.equal(await counts("select count(*)::int n from app_push.deliveries where state='accepted'"),1);
   assert.equal(await counts('select count(*)::int n from app_push.subscriptions'),0);
   assert.equal(await counts('select count(*)::int n from app.telegram_phone_attempts'),0);
   assert.equal(await mayDisplay(),false);
   assert.equal(await counts('select count(*)::int n from app.email_confirmations'),0);
   assert.equal(await counts('select count(*)::int n from app.password_recoveries'),0);
   assert.equal(await counts('select count(*)::int n from app.notifications'),3);
   assert.equal(await new(load('identity').IdentityStore)(restored.db).resolveSession(target.token),null);
   await restored.db.transaction(async tx=>{
    await tx.query('set local role blizhniy_business_email');
    assert.equal((await tx.query('select * from notification_delivery.claim_business_email($1)',[randomUUID()])).rowCount,0);
    assert.equal((await tx.query("select notification_delivery.finish_business_email($1,$2,'accepted') as result",[unfinished,otherClaim])).rows[0].result,null);
   });
   await restored.db.transaction(async tx=>{
    await tx.query('set local role blizhniy_push_worker');
    assert.equal((await tx.query('select * from app_push.claim_delivery($1)',[randomUUID()])).rowCount,0);
   });
   const fresh={id:survivor.id,token:randomBytes(32).toString('hex')};
   await restored.owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash(fresh.token),fresh.id]);
   await addSubscription(restored.owner,fresh);
   const freshEvent=await addEvent(restored.owner,fresh,'fixture-after-quarantine');
   assert.equal((await restored.owner.query('select id from notification_delivery.claim_business_email($1)',[randomUUID()])).rows[0].id,freshEvent);
   assert.equal((await restored.owner.query("select count(*)::int as n from app_push.deliveries where notification_id=$1 and state='ready'",[freshEvent])).rows[0].n,1);
   report.notificationQuarantine={backupSha256:sha(archive),...result};
  });
  await suite.test('one closed restore replays signed account and WebP erasure before quarantining restored notifications',async t=>{
   const {quarantineRestoredNotifications}=await import('../scripts/quarantine-restored-notifications.mjs');
   const target=await person(),survivor=await person(),input=command(target,randomUUID());
   const media=await storage(source,t),bytes=Buffer.from('524946460400000057454250','hex');
   const image={mimeType:'image/webp',width:1,height:1,size:bytes.length,sha256:sha(bytes)};
   const clock=(await source.owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) ddl")).rows[0].ddl;
   const aged=days=>"create or replace function app.media_retention_clock() returns timestamptz language sql volatile set search_path=pg_catalog,pg_temp as $$select pg_catalog.clock_timestamp()+interval '"+days+" days'$$";
   let photo,draft;
   try{
    await source.owner.query(aged(-8));
    photo=(await media.repo.reserve(target.token,randomUUID(),image)).id;
    await new LocalMediaWriter(media.repo,media.worker).write(target.token,photo,{...image,bytes});
    draft=(await source.owner.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[target.id])).rows[0].id;
    await source.owner.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[draft,photo]);
   }finally{await source.owner.query(clock);}
   const sourcePath=join(media.root,photo+'.webp');
   await durable('joint-before.webp',await readFile(sourcePath));
   const {createECDH}=await import('node:crypto');
   const syntheticKey=createECDH('prime256v1').generateKeys().toString('base64url');
   const events=[];
   for(const user of [target,survivor]){
    await source.owner.query("update app.cabinet_profiles set profile=jsonb_set(profile,'{pushNotifications}','true') where user_id=$1",[user.id]);
    await source.owner.query('select app_push.set_subscription($1,$2,$3,$4,$5,null)',
     [hash(user.token),user.id,'https://fcm.googleapis.com/fcm/send/synthetic-joint-'+user.id,syntheticKey,randomBytes(16).toString('base64url')]);
    events.push((await source.owner.query("insert into app.notifications(user_id,event_key,category,tone,title,body) values($1,'fixture-joint','booking','info','Синтетический заголовок','Синтетический текст') returning id",[user.id])).rows[0].id);
    await source.owner.query("insert into app.password_recoveries(token_hash,user_id,email,auth_version,expires_at) values($1,$2,$3,0,clock_timestamp()+interval '15 minutes')",[hash(randomBytes(32).toString('hex')),user.id,user.id+'@synthetic.invalid']);
   }
   const [erasedEvent,survivingEvent]=events;
   const archive=await docker(['exec',source.id,'pg_dump','--username=postgres','--format=custom','--no-owner',database],{encoding:'buffer'});
   await durable('joint-before.dump',archive);
   await source.owner.query('alter role blizhniy_business_email nologin;alter role blizhniy_push_worker nologin');
   try{
    await source.owner.query(aged(-8));
    await source.owner.query('delete from app.listing_photos where listing_id=$1 and media_id=$2',[draft,photo]);
   }finally{await source.owner.query(clock);}
   await new LocalMediaRetirement(source.db,media.worker).retire(photo);
   const erase=()=>eraseAccountWithRetiredMedia(source.db,admin.token,admin.id,input,source.id,undefined,3);
   const sending=[erasedEvent,randomUUID()];
   await source.owner.query("update app_push.deliveries set state='sending',attempts=1,claim_id=$2,lease_until=clock_timestamp()+interval '1 minute' where notification_id=$1",sending);
   await assert.rejects(erase(),{name:'BasicErasureReviewRequired'});
   await source.owner.query("update app_push.deliveries set state='ready',attempts=0,claim_id=null,lease_until=null where notification_id=$1",[erasedEvent]);
   await source.owner.query("update notification_delivery.business_email set state='unknown',last_code='UNKNOWN' where notification_id=$1",[erasedEvent]);
   await assert.rejects(erase(),{name:'BasicErasureReviewRequired'});
   await source.owner.query("update notification_delivery.business_email set state='ready',last_code=null where notification_id=$1",[erasedEvent]);
   await erase();
   await assert.rejects(readFile(sourcePath),{code:'ENOENT'});
   const signed=await exportBasicErasureLedger(source.db,key,sourceId,3,source.id);
   const verified=verifyBasicErasureLedger(signed.document,key,signed.checkpoint);
   assert.equal(verified.version,3);
   assert.deepEqual(verified.records.find(row=>row.operationId===input.operationId).mediaIds,[photo]);
   await durable('joint-ledger.json',signed.document);
   await durable('joint-checkpoint.json',JSON.stringify(signed.checkpoint));

   const restored=await fixture(),restoredMedia=await storage(restored,t);
   await restored.owner.query('create role blizhniy_runtime nologin;create role blizhniy_business_email nologin;create role blizhniy_push_worker nologin');
   await docker(['cp',join(directory,'joint-before.dump'),restored.id+':/tmp/joint-before.dump']);
   await docker(['exec',restored.id,'pg_restore','--username=postgres','--dbname='+database,'--single-transaction','--exit-on-error','--no-owner','/tmp/joint-before.dump']);
   const restoreChecks=()=>restoreBasicErasure63Checks(restored.db,restored.id);
   await restored.owner.query('create table app_push.fixture_drift(id text)');
   try{await assert.rejects(restoreChecks(),/preflight failed/i);}
   finally{await restored.owner.query('drop table app_push.fixture_drift');}
   await restoreChecks();
   const restoredPath=join(restoredMedia.root,photo+'.webp');
   await writeFile(restoredPath,await readFile(join(directory,'joint-before.webp')),{mode:0o600,flag:'wx'});
   assert.deepEqual((await restoredMedia.repo.readOwned(target.token,photo)).bytes,bytes);
   const actors=new Map();
   for(const actor of [admin,peer]){
    const token=randomBytes(32).toString('hex');
    await restored.owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash(token),actor.id]);
    actors.set(actor.id,token);
   }
   const replay=(document=signed.document,checkpoint=signed.checkpoint)=>reapplyBasicErasureLedger(restored.db,document,key,checkpoint,actors,restored.id);
   const legacy=sealBasicErasureLedger(verified.records,key,sourceId,2);
   await assert.rejects(replay(legacy,{sourceId,sha256:sha(legacy)}),{name:'ErasureRestoreIncompleteError',confirmedOperations:0});
   await assert.rejects(replay(),{name:'ErasureRestoreIncompleteError'});
   assert.deepEqual(await readFile(restoredPath),bytes);
   const prepared=await prepareBasicErasurePhotos(restored.db,signed.document,key,signed.checkpoint,actors,restored.id);
   assert.deepEqual(prepared.photos.find(row=>row.operationId===input.operationId),{operationId:input.operationId,detachedLinks:1});
   assert.equal(prepared.reopenAuthorized,false);
   try{
    await restored.owner.query(aged(8));
    await new LocalMediaRetirement(restored.db,restoredMedia.worker).retire(photo);
   }finally{await restored.owner.query(clock);}
   const result=await replay();
   assert.equal(result.listedOperations,verified.records.length);
   assert.equal(result.reopenAuthorized,false);
   assert.deepEqual(await replay(),result);
   const subject=(await restored.owner.query(`select
    (select count(*)::int from app.users where id=$1) as users,
    (select count(*)::int from app.sessions where user_id=$1) as sessions,
    (select count(*)::int from app.password_recoveries where user_id=$1) as recoveries,
    (select count(*)::int from app.notifications where user_id=$1) as inbox,
    (select count(*)::int from notification_delivery.business_email where notification_id=$2) as email,
    (select count(*)::int from app_push.deliveries where notification_id=$2) as push,
    (select count(*)::int from app_push.subscriptions where session_hash=$3) as subscriptions`,
    [target.id,erasedEvent,hash(target.token)])).rows[0];
   assert.deepEqual(subject,{users:0,sessions:0,recoveries:0,inbox:0,email:0,push:0,subscriptions:0});
   assert.equal((await restored.owner.query('select 1 from app.listings where id=$1',[draft])).rowCount,0);
   await assert.rejects(readFile(restoredPath),{code:'ENOENT'});
   const retained=async()=>(await restored.owner.query(`select
    (select count(*)::int from app.users where id=$1) as users,
    (select count(*)::int from app.notifications where id=$2) as inbox,
    (select count(*)::int from app_admin.basic_account_erasures where operation_id=$3) as receipt,
    (select state from notification_delivery.business_email where notification_id=$2) as email,
    (select state from app_push.deliveries where notification_id=$2) as push`,
    [survivor.id,survivingEvent,input.operationId])).rows[0];
   assert.deepEqual(await retained(),{users:1,inbox:1,receipt:1,email:'ready',push:'ready'});
   const resultAfterQuarantine=await quarantineRestoredNotifications(restored.db,restored.id);
   assert.equal(resultAfterQuarantine.reopenAuthorized,false);
   assert.deepEqual(await retained(),{users:1,inbox:1,receipt:1,email:'unknown',push:'unknown'});
   assert.equal(await new(load('identity').IdentityStore)(restored.db).resolveSession(survivor.token),null);
   assert.equal((await restored.owner.query('select 1 from app.password_recoveries')).rowCount,0);
   assert.equal((await restored.owner.query('select * from notification_delivery.claim_business_email($1)',[randomUUID()])).rowCount,0);
   assert.equal((await restored.owner.query('select * from app_push.claim_delivery($1)',[randomUUID()])).rowCount,0);
   report.jointErasureRestore={backupSha256:sha(archive),ledgerVersion:verified.version,confirmedOperations:result.listedOperations,verifiedArchivedPhotos:1,...resultAfterQuarantine};
  });
  assert.ok(report.jointErasureRestore);
  assert.ok(report.signedPhotoReplay);
  assert.ok(report.notificationQuarantine);
  await durable('report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,backupRestore:true,report:join(directory,'report.json')}));
 }finally{
  await Promise.all(databases.map(db=>db.close()));await Promise.all(clients.map(client=>client.end()));for(const row of containers){const meta=JSON.parse(await docker(['inspect',row.id]))[0];assert.equal(meta.Config.Labels['blizhniy.erasure-test'],row.name);assert.equal(meta.Config.Image,localPrimaryImage);await docker(['rm','--force',row.id]);}
  if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;
 }
});
