import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import pg from 'pg';
import * as exporter from '../scripts/export-local-account-data.mjs';
import { localPrimaryImage } from '../scripts/local-primary-config.mjs';
import { assertListingViewsAccess, getBookingLifecycleMigration, getInboxPreferenceMigration, getListingViewsMigration, getPaidResponseMigrations, getPublicationTestMigrationPlan, getSpecialistAccountTestMigration } from '../scripts/publication-test-release-plan.mjs';
import { getSpecialistCheckoutMigration, specialistCheckoutRuntimeGrants } from '../scripts/specialist-checkout-release.mjs';
import { getPaymentReconciliationRolePlan, verifyPaymentReconciliationDatabase } from '../scripts/payment-reconciliation-role.mjs';
import { listingViewDigest } from '../src/lib/listing-view-history.ts';

const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile), role='blizhniy_account_export_reader', database='blizhniy_prod';
const digest=value=>createHash('sha256').update(value).digest('hex');

test('approved operator exports only the confirmed owner in a disposable production-shaped database',{timeout:45000},async t=>{
 const name='blizhniy-approved-export-'+randomBytes(6).toString('hex');
 const password=randomBytes(32).toString('hex'), label='blizhniy.approved-export-fixture';
 const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],
  {timeout:15000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
 const container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1',
  '--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB='+database,localPrimaryImage]);
 const meta=JSON.parse(await docker(['inspect',container]))[0],binding=meta.NetworkSettings.Ports['5432/tcp'][0];
 assert.equal(meta.Config.Labels[label],name);assert.equal(meta.Id,container);assert.equal(binding.HostIp,'127.0.0.1');
 let owner, reader, worker;
 t.after(async()=>{
  await reader?.close();await worker?.close();await owner?.end();
  assert.equal(JSON.parse(await docker(['inspect',container]))[0].Config.Labels[label],name);
  await docker(['rm','--force',container]);
 });
 for(const deadline=Date.now()+15000;;){
  try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-d',database]);break;}
  catch{assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,100));}
 }
 const config={host:'127.0.0.1',port:Number(binding.HostPort),database,user:'postgres',password,ssl:false,connectionTimeoutMillis:1500};

 const ownerPassword=randomBytes(32).toString('hex');
 const bootstrap=new pg.Client(config);
 await bootstrap.connect();
 try{
  await bootstrap.query('create role gen_user login createrole password '+pg.escapeLiteral(ownerPassword));
  await bootstrap.query('create role blizhniy_runtime nologin');
  await bootstrap.query('alter database '+database+' owner to gen_user');
  await bootstrap.query('revoke all on database '+database+' from public; revoke all on schema public from public');
 }finally{await bootstrap.end();}
 owner=new pg.Client({...config,user:'gen_user',password:ownerPassword});
 await owner.connect();
 await owner.query('create schema blizhniy_meta; create table blizhniy_meta.migrations(name text primary key,sha256 text not null); revoke all on schema blizhniy_meta from public');
 const journal=async ({name,sha256})=>owner.query('insert into blizhniy_meta.migrations values($1,$2)',[name,sha256]);
 for(const migration of getPublicationTestMigrationPlan()){
  await owner.query(migration.sql);await journal(migration);
 }
 const workerPlan=getPaymentReconciliationRolePlan(database,{cabinet:true,publicationTest:true});
 const workerPassword=randomBytes(32).toString('hex');
 await owner.query(workerPlan.createRole);
 for(const grant of workerPlan.grants)await owner.query(grant);
 await owner.query('alter role '+workerPlan.role+' login password '+pg.escapeLiteral(workerPassword));
 worker=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:workerPlan.role,password:workerPassword,max:1}));
 for(const file of ['telegram-phone','booking-lifecycle','listing-views']){
  if(file==='booking-lifecycle'){const migration=getBookingLifecycleMigration(); await owner.query(migration.sql);await journal(migration);}
  if(file==='listing-views'){const migration=getListingViewsMigration(); await owner.query(migration.sql);await journal(migration);}
  await owner.query(await readFile(new URL('../database/permissions/'+file+'.sql',import.meta.url),'utf8'));
 }
 const terms=getSpecialistCheckoutMigration();
 await owner.query(terms.source);await journal(terms);
 for(const grant of specialistCheckoutRuntimeGrants)await owner.query(grant);
 await owner.query('grant select(intent_id) on app.specialist_checkout_terms to '+workerPlan.role);
 for(const migration of [getInboxPreferenceMigration(),getSpecialistAccountTestMigration(),...getPaidResponseMigrations()]){
  await owner.query(migration.sql);await journal(migration);
 }
 const verifyWorker=()=>verifyPaymentReconciliationDatabase(worker,{database,publicationTest:true,specialistAccountTest:true});
 assert.equal(await verifyWorker(),true);

 const install=await readFile(new URL('../database/permissions/approved-account-export.sql',import.meta.url),'utf8');
 await owner.query('create role unrelated_export_fixture nologin');
 await owner.query('alter default privileges grant execute on functions to unrelated_export_fixture');
 await assert.rejects(owner.query(install),/Unexpected account export permissions/);
 await owner.query('rollback');
 assert.equal((await owner.query("select to_regnamespace('app_export') is null and to_regrole($1) is null as clean",[role])).rows[0].clean,true);
 await owner.query('alter default privileges revoke execute on functions from unrelated_export_fixture');
 await owner.query(install);
 assert.equal((await owner.query('select rolcanlogin from pg_roles where rolname=$1',[role])).rows[0].rolcanlogin,false);
 assert.equal(await verifyWorker(),true);
 await assertListingViewsAccess(owner);
 const web=(await owner.query("select has_schema_privilege('blizhniy_runtime','app_export','USAGE') as access")).rows[0];
 assert.equal(web.access,false);
 const readerPassword=randomBytes(32).toString('hex');
 await owner.query('alter role '+role+' login password '+pg.escapeLiteral(readerPassword));
 reader=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:role,password:readerPassword,max:1}));
 const hash=load('identity').hashSessionToken;
 async function person(accountRole='user'){
  const id=randomUUID(),email=id+'@synthetic.invalid',token=randomBytes(32).toString('hex');
  await owner.query('insert into app.users(id,email,role,password_hash,email_verified_at) values($1,$2,$3,$4,now())',
   [id,email,accountRole,'scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
  await owner.query('insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)',[hash(token),id]);
  return{id,email,token};
 }
 const administrator=await person('admin'),subject=await person(),other=await person();
 for(const [actor,phone] of [[subject,'+79995550101'],[other,'+79995550102']]){
  await owner.query("insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)",[actor.id,phone,actor.email]);
 }

 await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2),($3,$4)',
  [subject.id,{name:'Имя владельца',phone:'+79995550101',city:'Краснодар'},other.id,{name:'Чужое имя',phone:'+79995550102',city:'Краснодар'}]);
 for(const actor of [subject,other]){
  await owner.query(`insert into app.notifications(user_id,event_key,category,tone,title,body,dismissed_at)
   values($1,'export-fixture','system','info','Тестовое уведомление',$2,now())`,[actor.id,actor.email]);
  await owner.query('begin');
  try{
   await owner.query("select set_config('blizhniy.deletion_actor',$1,true)",[actor.id]);
   await owner.query('insert into app.account_deletion_requests(user_id) values($1)',[actor.id]);
   await owner.query('commit');
  }catch(error){await owner.query('rollback');throw error;}
 }
 const region=(await owner.query("insert into app.regions(slug,name) values('export-region','Тестовый регион') returning id")).rows[0].id;
 const city=(await owner.query("insert into app.cities(region_id,slug,name) values($1,'export-city','Тестовый город') returning id",[region])).rows[0].id;
 const category=(await owner.query("insert into app.categories(slug,name) values('export-category','Тестовая категория') returning id")).rows[0].id;
 const listing=(await owner.query(`insert into app.listings(author_id,category_id,city_id,listing_type,title,description,status,is_paid,published_at,expires_at)
  values($1,$2,$3,'sell','Синтетическое объявление','Синтетическое описание','published',true,now(),now()+interval '1 day') returning id`,
  [other.id,category,city])).rows[0].id;
 const listingViewRateSecret=randomBytes(32).toString('hex');
 for(const actor of [subject,other])await owner.query('select app_stats.record_listing_view($1,$2,true)',[listing,listingViewDigest(listingViewRateSecret,listing,'user:'+actor.id)]);

 const approval={caseId:'EXPORT_FIXTURE_0001',ownerId:subject.id,operatorId:administrator.id,emailSha256:digest(subject.email)};
 const read=(token=administrator.token,field=approval)=>exporter.readApprovedProductionAccountExport(reader,token,field,{listingViewRateSecret});
 const result=await read();
 assert.equal(result.caseId,approval.caseId);
 assert.equal(result.data.account.email,subject.email);
 assert.equal(result.data.profile.name,'Имя владельца');
 assert.equal(result.data.profile.phone,'+79995550101');
 assert.deepEqual(result.data.phoneBindings.map(row=>row.phone),['+79995550101']);
 assert.equal(JSON.stringify(result).includes('+79995550102'),false);
 assert.deepEqual(result.data.notifications.map(row=>row.body),[subject.email]);
 assert.ok(result.data.notifications[0].dismissed_at);
 assert.deepEqual(result.data.deletionEvents.map(row=>[row.request_id,row.status,row.actor_is_owner]),
  [[result.data.deletionRequests[0].id,'requested',true]]);
 assert.deepEqual(result.data.listingViews,[{listing_id:listing}]);
 assert.equal(JSON.stringify(result).includes(other.email),false);
 assert.equal(JSON.stringify(result).includes(hash(subject.token)),false);
 const root=await mkdtemp(join(tmpdir(),'blizhniy-approved-export-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const outputRoot=join(root,'output'),mediaRoot=join(root,'media');
 await mkdir(outputRoot,{mode:0o700});
 await mkdir(mediaRoot,{mode:0o700});
 const previousEnvironment=process.env.NODE_ENV;
 process.env.NODE_ENV='test';
 t.after(()=>{
  if(previousEnvironment===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=previousEnvironment;
 });
 const photo=Buffer.from('524946460400000057454250','hex');
 const image=(await owner.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
  values($1,$2,'image/webp',1,1,$3,$4) returning id`,[subject.id,randomUUID(),photo.length,digest(photo)])).rows[0].id;
 await owner.query("update app.media_objects set state='ready',ready_at=now() where id=$1",[image]);
 const disclosure={processingConfirmed:true,operatorName:'Синтетический оператор',operatorAddress:'Учебный адрес',
  purpose:'Стенд',basis:'Стенд',methods:'Чтение',sources:'Проверочная база',recipients:'Владелец',
  retention:'До конца теста',rights:'Поддержка',internationalTransfers:'Нет',processors:'Нет',safeguards:'Изоляция',otherInformation:'Нет'};
 const options={outputRoot,mediaRoot,listingViewRateSecret,disclosure};
 const prepare=()=>exporter.prepareApprovedProductionAccountExport(reader,administrator.token,approval,options);
 await assert.rejects(prepare());
 assert.deepEqual(await readdir(outputRoot),[]);
 await writeFile(join(mediaRoot,image+'.webp'),photo,{mode:0o600,flag:'wx'});
 const packageResult=await prepare();
 assert.equal(packageResult.verifiedFiles,1);
 assert.equal(packageResult.caseId,approval.caseId);
 assert.deepEqual((await readdir(packageResult.directory)).sort(),['account.json','media','processing.json','report.pdf']);
 assert.deepEqual(JSON.parse(await readFile(join(packageResult.directory,'processing.json'),'utf8')),disclosure);
 assert.equal((await readFile(join(packageResult.directory,'report.pdf'))).subarray(0,5).toString(),'%PDF-');
 const account=JSON.parse(await readFile(join(packageResult.directory,'account.json'),'utf8'));
 assert.equal(account.account.email,subject.email);
 assert.equal(account.profile.phone,'+79995550101');
 assert.deepEqual(account.media.map(item=>item.file),['media/'+image+'.webp']);
 assert.deepEqual(await readFile(join(packageResult.directory,account.media[0].file)),photo);

 await assert.rejects(read(other.token),{name:'DeletionAccessError'});
 await assert.rejects(read(administrator.token,{...approval,ownerId:other.id}),{name:'DeletionAccessError'});
 await assert.rejects(read(administrator.token,{...approval,emailSha256:digest(other.email)}),{name:'DeletionAccessError'});
 for(const protectedField of ['password_hash from app.users','token_hash from app.sessions','phone from app.telegram_phone_bindings']){
  await assert.rejects(reader.readTransaction(tx=>tx.query('select '+protectedField),{timeoutMs:5000}),{code:'42501'});
 }
 assert.deepEqual(await reader.readTransaction(async tx=>(await tx.query(
  'select phone from app_export.phone_bindings($1,$2,$3)',[hash(other.token),subject.id,administrator.id])).rows,{timeoutMs:5000}),[]);
 await assert.rejects(reader.readTransaction(tx=>tx.query('select viewer_digest from app_stats.listing_views'),{timeoutMs:5000}),{code:'42501'});
 await assert.rejects(reader.transaction(async tx=>{
  await tx.query('set transaction read write');
  await tx.query('update app.cabinet_profiles set profile=profile where user_id=$1',[subject.id]);
 }),{code:'42501'});
 await owner.query('grant unrelated_export_fixture to '+role);
 await assert.rejects(read(),{name:'AssertionError'});
 await owner.query('revoke unrelated_export_fixture from '+role);
 await owner.query('delete from app.sessions where token_hash=$1',[hash(administrator.token)]);
 await assert.rejects(read(),{name:'DeletionAccessError'});
});
