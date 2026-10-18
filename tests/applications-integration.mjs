import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {hashSessionToken} from '../src/lib/identity.ts';
import {workPublicationModule} from './work-publication-module.mjs';import * as contract from '../src/lib/application-contract.ts';import * as service from '../src/lib/service-publication-contract.ts';
import * as publicWork from '../src/lib/public-work-publications.ts';import * as publicService from '../src/lib/public-service-publications.ts';import pg from 'pg';
import {createRequire} from 'node:module';import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import * as drafts from '../src/lib/listing-draft-contract.ts';import {loadAdminModule} from './admin-module.mjs';
const inbox=workPublicationModule('postgres-notification-inbox');
const deps={'./application-contract.ts':contract,'./service-publication-contract.ts':service,'./postgres-notification-inbox':inbox,
 './postgres-public-work':workPublicationModule('postgres-public-work',{'./public-work-publications.ts':publicWork}),
 './postgres-public-service':workPublicationModule('postgres-public-service',{'./public-service-publications.ts':publicService})};
export async function testApplications(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const storage=workPublicationModule('postgres-applications',deps),{PostgresApplicationStore}=storage;
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresApplicationStore(db),users=[];
 let targets=[],specialist,created;
 try{
  for(let n=0;n<3;n++){
   const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`application-${id}@example.invalid`,`scrypt$131072$8$1$${'c'.repeat(32)}$${'d'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  }
  const [applicant,employer,foreign]=users,refs=(await admin.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.specialist_categories where name='Сантехник') as profession")).rows[0];
  for(const kind of ['vacancy','workRequest']){
   const form={kind,title:'Техническая работа',description:'Синтетическое описание работы для интеграционной проверки.',cityName:'Краснодар',professionName:'Сантехник',contactPhone:'+79990000000',placementRightConfirmed:true,...(kind==='vacancy'?{employerType:'person',organization:'Работодатель',salary:'1250.50'}:{budget:'1250.50'})};
   const {parseWorkPublicationForm}=await import('../src/lib/work-publication-contract.ts');
   const row=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) values($1,$2,gen_random_uuid(),$3::jsonb,$4,$5,'published',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day') returning id",[employer.id,kind,JSON.stringify(parseWorkPublicationForm(kind,form)),refs.city,refs.profession])).rows[0];targets.push({id:row.id,kind});
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[row.id]);
  }
  const form=service.parseServicePublicationForm('specialist',{title:'Синтетический мастер',description:'Синтетическое описание опыта специалиста.',cityName:'Краснодар',professionName:'Сантехник',skills:'Монтаж и ремонт',price:'1250.50',contactPhone:'+79990000000',email:'fixture@example.invalid',placementRightConfirmed:true});
  specialist=(await admin.query("insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) values($1,'specialist',gen_random_uuid(),$2::jsonb,$3,$4,'published',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day') returning id",[applicant.id,JSON.stringify(form),refs.city,refs.profession])).rows[0].id;
  await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[specialist]);
  const input=target=>({...target,targetId:target.id,creationKey:randomUUID(),message:'Готов помочь.',expectedTargetRevision:'1',specialistId:specialist,expectedSpecialistRevision:'1'});
  const createInput=target=>{const value=input(target);delete value.id;return value;};
  await suite.test('application preview and create snapshot the current own eligible specialist for either work kind without publishing, paying or delivering',async()=>{
   for(const target of targets){const preview=await store.preview(applicant.token,applicant.id,target.kind,target.id);assert.equal(preview.target.id,target.id);assert.equal(preview.specialist.snapshot.name,form.title);assert.equal(preview.specialist.snapshot.phone,form.contactPhone);assert.equal(preview.existing,null);}
   const data=createInput(targets[0]);created=await store.create(applicant.token,applicant.id,data);assert.equal(created.status,'pending_payment');assert.equal(created.paid,false);assert.equal(created.sentAt,null);assert.equal(created.revision,'1');assert.equal(created.snapshot.email,form.email);
   assert.deepEqual(await store.create(applicant.token,applicant.id,data),created);assert.deepEqual(await store.readIntent(applicant.token,applicant.id,data.creationKey),created);
   await assert.rejects(store.create(applicant.token,applicant.id,{...data,message:'Другой текст'}),{name:'ApplicationConflictError'});
   assert.equal((await store.preview(applicant.token,applicant.id,targets[0].kind,targets[0].id)).existing.id,created.id);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where user_id=any($1::uuid[])',[users.map(user=>user.id)])).rows[0].n,0);
  });
  await suite.test('unpaid applications are private to their applicant, expected-owner substitution and unrelated viewers cannot read or decide',async()=>{
   await assert.rejects(store.read(employer.token,employer.id,created.id),{name:'ApplicationAccessError'});await assert.rejects(store.read(foreign.token,foreign.id,created.id),{name:'ApplicationAccessError'});
   await assert.rejects(store.read(applicant.token,foreign.id,created.id),{name:'AppSessionAccessError'});
   assert.deepEqual((await store.list(employer.token,employer.id,'recipient',null)).items,[]);assert.equal((await store.list(applicant.token,applicant.id,'applicant',null)).items[0].id,created.id);
   await assert.rejects(store.decide(employer.token,employer.id,created.id,'1','selected'),{name:'ApplicationAccessError'});
   await assert.rejects(store.preview(employer.token,employer.id,targets[0].kind,targets[0].id),{name:'ApplicationAccessError'});
   await assert.rejects(store.preview(foreign.token,foreign.id,targets[0].kind,targets[0].id),{name:'ApplicationEligibilityError'});
  });
  await suite.test('applications require current live paid approval, matching exact target and specialist revisions, not stale editor snapshots',async()=>{
   for(const table of ['work_publications','service_publications']){
    const target=table==='work_publications'?targets[1].id:specialist;
    await admin.query(`update app.${table} set expires_at=clock_timestamp()-interval '1 second' where id=$1`,[target]);
    await assert.rejects(store.preview(applicant.token,applicant.id,targets[1].kind,targets[1].id));
    await admin.query(`update app.${table} set expires_at=clock_timestamp()+interval '1 day' where id=$1`,[target]);
   }
   for(const change of [{expectedTargetRevision:'2'},{expectedSpecialistRevision:'2'},{specialistId:randomUUID()}])await assert.rejects(store.create(applicant.token,applicant.id,{...createInput(targets[1]),...change}),{name:'ApplicationConflictError'});
   await admin.query('update app.users set is_blocked=true where id=$1',[employer.id]);await assert.rejects(store.preview(applicant.token,applicant.id,targets[1].kind,targets[1].id));await admin.query('update app.users set is_blocked=false where id=$1',[employer.id]);
  });
  await suite.test('two creation intents for one target produce exactly one pending application, and applicant edits use exact bigint CAS',async()=>{
   const results=await Promise.allSettled([store.create(applicant.token,applicant.id,createInput(targets[1])),store.create(applicant.token,applicant.id,createInput(targets[1]))]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);
   const edits=['Первая правка','Вторая правка'].map(message=>store.update(applicant.token,applicant.id,{applicationId:created.id,expectedRevision:'1',expectedTargetRevision:'1',specialistId:specialist,expectedSpecialistRevision:'1',message}));
   const outcomes=await Promise.allSettled(edits);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected').length,1);created=outcomes.find(row=>row.status==='fulfilled').value;assert.equal(created.revision,'2');
   await admin.query('update app.applications set revision=9007199254740993 where id=$1',[created.id]);
   created=await store.update(applicant.token,applicant.id,{applicationId:created.id,expectedRevision:'9007199254740993',expectedTargetRevision:'1',specialistId:specialist,expectedSpecialistRevision:'1',message:'Точное большое значение'});assert.equal(created.revision,'9007199254740994');
  });
  await suite.test('paid delivery fixtures become visible only to their real recipient; decisions are concurrent, terminal and atomically deduplicate the applicant inbox event',async()=>{
   // Owner-only isolated fixture simulates the later provider-verified fulfilment. Production runtime cannot assign these columns.
   await admin.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[created.id]);
   const delivered=await store.read(employer.token,employer.id,created.id);assert.equal(delivered.view,'recipient');assert.equal(delivered.snapshot.phone,form.contactPhone);
   await assert.rejects(store.read(foreign.token,foreign.id,created.id),{name:'ApplicationAccessError'});
   const revision=delivered.revision,results=await Promise.allSettled(['selected','rejected'].map(state=>store.decide(employer.token,employer.id,created.id,revision,state)));
   assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);const winner=results.find(row=>row.status==='fulfilled').value;
   assert.deepEqual(await store.decide(employer.token,employer.id,created.id,revision,winner.status),winner);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[applicant.id])).rows[0].n,1);
   await assert.rejects(store.update(applicant.token,applicant.id,{applicationId:created.id,expectedRevision:winner.revision,expectedTargetRevision:'1',specialistId:specialist,expectedSpecialistRevision:'1',message:'Нельзя переписать доставленный отклик'}),{name:'ApplicationConflictError'});
  });
  await suite.test('busy applicant user locks refuse a recipient decision without waiting into a cross-user deadlock or writing an event',async()=>{
   const own=(await store.list(applicant.token,applicant.id,'applicant',null)).items.find(row=>row.id!==created.id);await admin.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[own.id]);
   const locker=new pg.Client(config);await locker.connect();try{await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[applicant.id]);
    await assert.rejects(store.decide(employer.token,employer.id,own.id,own.revision,'selected'),{name:'ApplicationBusyError'});
    assert.equal((await admin.query('select status from app.applications where id=$1',[own.id])).rows[0].status,'sent');
   }finally{await locker.query('rollback');await locker.end();}
   assert.equal((await store.decide(employer.token,employer.id,own.id,own.revision,'viewed')).status,'viewed');
  });
  await suite.test('a publication expiring after the application INSERT rolls back the pending application instead of committing a stale eligibility result',async()=>{
   const target=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) select author_id,kind,gen_random_uuid(),form,city_id,profession_id,status,is_paid,published_at,clock_timestamp()+interval '1 second' from app.work_publications where id=$1 returning id",[targets[0].id])).rows[0].id;
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);
   let inserted=false;const slow=new PostgresApplicationStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    const result=await tx.query(sql,values);if(sql.startsWith('insert into app.applications')){inserted=true;await tx.query('select pg_sleep(1.2)');}return result;
   }}))});
   const data=createInput({id:target,kind:'vacancy'});await assert.rejects(slow.create(applicant.token,applicant.id,data),{name:'ApplicationAccessError'});assert.equal(inserted,true);
   assert.equal(await store.readIntent(applicant.token,applicant.id,data.creationKey),null);
  });
  await suite.test('an unknown application COMMIT is recovered through its original intent without another write',async()=>{
   const target=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) select author_id,kind,gen_random_uuid(),form,city_id,profession_id,status,is_paid,published_at,clock_timestamp()+interval '1 day' from app.work_publications where id=$1 returning id",[targets[0].id])).rows[0].id;
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);
   let commits=0;const unknown=new PostgresApplicationStore({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost COMMIT response');}}),data=createInput({id:target,kind:'vacancy'});
   await assert.rejects(unknown.create(applicant.token,applicant.id,data));assert.equal(commits,1);
   const recovered=await store.readIntent(applicant.token,applicant.id,data.creationKey);assert.equal(recovered.message,data.message);assert.equal(recovered.paid,false);
   assert.equal((await admin.query('select count(*)::int as n from app.applications where applicant_id=$1 and creation_key=$2',[applicant.id,data.creationKey])).rows[0].n,1);
  });
  await suite.test('notification failure rolls the entire recipient decision back, leaving the previously delivered response and inbox unchanged',async()=>{
   const summaries=(await store.list(employer.token,employer.id,'recipient',null)).items,entry=summaries.find(row=>row.status==='viewed'),before=await store.read(employer.token,employer.id,entry.id);
   const count=(await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[applicant.id])).rows[0].n;
   const faulty=new PostgresApplicationStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    if(sql.startsWith('insert into app.notifications'))throw Error('Synthetic inbox write failure');return tx.query(sql,values);
   }}))});
   await assert.rejects(faulty.decide(employer.token,employer.id,entry.id,entry.revision,'selected'));
   assert.deepEqual(await store.read(employer.token,employer.id,entry.id),before);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[applicant.id])).rows[0].n,count);
  });
  await suite.test('expiry of the recipient session after inbox creation rolls back both decision and event',async()=>{
   const entry=(await store.list(employer.token,employer.id,'recipient',null)).items.find(row=>row.status==='viewed'),before=await store.read(employer.token,employer.id,entry.id);
   const count=(await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[applicant.id])).rows[0].n;
   const slow=new PostgresApplicationStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    const result=await tx.query(sql,values);if(sql.startsWith('insert into app.notifications'))await tx.query('select pg_sleep(0.4)');return result;
   }}))});
   await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '300 milliseconds' where token_hash=$1",[hashSessionToken(employer.token)]);
   try{await assert.rejects(slow.decide(employer.token,employer.id,entry.id,entry.revision,'selected'),{name:'AppSessionAccessError'});}
   finally{await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=$1",[hashSessionToken(employer.token)]);}
   assert.deepEqual(await store.read(employer.token,employer.id,entry.id),before);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[applicant.id])).rows[0].n,count);
  });
  await suite.test('cookie application HTTP composes exact current ownership and restricted SQL for preview/create/readback without financial authority',async()=>{
   const {createProductionApplicationHandler}=workPublicationModule('production-application-http',{
    'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./app-session-transaction':loadAdminModule('app-session-transaction'),
    './listing-draft-contract.ts':drafts,'./application-contract.ts':contract,'./postgres-applications':storage});
   const events=[],origin='https://owned-applications.example.invalid',handler=createProductionApplicationHandler({origin},()=>({store,limiter:{allowProduction:async()=>true}}),event=>events.push(event));
   const request=(user,body,method='POST')=>new Request(origin+'/api/account/applications',{method,headers:{host:'owned-applications.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+user.token},body:JSON.stringify({expectedOwnerId:user.id,...body})});
   const preview=await handler(request(applicant,{action:'preview',kind:'vacancy',targetId:targets[0].id}));assert.equal(preview.status,200);assert.equal((await preview.json()).existing.id,created.id);
   const target=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) select author_id,kind,gen_random_uuid(),form,city_id,profession_id,status,is_paid,published_at,clock_timestamp()+interval '1 day' from app.work_publications where id=$1 returning id",[targets[0].id])).rows[0].id;
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);const input=createInput({id:target,kind:'vacancy'});
   const response=await handler(request(applicant,{action:'create',input},'PUT'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.paid,false);assert.equal(result.sentAt,null);
   const recovered=await handler(request(applicant,{action:'intent',creationKey:input.creationKey}));assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),result);
   assert.equal((await handler(request(employer,{action:'read',applicationId:result.id}))).status,404);
   assert.equal((await handler(request(foreign,{action:'read',applicationId:result.id,expectedOwnerId:applicant.id}))).status,401);
   for(const privateValue of [applicant.token,applicant.id,input.message,form.contactPhone,form.email])assert.equal(JSON.stringify(events).includes(privateValue),false);
  });
  await suite.test('private application pages preserve microsecond cursor order and omit all snapshots, messages, participant IDs and contacts',async()=>{
   const baseline=(await admin.query('select count(*)::int as n from app.applications where applicant_id=$1',[applicant.id])).rows[0].n;
   for(let n=0;n<25;n++){
    const target=(await admin.query("insert into app.work_publications(author_id,kind,creation_key,form) select author_id,kind,gen_random_uuid(),form from app.work_publications where id=$1 returning id",[targets[0].id])).rows[0].id;
    await admin.query("insert into app.applications(applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,created_at) select applicant_id,$2,specialist_publication_id,gen_random_uuid(),target_revision,specialist_revision,snapshot,'2026-01-01T00:00:00.123456Z' from app.applications where id=$1",[created.id,target]);
   }
   const first=await store.list(applicant.token,applicant.id,'applicant',null),second=await store.list(applicant.token,applicant.id,'applicant',first.nextCursor),items=[...first.items,...second.items];
   assert.equal(first.items.length,20);assert.equal(items.length,baseline+25);assert.equal(new Set(items.map(item=>item.id)).size,items.length);assert.equal(second.nextCursor,null);assert.equal(first.nextCursor.updatedAt,'2026-01-01T00:00:00.123456Z');
   for(const item of items)for(const key of ['snapshot','message','applicant','targetOwner','email','phone'])assert.equal(Object.hasOwn(item,key),false);
   await admin.query('update app.users set is_blocked=true where id=$1',[applicant.id]);await assert.rejects(store.list(applicant.token,applicant.id,'applicant',null),{name:'AppSessionAccessError'});
  });
 }finally{for(const user of users)await admin.query('delete from app.users where id=$1',[user.id]);await db.close();}
}
