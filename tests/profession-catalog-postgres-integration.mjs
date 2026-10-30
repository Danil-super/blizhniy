// Disposable PG18 with synthetic records only. No .env, shared stand, or production writes.
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
const name='blizhniy-profession-test-'+randomBytes(8).toString('hex');
const label='blizhniy.profession-catalog-integration';
const password=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
 env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024,
})).stdout.trim();

test('profession references: actual SQL stores preserve IDs across rename, deactivation, and duplicate labels',{timeout:90000},async suite=>{
 const {PostgresDatabase}=load('postgres');
 const {hashSessionToken}=load('identity');
 const {PostgresWorkPublicationStore}=load('postgres-work-publications');
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
   catch{if(Date.now()>deadline)throw Error('Isolated profession PostgreSQL did not start');}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  owner=new pg.Pool({...config,max:3});
  assert.match((await owner.query("select current_setting('server_version') as version")).rows[0].version,/^18\.6/);
  for(const migration of getBootstrapPlan({includeListingContactMethod:true}))await owner.query(migration.sql);
  await owner.query("insert into app.regions(slug,name) values('profession-region','Синтетический регион')");
  await owner.query("insert into app.cities(region_id,slug,name) select id,'profession-city','Краснодар' from app.regions where slug='profession-region'");
  const oldName='Синтетический сантехник',currentName='Синтетический мастер';
  const professionId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
   values('profession-original',$1,'Синтетическая категория',true) returning id`,[oldName])).rows[0].id;
  await owner.query(`create role profession_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
   revoke all on database blizhniy_test from public;
   grant connect on database blizhniy_test to profession_runtime;
   grant usage on schema app to profession_runtime;
   grant select on app.users,app.sessions,app.cities,app.specialist_categories,app.media_objects,
    app.work_publications,app.work_publication_photos,app.work_moderation,app.applications,
    app.service_publications,app.service_publication_photos,app.service_moderation,app.cabinet_profiles to profession_runtime;
   grant update(auth_version) on app.users to profession_runtime;
   grant update(last_seen_at) on app.sessions to profession_runtime;
   grant insert(author_id,kind,creation_key,form,city_id,profession_id) on app.work_publications,app.service_publications to profession_runtime;
   grant update(form,city_id,profession_id,revision,updated_at) on app.work_publications,app.service_publications to profession_runtime;
   grant insert,delete on app.work_publication_photos,app.service_publication_photos to profession_runtime;
   grant insert(applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,message) on app.applications to profession_runtime;
   grant update(message,snapshot,specialist_publication_id,target_revision,specialist_revision,revision,updated_at) on app.applications to profession_runtime`);
  runtime=new PostgresDatabase(new pg.Pool({...config,user:'profession_runtime',password:runtimePassword,max:3,
   statement_timeout:6000,lock_timeout:3000,idle_in_transaction_session_timeout:8000}));
  const work=new PostgresWorkPublicationStore(runtime),service=new PostgresServicePublicationStore(runtime);
  const publicWork=new PostgresPublicWorkStore(runtime),publicService=new PostgresPublicServiceStore(runtime);
  const identity=async()=>{
   const id=(await owner.query(`insert into app.users(email,password_hash,email_verified_at) values($1,$2,clock_timestamp()) returning id`,
    [`profession-${randomUUID()}@example.invalid`,'scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128)])).rows[0].id;
   const token=randomBytes(32).toString('hex');
   await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
   return{id,token};
  };
  const principal=await identity();
  const common={title:'Синтетическая публикация',description:'Синтетическое описание публикации для проверки профессии.',cityName:'Краснодар',
   contactPhone:'+79990000000',placementRightConfirmed:true,professionName:oldName};
  const forms={
   vacancy:{...common,organization:'Иван Иванов',employerType:'person',salary:'45000'},
   workRequest:{...common,budget:'1500'},
   specialist:{...common,price:'1500',skills:'Синтетические навыки мастера'},
  };
  const parse=(kind,input)=>(kind==='specialist'?serviceContract.parseServicePublicationForm:workContract.parseWorkPublicationForm)(kind,input);
  const storeFor=kind=>kind==='specialist'?service:work;
  const create=async(kind,input,actor=principal)=>storeFor(kind).create(actor.token,actor.id,kind,randomUUID(),input);
  const fixtures=[];
  const publish=async fixture=>{
   await owner.query(`update app.${fixture.table} set status='published',is_paid=true,published_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()+interval '1 day' where id=$1`,[fixture.id]);
   await owner.query(`insert into app.${fixture.moderation}(publication_id,revision,state,submitted_at,decided_at)
    select id,revision,'approved',statement_timestamp(),clock_timestamp() from app.${fixture.table} where id=$1 on conflict do nothing`,[fixture.id]);
  };
  for(const kind of ['vacancy','workRequest','specialist']){
   const form=parse(kind,forms[kind]),check=kind==='specialist'?serviceContract.checkServicePublicationForm:workContract.checkWorkPublicationForm;
   assert.deepEqual(check(form),[]);
   const row=await create(kind,form),isWork=kind!=='specialist';
   const fixture={kind,store:storeFor(kind),pub:isWork?publicWork:publicService,table:isWork?'work_publications':'service_publications',
    moderation:isWork?'work_moderation':'service_moderation',id:row.id,legacy:form};
   await publish(fixture);assert.equal((await fixture.pub.read(kind,row.id))?.id,row.id);
   fixtures.push(fixture);
  }
  const persisted=async fixture=>(await owner.query(`select author_id,kind,profession_id,city_id,status,is_paid,revision::text,form,
   created_at::text,updated_at::text,published_at::text,expires_at::text from app.${fixture.table} where id=$1`,[fixture.id])).rows[0];
  const beforeRename=await Promise.all(fixtures.map(persisted));
  await owner.query('update app.specialist_categories set name=$2 where id=$1',[professionId,currentName]);
  for(const fixture of fixtures){
   const {kind,store,pub,id}=fixture;
   await suite.test(`${kind}: rename retains public eligibility with current DB name`,async()=>{
    const material=await pub.read(kind,id);assert.ok(material,'a renamed FK must not hide an eligible publication');
    assert.equal(material.profession,currentName);
    assert.equal((await pub.list(kind)).find(item=>item.id===id)?.profession,currentName);
   });
   await suite.test(`${kind}: primary public DTO carries the stable profession UUID`,async()=>{
    assert.equal((await pub.read(kind,id))?.professionId,professionId);
   });
   await suite.test(`${kind}: owner editor reads canonical name and stable UUID after rename`,async()=>{
    const snapshot=await store.read(principal.token,principal.id,kind,id);
    assert.equal(snapshot.form.professionName,currentName);assert.equal(snapshot.professionId,professionId);
   });
   await suite.test(`${kind}: reading renamed references never rewrites form, dates, payment or revision`,async()=>{
    await store.read(principal.token,principal.id,kind,id);await pub.read(kind,id);await pub.list(kind);
    assert.deepEqual(await persisted(fixture),beforeRename[fixtures.indexOf(fixture)]);
   });
   await suite.test(`${kind}: legacy stale-label edit retains the stored UUID after rename`,async()=>{
    const before=await persisted(fixture);
    const updated=await store.update(principal.token,principal.id,kind,id,before.revision,{...fixture.legacy,title:'Синтетическое изменение после переименования'});
    assert.equal(updated.form.professionName,currentName);assert.equal(updated.professionId,professionId);
    const after=await persisted(fixture);assert.equal(after.profession_id,professionId);
    assert.equal(after.revision,String(BigInt(before.revision)+1n));assert.equal(after.is_paid,before.is_paid);
    assert.equal(after.published_at,before.published_at);assert.equal(after.expires_at,before.expires_at);
   });
  }
  for(const fixture of fixtures)await owner.query(`insert into app.${fixture.moderation}(publication_id,revision,state,submitted_at,decided_at)
   select id,revision,'approved',statement_timestamp(),clock_timestamp() from app.${fixture.table} where id=$1 on conflict do nothing`,[fixture.id]);
  await owner.query('update app.specialist_categories set active=false where id=$1',[professionId]);
  const otherInactiveId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
   values('profession-other-inactive','Другой неактивный мастер','Синтетическая категория',false) returning id`)).rows[0].id;
  for(const fixture of fixtures){
   const {kind,store,pub,id,table}=fixture;
   await suite.test(`${kind}: inactive profession hides public records but keeps private editor readable`,async()=>{
    assert.equal(await pub.read(kind,id),undefined);assert.equal((await pub.list(kind)).some(item=>item.id===id),false);
    const snapshot=await store.read(principal.token,principal.id,kind,id);
    assert.equal(snapshot.professionId,professionId);assert.equal(snapshot.form.professionName,currentName);
   });
   await owner.query(`update app.${table} set status='draft',is_paid=false,published_at=null,expires_at=null where id=$1`,[id]);
   await suite.test(`${kind}: existing inactive profession can be retained during a draft edit`,async()=>{
    const snapshot=await store.read(principal.token,principal.id,kind,id);
    const updated=await store.update(principal.token,principal.id,kind,id,snapshot.revision,{...snapshot.form,professionId,title:'Синтетический сохранённый черновик'});
    assert.equal(updated.professionId,professionId);assert.equal(updated.form.professionName,currentName);
    assert.equal((await persisted(fixture)).profession_id,professionId);assert.equal(updated.status,'draft');
   });
   await suite.test(`${kind}: retaining an inactive reference never permits switching to a different inactive UUID`,async()=>{
    const snapshot=await store.read(principal.token,principal.id,kind,id),before=await persisted(fixture);
    await assert.rejects(store.update(principal.token,principal.id,kind,id,snapshot.revision,
     {...snapshot.form,professionId:otherInactiveId,professionName:'Другой неактивный мастер'}));
    assert.deepEqual(await persisted(fixture),before);
   });
   await suite.test(`${kind}: new records cannot select an inactive name or UUID`,async()=>{
    const actor=await identity();
    await assert.rejects(create(kind,{...forms[kind],professionName:currentName},actor));
    await assert.rejects(create(kind,{...forms[kind],professionId,professionName:currentName},actor));
   });
  }
  await suite.test('runtime cannot mutate reference catalog, publication owner or paid placement',async()=>{
   await assert.rejects(runtime.query('update app.specialist_categories set active=true where id=$1',[professionId]),{code:'42501'});
   await assert.rejects(runtime.query("insert into app.specialist_categories(slug,name,parent_name) values('runtime-forgery','Подделка','Категория')"),{code:'42501'});
   for(const fixture of fixtures)for(const assignment of ["status='published'",'is_paid=true','published_at=clock_timestamp()','expires_at=clock_timestamp()','author_id=gen_random_uuid()'])
    await assert.rejects(runtime.query(`update app.${fixture.table} set ${assignment} where id=$1`,[fixture.id]),{code:'42501'});
  });
  await owner.query('update app.specialist_categories set active=true where id=$1',[professionId]);
  const duplicateName='Синтетический монтажник';
  const duplicateRows=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
   values('profession-duplicate-a',$1,'Синтетическая первая категория',true),('profession-duplicate-b',$1,'Синтетическая вторая категория',true)
   returning id,slug,name,parent_name`,[duplicateName])).rows;
  for(const kind of ['vacancy','workRequest','specialist']){
   await suite.test(`${kind}: UUID binds duplicate names independently and DB name wins over submitted label`,async()=>{
    const seen=[];
    for(const profession of duplicateRows){
     const actor=await identity(),row=await create(kind,{...forms[kind],professionId:profession.id,professionName:'Неавторитетная подпись клиента'},actor);
     assert.equal(row.professionId,profession.id);assert.equal(row.form.professionName,duplicateName);
     const table=kind==='specialist'?'service_publications':'work_publications';
     const stored=(await owner.query(`select profession_id,form from app.${table} where id=$1`,[row.id])).rows[0];
     assert.equal(stored.profession_id,profession.id);assert.equal(stored.form.professionName,duplicateName);seen.push(stored.profession_id);
    }
    assert.notEqual(seen[0],seen[1]);
   });
   await suite.test(`${kind}: ambiguous legacy label and absent or malformed UUID reject atomically`,async()=>{
    const actor=await identity(),store=storeFor(kind);
    for(const input of [{...forms[kind],professionName:duplicateName},{...forms[kind],professionId:randomUUID()},
     {...forms[kind],professionId:'not-a-uuid'},{...forms[kind],professionId:professionId,authorId:principal.id}]){
     await assert.rejects(create(kind,input,actor));
    }
    assert.deepEqual((await store.list(actor.token,actor.id,kind,null)).items,[]);
   });
   await suite.test(`${kind}: valid profession UUID never authorizes another owner's record`,async()=>{
    const attacker=await identity(),victim=fixtures.find(item=>item.kind===kind),before=await persisted(victim);
    await assert.rejects(storeFor(kind).read(attacker.token,principal.id,kind,victim.id));
    await assert.rejects(storeFor(kind).update(attacker.token,principal.id,kind,victim.id,before.revision,
     {...forms[kind],professionId:duplicateRows[0].id}));
    assert.deepEqual(await persisted(victim),before);
   });
  }
  for(const kind of ['vacancy','workRequest','specialist']){
   await suite.test(`${kind}: a legacy creation retry after rename returns the original publication unchanged`,async()=>{
    const actor=await identity(),key=randomUUID(),store=storeFor(kind),originalName=`Синтетическая прежняя профессия ${kind}`;
    const catalogId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
     values($1,$2,'Синтетическая категория',true) returning id`,[`retry-${kind.toLowerCase()}`,originalName])).rows[0].id;
    const input={...forms[kind],professionName:originalName},first=await store.create(actor.token,actor.id,kind,key,input);
    const fixture={id:first.id,table:kind==='specialist'?'service_publications':'work_publications'},before=await persisted(fixture);
    const renamed=`Синтетическая новая профессия ${kind}`;
    await owner.query('update app.specialist_categories set name=$2 where id=$1',[catalogId,renamed]);
    const retried=await store.create(actor.token,actor.id,kind,key,input);
    assert.equal(retried.id,first.id);assert.equal(retried.professionId,catalogId);assert.equal(retried.form.professionName,renamed);
    assert.deepEqual(await persisted(fixture),before);
    assert.equal((await store.list(actor.token,actor.id,kind,null)).items.length,1);
   });
   await suite.test(`${kind}: reusing an old label for another profession cannot redirect a legacy owner edit`,async()=>{
    const actor=await identity(),store=storeFor(kind),originalName=`Синтетическая повторная подпись ${kind}`;
    const catalogId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
     values($1,$2,'Синтетическая категория',true) returning id`,[`reuse-original-${kind.toLowerCase()}`,originalName])).rows[0].id;
    const legacy={...forms[kind],professionName:originalName},first=await create(kind,legacy,actor),renamed=`Синтетическая переименованная подпись ${kind}`;
    await owner.query('update app.specialist_categories set name=$2 where id=$1',[catalogId,renamed]);
    const replacementId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
     values($1,$2,'Другая синтетическая категория',true) returning id`,[`reuse-replacement-${kind.toLowerCase()}`,originalName])).rows[0].id;
    const updated=await store.update(actor.token,actor.id,kind,first.id,first.revision,{...legacy,title:'Синтетическое изменение другого поля'});
    assert.equal(updated.professionId,catalogId);assert.notEqual(updated.professionId,replacementId);assert.equal(updated.form.professionName,renamed);
    const stored=await persisted({id:first.id,table:kind==='specialist'?'service_publications':'work_publications'});
    assert.equal(stored.profession_id,catalogId);assert.equal(stored.form.professionName,renamed);
   });
   await suite.test(`${kind}: a 200-character catalog name survives canonical create, private read and public read`,async()=>{
    const actor=await identity(),store=storeFor(kind),longName='Д'.repeat(200);
    const catalogId=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
     values($1,$2,'Синтетическая категория',true) returning id`,[`long-profession-${kind.toLowerCase()}`,longName])).rows[0].id;
    const created=await create(kind,{...forms[kind],professionId:catalogId,professionName:'Короткая подпись клиента'},actor);
    assert.equal(created.professionId,catalogId);assert.equal(created.form.professionName,longName);
    const read=await store.read(actor.token,actor.id,kind,created.id);assert.equal(read.professionId,catalogId);assert.equal(read.form.professionName,longName);
    const fixture={id:created.id,table:kind==='specialist'?'service_publications':'work_publications',moderation:kind==='specialist'?'service_moderation':'work_moderation'};
    await publish(fixture);
    const publicStore=kind==='specialist'?publicService:publicWork,material=await publicStore.read(kind,created.id);
    assert.ok(material);assert.equal(material.professionId,catalogId);assert.equal(material.profession,longName);
    assert.equal((await persisted(fixture)).form.professionName,longName);
   });
  }
  await suite.test('profession pages filter and paginate by UUID while duplicate labels stay separate and inactive categories disappear',async()=>{
   const profileIds=[[],[]];
   for(let group=0;group<duplicateRows.length;group++)for(let index=0;index<(group===0?3:2);index++){
    const actor=await identity(),profession=duplicateRows[group],created=await create('specialist',
     {...forms.specialist,professionId:profession.id,professionName:duplicateName,title:`Синтетический специалист ${group} ${index}`},actor);
    await publish({id:created.id,table:'service_publications',moderation:'service_moderation'});
    await owner.query("update app.service_publications set published_at=statement_timestamp()-interval '10 minutes'+($2::integer*interval '1 second') where id=$1",[created.id,index]);
    profileIds[group].unshift(created.id);
   }
   const first=await publicService.professionPage(duplicateRows[0].id,2,0),second=await publicService.professionPage(duplicateRows[0].id,2,2);
   assert.deepEqual(first.items.map(row=>row.id),profileIds[0].slice(0,2));assert.equal(first.hasMore,true);
   assert.deepEqual(second.items.map(row=>row.id),profileIds[0].slice(2));assert.equal(second.hasMore,false);
   assert.deepEqual(await publicService.professionPage(duplicateRows[0].id,2,3),{items:[],hasMore:false});
   assert.ok([...first.items,...second.items].every(row=>row.professionId===duplicateRows[0].id&&row.profession===duplicateName));
   const other=await publicService.professionPage(duplicateRows[1].id,2,0);
   assert.deepEqual(other.items.map(row=>row.id),profileIds[1]);assert.equal(other.hasMore,false);
   await owner.query('update app.specialist_categories set active=false where id=$1',[duplicateRows[0].id]);
   assert.deepEqual(await publicService.professionPage(duplicateRows[0].id,2,0),{items:[],hasMore:false});
   assert.deepEqual((await publicService.professionPage(duplicateRows[1].id,2,0)).items.map(row=>row.id),profileIds[1]);
   await owner.query('update app.specialist_categories set active=true where id=$1',[duplicateRows[0].id]);
   for(const args of [['not-a-uuid',2,0],[duplicateRows[0].id,0,0],[duplicateRows[0].id,101,0],
    [duplicateRows[0].id,1,-1],[duplicateRows[0].id,1,1000001],[duplicateRows[0].id,1.5,0]])
    await assert.rejects(publicService.professionPage(...args));
   assert.deepEqual(await publicService.professionPage(randomUUID(),2,0),{items:[],hasMore:false});
  });
  for(const ready of [false,true])await suite.test(`application ${ready?'ready-profile':'published-profile'}: renamed current previews and creates preserve immutable sent snapshots`,async()=>{
   const {PostgresApplicationStore}=load('postgres-applications');
   const applications=new PostgresApplicationStore(runtime,{specialistApplicationReady:ready});
   const applicant=await identity(),recipient=await identity(),labelBefore=`Синтетическая профессия отклика ${ready?'анкета':'каталог'}`;
   await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[applicant.id,JSON.stringify({name:'Иван Иванов'})]);
   const category=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
    values($1,$2,'Синтетическая категория',true) returning id`,[`application-profession-${ready?'ready':'published'}`,labelBefore])).rows[0].id;
   const specialist=await create('specialist',{...forms.specialist,professionName:labelBefore},applicant);
   const specialistFixture={id:specialist.id,table:'service_publications',moderation:'service_moderation'};
   await publish(specialistFixture);
   const targets=[];
   for(let index=0;index<2;index++){
    const target=await create('workRequest',{...forms.workRequest,professionName:labelBefore},recipient);
    await publish({id:target.id,table:'work_publications',moderation:'work_moderation'});targets.push(target);
   }
   const input=async target=>{
    const preview=await applications.preview(applicant.token,applicant.id,'workRequest',target.id);
    return{kind:'workRequest',targetId:target.id,creationKey:randomUUID(),message:'Синтетический отклик',expectedTargetRevision:preview.target.revision,
     specialistId:preview.specialist.id,expectedSpecialistRevision:preview.specialist.revision};
   };
   const sent=await applications.create(applicant.token,applicant.id,await input(targets[0]));
   assert.equal(sent.snapshot.profession,labelBefore);
   await owner.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[sent.id]);
   const persistedApplication=async()=> (await owner.query(`select snapshot,message,status,is_paid,revision::text,sent_at::text,created_at::text,updated_at::text
    from app.applications where id=$1`,[sent.id])).rows[0];
   const before=await persistedApplication(),specialistBefore=await persisted(specialistFixture),labelAfter=`Синтетическая текущая профессия отклика ${ready?'анкета':'каталог'}`;
   await owner.query('update app.specialist_categories set name=$2 where id=$1',[category,labelAfter]);
   const preview=await applications.preview(applicant.token,applicant.id,'workRequest',targets[0].id);
   assert.equal(preview.specialist.snapshot.profession,labelAfter);assert.equal(preview.existing.snapshot.profession,labelBefore);
   const reopened=await applications.read(applicant.token,applicant.id,sent.id);
   assert.equal(reopened.snapshot.profession,labelBefore);assert.equal(reopened.status,'sent');
   assert.equal((await applications.read(recipient.token,recipient.id,sent.id)).snapshot.profession,labelBefore);
   const createdAfter=await applications.create(applicant.token,applicant.id,await input(targets[1]));
   assert.equal(createdAfter.snapshot.profession,labelAfter);assert.notEqual(createdAfter.id,sent.id);
   assert.deepEqual(await persistedApplication(),before);assert.deepEqual(await persisted(specialistFixture),specialistBefore);
   for(const assignment of ['is_paid=false',"status='sent'",'sent_at=clock_timestamp()'])
    await assert.rejects(runtime.query(`update app.applications set ${assignment} where id=$1`,[sent.id]),{code:'42501'});
   await owner.query('update app.specialist_categories set active=false where id=$1',[category]);
   await assert.rejects(applications.preview(applicant.token,applicant.id,'workRequest',targets[1].id));
   assert.equal((await applications.read(applicant.token,applicant.id,sent.id)).snapshot.profession,labelBefore);
   assert.deepEqual(await persistedApplication(),before);
  });
  await suite.test('application ready preview tolerates a profession rename between canonical specialist read and reference eligibility check',async()=>{
   const {PostgresApplicationStore}=load('postgres-applications');
   const applicant=await identity(),recipient=await identity(),beforeLabel='Синтетическая профессия до конкурентного переименования',afterLabel='Синтетическая профессия после конкурентного переименования';
   await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[applicant.id,JSON.stringify({name:'Иван Иванов'})]);
   const category=(await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
    values('application-rename-between-reads',$1,'Синтетическая категория',true) returning id`,[beforeLabel])).rows[0].id;
   const specialist=await create('specialist',{...forms.specialist,professionName:beforeLabel},applicant);
   const specialistFixture={id:specialist.id,table:'service_publications',moderation:'service_moderation'};
   await publish(specialistFixture);
   const target=await create('workRequest',{...forms.workRequest,professionName:beforeLabel},recipient);
   await publish({id:target.id,table:'work_publications',moderation:'work_moderation'});
   const before=await persisted(specialistFixture);let hookCount=0,capturedLabel;
   // Keep every SQL statement real, inserting an owner rename at the exact await boundary.
   const hookedDatabase={transaction:callback=>runtime.transaction(tx=>callback({query:async(sql,values)=>{
    const result=await tx.query(sql,values);
    if(sql.includes("from app.service_publications where author_id=$1")&&sql.endsWith('for update')&&values[0]===applicant.id){
     assert.equal(hookCount,0);hookCount++;
     capturedLabel=result.rows[0].form.professionName;
     assert.equal(capturedLabel,beforeLabel);
     await owner.query('update app.specialist_categories set name=$2 where id=$1',[category,afterLabel]);
    }
    return result;
   }}))};
   const applications=new PostgresApplicationStore(hookedDatabase,{specialistApplicationReady:true});
   const preview=await applications.preview(applicant.token,applicant.id,'workRequest',target.id);
   assert.equal(hookCount,1);assert.equal(preview.specialist.id,specialist.id);assert.equal(preview.specialist.snapshot.profession,capturedLabel);
   assert.equal((await owner.query('select name from app.specialist_categories where id=$1',[category])).rows[0].name,afterLabel);
   assert.deepEqual(await persisted(specialistFixture),before);
   assert.equal((await service.read(applicant.token,applicant.id,'specialist',specialist.id)).form.professionName,afterLabel);
  });
  // New module loads only after existing-store reproductions, so ENOENT cannot mask rename REDs.
  await suite.test('active profession catalog returns bounded exact DTOs and keeps duplicate labels distinguished by UUID',async()=>{
   const {PostgresProfessionRepository}=load('postgres-professions');
   const repository=new PostgresProfessionRepository(runtime);
   const rows=await repository.listActive();
   assert.ok(rows.length>0&&rows.length<=1000);
   for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['active','id','name','parent','slug']);assert.equal(row.active,true);}
   for(const profession of duplicateRows)assert.deepEqual(rows.find(row=>row.id===profession.id),
    {id:profession.id,slug:profession.slug,name:duplicateName,parent:profession.parent_name,active:true});
   await owner.query('update app.specialist_categories set active=false where id=$1',[professionId]);
   assert.equal((await repository.listActive()).some(row=>row.id===professionId),false);
   assert.equal((await repository.listActive()).filter(row=>row.name===duplicateName).length,2);
  });
  await suite.test('active catalog rejects oversized real results instead of returning a partial classifier',async()=>{
   const {PostgresProfessionRepository}=load('postgres-professions');
   await owner.query(`insert into app.specialist_categories(slug,name,parent_name,active)
    select 'profession-bounded-'||n,'Синтетическая профессия '||n,'Синтетическая категория',true from generate_series(1,1005) n`);
   assert.ok(Number((await owner.query('select count(*) from app.specialist_categories where active')).rows[0].count)>1000);
   await assert.rejects(new PostgresProfessionRepository(runtime).listActive(),/catalog/i);
  });
 }finally{
  await Promise.allSettled([runtime?.close(),owner?.end()]);
  if(containerId){
   const metadata=JSON.parse(await docker(['inspect',containerId]))[0];
   if(metadata.Id!==containerId||metadata.Name!==`/${name}`||metadata.Config.Labels[label]!==name)throw Error('Refusing to remove a foreign profession container');
   await docker(['rm','--force',containerId]);
  }
 }
});
