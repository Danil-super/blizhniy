// Disposable PG18 only: no .env, shared stand, scheduler or financial writes by runtime.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {promisify} from 'node:util';
import pg from 'pg';
import {getBootstrapPlan} from '../scripts/postgres-migration-plan.mjs';

const require=createRequire(import.meta.url);
const {loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const run=promisify(execFile);
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-expiry-test-'+randomBytes(8).toString('hex');
const label='blizhniy.publication-expiry-integration';
const password=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
 env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024,
})).stdout.trim();

test('publication expiry: real owner DTOs and public readers agree without changing persisted placement', {timeout:90000},async suite=>{
 const {PostgresDatabase}=load('postgres');
 const {hashSessionToken}=load('identity');
 const {PostgresWorkPublicationStore}=load('postgres-work-publications');
 const {PostgresWorkCabinetStore}=load('postgres-work-cabinet');
 const {PostgresServicePublicationStore}=load('postgres-service-publications');
 const {PostgresPublicWorkStore}=load('postgres-public-work');
 const {PostgresPublicServiceStore}=load('postgres-public-service');
 const workContract=load('work-publication-contract'),serviceContract=load('service-publication-contract');
 let containerId,owner,runtime;
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
   catch{if(Date.now()>deadline)throw Error('Isolated expiry PostgreSQL did not start');}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  owner=new pg.Pool({...config,max:3});
  assert.match((await owner.query("select current_setting('server_version') as version")).rows[0].version,/^18\.6/);
  for(const migration of getBootstrapPlan({includeListingContactMethod:true}))await owner.query(migration.sql);
  await owner.query("insert into app.regions(slug,name) values('expiry-region','Синтетический регион')");
  await owner.query("insert into app.cities(region_id,slug,name) select id,'expiry-city','Краснодар' from app.regions where slug='expiry-region'");
  await owner.query("insert into app.specialist_categories(slug,name,parent_name,active) values('expiry-profession','Сантехник','Синтетическая категория',true)");
  await owner.query(`create role expiry_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
   revoke all on database blizhniy_test from public;
   grant connect on database blizhniy_test to expiry_runtime;
   grant usage on schema app to expiry_runtime;
   grant select on app.users,app.sessions,app.cities,app.specialist_categories,app.media_objects,
    app.work_publications,app.work_publication_photos,app.work_moderation,app.applications,
    app.service_publications,app.service_publication_photos,app.service_moderation to expiry_runtime;
   grant update(auth_version) on app.users to expiry_runtime;
   grant update(last_seen_at) on app.sessions to expiry_runtime;
   grant insert(author_id,kind,creation_key,form,city_id,profession_id) on app.work_publications,app.service_publications to expiry_runtime;
   grant delete on app.work_publication_photos,app.service_publication_photos to expiry_runtime`);
  runtime=new PostgresDatabase(new pg.Pool({...config,user:'expiry_runtime',password:runtimePassword,max:3,
   statement_timeout:6000,lock_timeout:3000,idle_in_transaction_session_timeout:8000}));
  const work=new PostgresWorkPublicationStore(runtime),cabinet=new PostgresWorkCabinetStore(runtime);
  const service=new PostgresServicePublicationStore(runtime),publicWork=new PostgresPublicWorkStore(runtime),publicService=new PostgresPublicServiceStore(runtime);
  const principal=(await owner.query(`insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id`,
   [`expiry-${randomUUID()}@example.invalid`,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128)])).rows[0].id;
  const token=randomBytes(32).toString('hex');
  await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),principal]);
  const common={title:'Синтетическая публикация',description:'Синтетическое описание публикации для проверки срока размещения.',cityName:'Краснодар',
   contactPhone:'+79990000000',placementRightConfirmed:true};
  const forms={
   vacancy:{...common,professionName:'Сантехник',organization:'Иван Иванов',employerType:'person',salary:'45000'},
   workRequest:{...common,professionName:'Сантехник',budget:'1500'},
   specialist:{...common,professionName:'Сантехник',price:'1500',skills:'Синтетические навыки мастера'},
   fair:{...common,category:'Посуда',email:'expiry@example.invalid'},
   marquee:{title:'Синтетический рекламный текст',placementRightConfirmed:true},
  };
  const fixtures=[];
  for(const kind of ['vacancy','workRequest','specialist','fair','marquee']){
   const isWork=kind==='vacancy'||kind==='workRequest',store=isWork?work:service,pub=isWork?publicWork:publicService;
   const table=isWork?'work_publications':'service_publications',moderation=isWork?'work_moderation':'service_moderation';
   const form=(isWork?workContract.parseWorkPublicationForm:serviceContract.parseServicePublicationForm)(kind,forms[kind]);
   assert.deepEqual((isWork?workContract.checkWorkPublicationForm:serviceContract.checkServicePublicationForm)(form),[]);
   const key=randomUUID(),row=await store.create(token,principal,kind,key,form);
   await owner.query(`update app.${table} set status='published',is_paid=true,published_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()+interval '1 day' where id=$1`,[row.id]);
   await owner.query(`insert into app.${moderation}(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())`,[row.id]);
   fixtures.push({kind,isWork,store,pub,table,key,id:row.id});
  }
  const persisted=async fixture=>(await owner.query(`select status,is_paid,revision::text,form,created_at::text,updated_at::text,published_at::text,expires_at::text from app.${fixture.table} where id=$1`,[fixture.id])).rows[0];
  for(const fixture of fixtures){
   const {kind,isWork,store,pub,table,key,id}=fixture;
   await suite.test(`${kind}: future placement is published to owner and public readers`,async()=>{
    const before=await persisted(fixture);
    assert.equal((await store.read(token,principal,kind,id)).status,'published');
    assert.equal((await store.readIntent(token,principal,kind,key)).status,'published');
    assert.equal((await store.list(token,principal,kind,null)).items.find(row=>row.id===id)?.status,'published');
    if(isWork)assert.equal((await cabinet.list(token,principal,kind,null)).items.find(row=>row.id===id)?.status,'published');
    assert.equal((await pub.read(kind,id))?.id,id);
    assert.ok((await pub.list(kind)).some(row=>row.id===id));
    assert.deepEqual(await persisted(fixture),before);
   });
   await owner.query(`update app.${table} set expires_at=statement_timestamp()-interval '1 day' where id=$1`,[id]);
   await suite.test(`${kind}: expired placement disappears publicly while owner reads preserve storage`,async()=>{
    const before=await persisted(fixture);
    assert.equal(await pub.read(kind,id),undefined);
    assert.equal((await pub.list(kind)).some(row=>row.id===id),false);
    const snapshot=await store.read(token,principal,kind,id);
    assert.equal(snapshot.paid,true);assert.equal(snapshot.revision,'1');
    await store.readIntent(token,principal,kind,key);await store.list(token,principal,kind,null);
    if(isWork)await cabinet.list(token,principal,kind,null);
    assert.deepEqual(await persisted(fixture),before);
    assert.equal(before.status,'published');assert.equal(before.is_paid,true);
   });
   for(const [reader,read] of [
    ['snapshot',()=>store.read(token,principal,kind,id)],
    ['intent',()=>store.readIntent(token,principal,kind,key)],
    ['owner list',async()=>(await store.list(token,principal,kind,null)).items.find(row=>row.id===id)],
    ...(isWork?[['cabinet',async()=>(await cabinet.list(token,principal,kind,null)).items.find(row=>row.id===id)]]:[]),
   ])await suite.test(`${kind}: ${reader} reports expired after the deadline`,async()=>{
    assert.equal((await read()).status,'expired');
   });
   await owner.query(`update app.${table} set status='archived' where id=$1`,[id]);
   await suite.test(`${kind}: archived status wins over an elapsed deadline`,async()=>{
    const before=await persisted(fixture);
    assert.equal((await store.read(token,principal,kind,id)).status,'archived');
    assert.equal((await store.readIntent(token,principal,kind,key)).status,'archived');
    assert.equal((await store.list(token,principal,kind,null)).items.find(row=>row.id===id)?.status,'archived');
    if(isWork)assert.equal((await cabinet.list(token,principal,kind,null)).items.find(row=>row.id===id)?.status,'archived');
    assert.equal(await pub.read(kind,id),undefined);
    assert.deepEqual(await persisted(fixture),before);
   });
  }
  await suite.test('runtime cannot change publication status, payment or placement dates',async()=>{
   for(const {table,id} of fixtures)for(const assignment of ["status='published'",'is_paid=false','published_at=clock_timestamp()','expires_at=clock_timestamp()'])
    await assert.rejects(runtime.query(`update app.${table} set ${assignment} where id=$1`,[id]),{code:'42501'});
  });
  // Load only here so a missing new helper cannot hide the existing-store REDs above.
  await suite.test('SQL expiry uses the public statement-time boundary at minus, equal and plus one microsecond',async()=>{
   const {effectivePublicationStatusSql}=load('publication-effective-status');
   for(const alias of ['', 'w', 's']){
    const rows=(await runtime.query(`with samples(label,status,published_at,expires_at) as (
     values
      ('before','published',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 microsecond'),
      ('equal','published',statement_timestamp()-interval '2 days',statement_timestamp()),
      ('after','published',statement_timestamp()-interval '2 days',statement_timestamp()+interval '1 microsecond'),
      ('no-deadline','published',statement_timestamp()-interval '2 days',null::timestamptz),
      ('draft','draft',null::timestamptz,statement_timestamp()-interval '1 day'),
      ('pending_payment','pending_payment',null::timestamptz,statement_timestamp()-interval '1 day'),
      ('paid','paid',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day'),
      ('archived','archived',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day'),
      ('expired','expired',statement_timestamp()-interval '2 days',statement_timestamp()+interval '1 day'),
      ('rejected','rejected',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day')
     ) select label,${effectivePublicationStatusSql(alias)} as effective,
      coalesce(status='published' and published_at<=statement_timestamp() and expires_at>statement_timestamp(),false) as live
      from samples ${alias||'sample'} order by label`)).rows;
    assert.deepEqual(rows,[
     {label:'after',effective:'published',live:true},
     {label:'archived',effective:'archived',live:false},
     {label:'before',effective:'expired',live:false},
     {label:'draft',effective:'draft',live:false},
     {label:'equal',effective:'expired',live:false},
     {label:'expired',effective:'expired',live:false},
     {label:'no-deadline',effective:'published',live:false},
     {label:'paid',effective:'paid',live:false},
     {label:'pending_payment',effective:'pending_payment',live:false},
     {label:'rejected',effective:'rejected',live:false},
    ]);
   }
   assert.equal(effectivePublicationStatusSql(),effectivePublicationStatusSql(''));
   for(const alias of ['publication','w.status','w;select 1',null,{},1])assert.throws(()=>effectivePublicationStatusSql(alias));
  });
 }finally{
  await Promise.allSettled([runtime?.close(),owner?.end()]);
  if(containerId){
   const metadata=JSON.parse(await docker(['inspect',containerId]))[0];
   if(metadata.Id!==containerId||metadata.Name!==`/${name}`||metadata.Config.Labels[label]!==name)throw Error('Refusing to remove a foreign expiry container');
   await docker(['rm','--force',containerId]);
  }
 }
});
