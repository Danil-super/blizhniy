// Destructive candidate acceptance on one owned disposable synthetic database only.
import assert from 'node:assert/strict';import{test}from'node:test';
import{execFile}from'node:child_process';import{promisify}from'node:util';import{randomBytes,randomUUID}from'node:crypto';
import{lstat,mkdir,readFile,rm,unlink,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{tmpdir}from'node:os';import{join}from'node:path';import pg from'pg';
import{getUserAccessRolePlan}from'../scripts/user-access-role.mjs';import{getAdminUserAccessMigration}from'../scripts/admin-user-access-release.mjs';import{getAdminTariffMigration}from'../scripts/admin-tariff-release.mjs';
import{localPrimaryImage}from'../scripts/local-primary-config.mjs';import{eraseAccountWithRetiredMedia,eraseBasicAccount,readBasicErasureSchema}from'../scripts/basic-account-erasure.mjs';
import{readAccountExport}from'../scripts/export-local-account-data.mjs';
import{loadMediaModule}from'./media-module.mjs';import{fileWorkerModule}from'./media-file-worker-module.mjs';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,run=promisify(execFile);
test('basic erasure is atomic, replayable and refuses domain history on disposable PG18',{timeout:90000},async suite=>{
 const name='blizhniy-erasure-'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),label='blizhniy.erasure-test',database='blizhniy_erasure_test';let container,owner,db;
 const prior=process.env.NODE_ENV;process.env.NODE_ENV='test';
 const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB='+database,localPrimaryImage,'postgres','-c','blizhniy.erasure_fixture='+name]);
  const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels[label],name);assert.equal(meta.Config.Image,localPrimaryImage);const port=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');
  for(const end=Date.now()+20000;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{assert.ok(Date.now()<end);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(port.HostPort),database,user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};owner=new pg.Client(config);await owner.connect();
  await owner.query('create schema blizhniy_meta;create table blizhniy_meta.migrations(name text primary key,sha256 text not null);revoke all on schema blizhniy_meta from public');
  const plan=getUserAccessRolePlan(database,{tariffs:true});
  for(const row of plan.appJournal){await owner.query(await readFile(new URL('../database/'+(/^(0058|0060)-/.test(row.name)?'candidates/':'migrations/')+row.name,import.meta.url),'utf8'));await owner.query('insert into blizhniy_meta.migrations values($1,$2)',[row.name,row.sha256]);}
  await owner.query('create role blizhniy_runtime nologin');
  for(const file of ['permissions/telegram-phone.sql','local-primary-payment.sql','local-primary-refunds.sql'])await owner.query(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
  for(const migration of [getAdminUserAccessMigration(),getAdminTariffMigration()])await owner.query(migration.source);
  for(const row of plan.journal)await owner.query('insert into app_admin.migrations values($1,$2)',[row.name,row.sha256]);
  const migration=await readFile(new URL('../database/candidates/0063-basic-account-erasure.sql',import.meta.url),'utf8'),migrationSha256=createHash('sha256').update(migration).digest('hex');await owner.query(migration);
  await owner.query('insert into app_admin.migrations values($1,$2)',['0063-basic-account-erasure.sql',migrationSha256]);
  const candidate={migrationSha256,schema:await readBasicErasureSchema(owner)};
  assert.deepEqual(candidate,JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema63.json',import.meta.url),'utf8')));
  db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:4}));const requests=new(load('postgres-account-deletion').PostgresAccountDeletionStore)(db),hash=load('identity').hashSessionToken;
  async function session(id){const token=randomBytes(32).toString('hex');await owner.query('insert into app.sessions(token_hash,user_id,auth_version) select $1,id,auth_version from app.users where id=$2',[hash(token),id]);return token;}
  async function person(role='user'){
   const id=randomUUID(),email=id+'@synthetic.invalid';await owner.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,email,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
   await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,{name:'Синтетический пользователь',city:'Краснодар'}]);
   const token=await session(id),request=(await requests.request(token,id)).request;return{id,email,token,request};
  }
  const admin=await person('admin'),input=actor=>({requestId:actor.request.id,expectedRevision:actor.request.revision,expectedOwnerId:actor.id,expectedAuthVersion:'0',operationId:randomUUID()}),erase=(value,connection=db,token=admin.token,actor=admin.id)=>eraseBasicAccount(connection,token,actor,value,container);
  const exists=async actor=>(await owner.query('select count(*)::int n from app.users where id=$1',[actor.id])).rows[0].n;
  const events=async actor=>(await owner.query('select count(*)::int n from app.account_deletion_events where request_id=$1',[actor.request.id])).rows[0].n;
  const wrapping=hook=>({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{const result=await tx.query(sql,values);await hook(sql,result);return result;}}))});
  await suite.test('ordinary, mismatched, blocked and self principals cannot erase',async()=>{
   const ordinary=await person(),target=await person(),blocked=await person('admin'),value=input(target);
   await owner.query('update app.users set is_blocked=true where id=$1',[blocked.id]);await assert.rejects(erase(value,db,blocked.token,blocked.id));
   await assert.rejects(erase(value,db,ordinary.token,ordinary.id));await assert.rejects(erase(value,db,admin.token,ordinary.id));await assert.rejects(erase(input(admin)));assert.equal(await exists(target),1);assert.equal(await events(target),1);
  });
  await suite.test('exact request, owner, revision and auth version are required',async()=>{
   const target=await person(),other=await person(),value=input(target);
   for(const patch of [{expectedRevision:'2'},{expectedOwnerId:other.id},{expectedAuthVersion:'1'}])await assert.rejects(erase({...value,...patch}));
   assert.equal(await exists(target),1);assert.equal(await events(target),1);
  });
  await suite.test('basic identity, two sessions, recovery, consent and mail are removed; pseudonymous case stays',async()=>{
   const target=await person(),other=await person(),second=await session(target.id),value=input(target);
   await owner.query("insert into app.registration_legal(user_id,document,version) values($1,'agreement','2026-10-01')",[target.id]);
   for(const table of ['email_confirmations','password_recoveries'])await owner.query('insert into app.'+table+'(user_id,token_hash,email,auth_version) values($1,$2,$3,0)',[target.id,randomBytes(32).toString('hex'),target.email]);
   await owner.query("insert into app.mail_outbox(id,user_id,purpose,key_id,payload,created_at,expires_at) values($1,$2,'confirm',$3,$4,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '30 minutes')",[randomUUID(),target.id,'a'.repeat(32),Buffer.concat([Buffer.from([1]),Buffer.alloc(29)])]);
   const result=await erase(value);assert.equal(result.primaryAccountErased,true);assert.equal(result.completeErasure,false);assert.equal(result.requestRevision,'3');assert.equal(await exists(target),0);assert.equal(await exists(other),1);
   for(const table of ['sessions','cabinet_profiles','registration_legal','email_confirmations','password_recoveries','mail_outbox'])assert.equal((await owner.query('select count(*)::int n from app.'+table+' where user_id=$1',[target.id])).rows[0].n,0);
   for(const token of [target.token,second])assert.equal(await new(load('identity').IdentityStore)(db).resolveSession(token),null);
   assert.equal(await events(target),3);const row=(await owner.query('select user_id,resolution from app.account_deletion_requests where id=$1',[target.request.id])).rows[0];assert.deepEqual(row,{user_id:null,resolution:'partly_retained'});
   assert.deepEqual(await erase(value),result);assert.equal(await events(target),3);await assert.rejects(erase({...value,operationId:randomUUID()}));await assert.rejects(erase({...value,expectedAuthVersion:'1'}));
   await assert.rejects(erase({...input(other),operationId:value.operationId}),{name:'DeletionConflictError'});assert.equal(await exists(other),1);assert.equal(await events(other),1);
   assert.equal((await owner.query('select count(*)::int n from app_admin.basic_account_erasures where operation_id=$1',[value.operationId])).rows[0].n,1);
   await assert.rejects(owner.query('delete from app_admin.basic_account_erasures where operation_id=$1',[value.operationId]),error=>error.code==='42501');
   await assert.rejects(owner.query('insert into app.users(id,email,password_hash) values($1,$2,$3)',[target.id,target.email,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]),error=>error.code==='23514');
   const newId=randomUUID();await owner.query('insert into app.users(id,email,password_hash) values($1,$2,$3)',[newId,target.email,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await assert.rejects(owner.query('update app.users set id=$2 where id=$1',[newId,target.id]),error=>error.code==='23514');assert.equal(await exists(target),0);assert.deepEqual(await erase(value),result);
  });
  await suite.test('an already reviewed case uses its current revision; a closed manual case is never repurposed',async()=>{
   const target=await person();await requests.begin(admin.token,admin.id,target.request.id,'1');
   await assert.rejects(erase(input(target)));const value={...input(target),expectedRevision:'2'},result=await erase(value);assert.equal(result.requestRevision,'3');assert.deepEqual(await erase(value),result);
   const closed=await person();await requests.begin(admin.token,admin.id,closed.request.id,'1');await requests.resolve(admin.token,admin.id,closed.request.id,'2',{resolution:'declined',caseReference:'SYNTHETIC_DECLINED',confirmedManualDecision:true});
   await assert.rejects(erase({...input(closed),expectedRevision:'3'}));assert.equal(await exists(closed),1);assert.equal(await events(closed),3);
  });
  await suite.test('private drafts are exported and erased with their account and unrelated drafts survive',async()=>{
   const target=await person(),other=await person();
   const add=async actor=>{
    const listing=(await owner.query("insert into app.listings(author_id,listing_type,title,description) values($1,'sell','Синтетический черновик','Проверка удаления черновика.') returning id",[actor.id])).rows[0].id;
    const work=(await owner.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",[actor.id,randomUUID(),load('work-publication-contract').parseWorkPublicationForm('workRequest',{title:'Синтетический заказ'})])).rows[0].id;
    const service=(await owner.query("insert into app.service_publications(author_id,kind,creation_key,form) values($1,'specialist',$2,$3) returning id",[actor.id,randomUUID(),load('service-publication-contract').parseServicePublicationForm('specialist',{title:'Синтетическая анкета'})])).rows[0].id;
    return {listing,work,service};
   };
   const own=await add(target),foreign=await add(other),value=input(target);
   const exported=await readAccountExport(db,target.token,target.id);
   for(const [group,key] of [['listings','listing'],['work','work'],['services','service']])assert.deepEqual(exported[group].map(row=>row.id),[own[key]]);
   const result=await erase(value);
   assert.equal(await exists(target),0);assert.equal(await exists(other),1);
   await assert.rejects(readAccountExport(db,target.token,target.id),{name:'DeletionAccessError'});
   for(const [table,key] of [['listings','listing'],['work_publications','work'],['service_publications','service']]){
    assert.deepEqual((await owner.query('select id from app.'+table+' where id=any($1::uuid[])',[[own[key],foreign[key]]])).rows,[{id:foreign[key]}]);
   }
   assert.deepEqual(await erase(value),result);
  });
  await suite.test('administrator, non-draft publication, immutable payment identity and unknown mail require review',async()=>{
   await assert.rejects(erase(input(await person('admin'))),{name:'BasicErasureReviewRequired'});
   const publication=await person();await owner.query("insert into app.work_publications(author_id,kind,creation_key,form,status) values($1,'workRequest',$2,$3,'pending_payment')",[publication.id,randomUUID(),load('work-publication-contract').parseWorkPublicationForm('workRequest',{title:'Синтетический заказ',description:'Синтетическая проверка отказа удаления.'})]);
   await assert.rejects(erase(input(publication)),{name:'BasicErasureReviewRequired'});assert.equal(await exists(publication),1);
   const financial=await person(),id=randomUUID();
   const targetId=randomUUID(),body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/'},metadata:{localPaymentId:id,targetId,targetType:'listing',tariffId:'listing-publication'}});
   await db.transaction(tx=>new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(tx,{id,ownerId:financial.id,targetType:'listing',targetId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:'fixture-shop',isTest:true,requestBody:body}));
   await assert.rejects(erase(input(financial)),{name:'BasicErasureReviewRequired'});assert.equal((await owner.query('select request_body from app.payment_checkout_intents where id=$1',[id])).rows[0].request_body,body);assert.equal(await events(financial),1);
   const draft=await person();
   await owner.query("insert into app.listings(id,author_id,listing_type) values($1,$2,'sell')",[targetId,draft.id]);
   await assert.rejects(erase(input(draft)),{name:'BasicErasureReviewRequired'});
   assert.equal(await exists(draft),1);
   const withPhoto=await person();
   const photoDraft=(await owner.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[withPhoto.id])).rows[0].id;
   const media=(await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',2,2,12,$3) returning id",[withPhoto.id,randomUUID(),'c'.repeat(64)])).rows[0].id;
   await owner.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
   await owner.query("insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)",[photoDraft,media]);
   await assert.rejects(erase(input(withPhoto)),{name:'BasicErasureReviewRequired'});
   assert.equal(await exists(withPhoto),1);
   assert.equal((await owner.query('select 1 from app.listing_photos where listing_id=$1 and media_id=$2',[photoDraft,media])).rowCount,1);
   const mail=await person();await owner.query("insert into app.mail_outbox(id,user_id,purpose,key_id,payload,created_at,expires_at,state) values($1,$2,'confirm',$3,$4,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '30 minutes','unknown')",[randomUUID(),mail.id,'a'.repeat(32),Buffer.concat([Buffer.from([1]),Buffer.alloc(29)])]);
   await assert.rejects(erase(input(mail)),{name:'BasicErasureReviewRequired'});assert.equal(await exists(mail),1);
  });
  await suite.test('expired final admin session rolls back the actual DELETE and all new case events',async()=>{
   const actor=await person('admin'),target=await person();await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '1 second' where token_hash=$1",[hash(actor.token)]);let deleted=false;
   const connection=wrapping(async(sql,result)=>{if(sql.startsWith('delete from app.users')){assert.equal(result.rowCount,1);deleted=true;await new Promise(resolve=>setTimeout(resolve,1200));}});
   await assert.rejects(erase(input(target),connection,actor.token,actor.id));assert.equal(deleted,true);assert.equal(await exists(target),1);assert.equal(await events(target),1);assert.equal((await owner.query('select status from app.account_deletion_requests where id=$1',[target.request.id])).rows[0].status,'requested');
  });
  await suite.test('a lost COMMIT response recovers the same receipt instead of erasing another account',async()=>{
   const target=await person(),value=input(target);let saved;
   const lost={transaction:async work=>{saved=await db.transaction(work);throw Error('Synthetic lost acknowledgement');}};
   await assert.rejects(erase(value,lost));assert.equal(await exists(target),0);assert.deepEqual(await erase(value),saved);assert.equal(await events(target),3);
  });
  await suite.test('a user lock committed with new domain history is rechecked before deletion',async()=>{
   const target=await person(),value=input(target);let reached;const waiting=new Promise(resolve=>{reached=resolve;});
   const connection={transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{if(sql.startsWith('lock table'))reached();return tx.query(sql,values);}}))};
   await owner.query('begin');await owner.query('update app.users set auth_version=auth_version+1 where id=$1',[target.id]);await owner.query("insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,'+79991234567',$2)",[target.id,'test-'+target.id]);const attempt=erase(value,connection);const result=attempt.then(()=>({deleted:true}),error=>({error}));
   try{await Promise.race([waiting,result.then(()=>{throw Error('Erasure failed before table fence');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Table fence hook deadline')),3000);timer.unref();})]);await owner.query('commit');}catch(error){await owner.query('rollback');throw error;}
   assert.equal((await result).error?.name,'DeletionConflictError');assert.equal(await exists(target),1);
  });
  await suite.test('a new FK-bound session cannot appear after erasure wins the user lock',async()=>{
   const target=await person();let pending,started=false;
   const connection=wrapping(async sql=>{if(sql.startsWith('delete from app.users')){started=true;pending=owner.query("insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)",[randomBytes(32).toString('hex'),target.id]).then(()=>null,error=>error.code);}});
   await erase(input(target),connection);assert.equal(started,true);assert.equal(await pending,'23503');assert.equal(await exists(target),0);
  });
  await suite.test('a same-ID user INSERT already waiting on erasure cannot revive the account after commit',async()=>{
   const target=await person();let pending,started=false;
   const connection=wrapping(async sql=>{if(sql.startsWith('delete from app.users')){started=true;pending=owner.query('insert into app.users(id,email,password_hash) values($1,$2,$3)',[target.id,target.email,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]).then(()=>null,error=>error.code);}});
   const value=input(target),receipt=await erase(value,connection);assert.equal(started,true);assert.equal(await pending,'23514');assert.equal(await exists(target),0);assert.deepEqual(await erase(value),receipt);
  });
  await suite.test('a non-FK financial writer started after the empty scan is fenced by the receipt',async()=>{
   const target=await person(),id=randomUUID(),targetId=randomUUID(),body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/'},metadata:{localPaymentId:id,targetId,targetType:'listing',tariffId:'listing-publication'}});let pending;
   const connection=wrapping(async sql=>{if(sql.startsWith('select (exists')){
    let signal;const started=new Promise(resolve=>{signal=resolve;});
    pending=db.transaction(tx=>new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction({query:(statement,values)=>{if(statement.startsWith('insert into app.payment_checkout_intents'))signal();return tx.query(statement,values);}},
     {id,ownerId:target.id,targetType:'listing',targetId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:'fixture-shop',isTest:true,requestBody:body})).then(()=>null,error=>error.code);
    await started;
   }});
   await erase(input(target),connection);assert.equal(await pending,'23514');assert.equal((await owner.query('select count(*)::int n from app.payment_checkout_intents where id=$1',[id])).rows[0].n,0);assert.equal(await exists(target),0);
  });
  await suite.test('a repeatable-read writer with an old snapshot cannot bypass a newly committed receipt',async()=>{
   const target=await person(),id=randomUUID(),targetId=randomUUID(),body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/'},metadata:{localPaymentId:id,targetId,targetType:'listing',tariffId:'listing-publication'}});
   await owner.query('begin isolation level repeatable read');await owner.query('select id from app.users where id=$1',[target.id]);
   try{
    await erase(input(target));
    await assert.rejects(owner.query("insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body) values($1,$2,'listing',$3,1,'listing-publication',199,30,'fixture-shop',true,$4)",[id,target.id,targetId,body]),error=>error.code==='23514');
   }finally{await owner.query('rollback');}
   assert.equal(await exists(target),0);assert.equal((await owner.query('select count(*)::int n from app.payment_checkout_intents where id=$1',[id])).rows[0].n,0);
  });
  await suite.test('incorrect journal and unknown schema are refused without changing the account',async()=>{
   const target=await person(),row=plan.appJournal[0];await owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[row.name,'0'.repeat(64)]);
   try{await assert.rejects(erase(input(target)));}finally{await owner.query('update blizhniy_meta.migrations set sha256=$2 where name=$1',[row.name,row.sha256]);}
   await owner.query('create table app.unreviewed_erasure_test(id uuid)');try{await assert.rejects(erase(input(target)));}finally{await owner.query('drop table app.unreviewed_erasure_test');}
   await owner.query('create table local_primary.unreviewed_erasure_test(user_id text)');await owner.query('insert into local_primary.unreviewed_erasure_test values($1)',[target.id]);
   try{await assert.rejects(erase(input(target)));}finally{await owner.query('drop table local_primary.unreviewed_erasure_test');}
   assert.equal(await exists(target),1);assert.equal(await events(target),1);
  });
  await suite.test('a different database is rejected before any application/session query',async()=>{
   const wrong=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,database:'postgres',max:1}));
   try{await assert.rejects(erase(input(await person()),wrong),{name:'AssertionError'});}finally{await wrong.close();}
  });
  await suite.test('a matching database without the owned fixture identity is rejected',async()=>{
   const target=await person(),connection={transaction:work=>db.transaction(async tx=>{await tx.query("select set_config('blizhniy.erasure_fixture','foreign-fixture',true)");return work(tx);})};
   await assert.rejects(erase(input(target),connection),{name:'AssertionError'});assert.equal(await exists(target),1);assert.equal(await events(target),1);
   await assert.rejects(eraseBasicAccount(db,admin.token,admin.id,input(target),'0'.repeat(64)));assert.equal(await exists(target),1);
   const nonSynthetic=await person();await owner.query("update app.users set email='contact@example.invalid' where id=$1",[nonSynthetic.id]);
   await assert.rejects(erase({...input(nonSynthetic),expectedAuthVersion:'1'}),{name:'BasicErasureReviewRequired'});assert.equal(await exists(nonSynthetic),1);
  });
  await suite.test('the erasure executor checks restored files before closing the case for a retired draft photo',async t=>{
   const eraseWithMedia=value=>eraseAccountWithRetiredMedia(db,admin.token,admin.id,value,container);
   await assert.rejects(eraseWithMedia(input(await person())),{name:'AssertionError'});
   const migration68=await readFile(new URL('../database/candidates/0068-erasure-retired-media.sql',import.meta.url));
   const migrationSha256=createHash('sha256').update(migration68).digest('hex');
   await owner.query(migration68.toString('utf8'));
   await owner.query('insert into app_admin.migrations values($1,$2)',['0068-erasure-retired-media.sql',migrationSha256]);
   const candidate={migrationSha256,schema:await readBasicErasureSchema(owner)};
   assert.deepEqual(candidate,JSON.parse(await readFile(new URL('../database/basic-account-erasure-schema68.json',import.meta.url),'utf8')));

   const root=join(tmpdir(),'blizhniy-erasure-media-'+container),bytes=Buffer.from('524946460400000057454250','hex');
   await mkdir(root,{mode:0o700});
   const owned=await lstat(root,{bigint:true});
   t.after(async()=>{
    const current=await lstat(root,{bigint:true});
    assert.equal(current.ino,owned.ino);assert.equal(current.dev,owned.dev);assert.equal(current.uid,BigInt(process.getuid()));
    assert.ok(current.isDirectory());
    await rm(root,{recursive:true});
   });
   await writeFile(join(root,'.writer.lock'),'',{mode:0o600,flag:'wx'});
   const target=await person(),value=input(target);
   const badJournal=wrapping((sql,result)=>{
    if(sql==='select name,sha256 from app_admin.migrations order by name')result.rows.at(-1).sha256='0'.repeat(64);
   });
   await assert.rejects(eraseAccountWithRetiredMedia(badJournal,admin.token,admin.id,value,container),{name:'AssertionError'});
   const files=await loadMediaModule('media-files').createLocalMediaFileStore(root);
   const worker=await fileWorkerModule().createLocalMediaFileWorker(process.cwd(),root);
   const repo=new(loadMediaModule('media-metadata').MediaMetadataRepository)(db,files,true);
   const writer=new(loadMediaModule('media-write').LocalMediaWriter)(repo,worker);
   const clock=(await owner.query("select pg_get_functiondef('app.media_retention_clock()'::regprocedure) ddl")).rows[0].ddl;
   const image={mimeType:'image/webp',width:1,height:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   let photo,draft;
   try{
    await owner.query("create or replace function app.media_retention_clock() returns timestamptz language sql volatile set search_path=pg_catalog,pg_temp as $$select pg_catalog.clock_timestamp()-interval '8 days'$$");
    photo=(await repo.reserve(target.token,randomUUID(),image)).id;
    await writer.write(target.token,photo,{...image,bytes});
    draft=(await owner.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning id",[target.id])).rows[0].id;
    await owner.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[draft,photo]);
    await owner.query('delete from app.listing_photos where listing_id=$1 and media_id=$2',[draft,photo]);
   }finally{await owner.query(clock);}
   await assert.rejects(erase(value),{name:'AssertionError'});
   await assert.rejects(eraseWithMedia(value),{name:'BasicErasureReviewRequired'});
   const retirement=new(loadMediaModule('media-retirement').LocalMediaRetirement)(db,worker);
   await retirement.retire(photo);
   const final=join(root,photo+'.webp');
   await writeFile(final,bytes,{mode:0o600,flag:'wx'});
   await assert.rejects(eraseWithMedia(value),{name:'BasicErasureReviewRequired'});
   assert.deepEqual(await readFile(final),bytes);assert.equal(await exists(target),1);assert.equal(await events(target),1);
   await unlink(final);
   const {rows:[{id:attemptId}]}=await owner.query('select id from app.media_write_attempts where media_id=$1',[photo]);
   const temporary=join(root,'.pending-'+attemptId);
   await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});
   await assert.rejects(eraseWithMedia(value),{name:'BasicErasureReviewRequired'});
   assert.deepEqual(await readFile(temporary),bytes);assert.equal(await exists(target),1);
   await unlink(temporary);
   const completed=await eraseWithMedia(value);
   assert.deepEqual((await owner.query('select media_id from app_admin.account_erasure_media where operation_id=$1',[value.operationId])).rows,[{media_id:photo}]);
   await assert.rejects(owner.query('update app_admin.account_erasure_media set media_id=media_id'),{code:'42501'});
   await assert.rejects(owner.query('delete from app_admin.account_erasure_media'),{code:'42501'});
   await assert.rejects(owner.query('truncate app_admin.account_erasure_media'),{code:'42501'});
   assert.equal(await exists(target),0);
   assert.equal((await owner.query('select owner_id from app.media_objects where id=$1',[photo])).rows[0].owner_id,null);
   assert.equal((await owner.query('select id from app.listings where id=$1',[draft])).rowCount,0);
   assert.deepEqual(await eraseWithMedia(value),completed);
   for(const restored of [final,temporary]){
    await writeFile(restored,bytes,{mode:0o600,flag:'wx'});
    await assert.rejects(eraseWithMedia(value),{name:'BasicErasureReviewRequired'});
    assert.deepEqual(await readFile(restored),bytes);
    await unlink(restored);
   }
   assert.deepEqual(await eraseWithMedia(value),completed);
  });
 }finally{
  await db?.close();await owner?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Config.Labels[label],name);await docker(['rm','--force',container]);}
  if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;
 }
});
