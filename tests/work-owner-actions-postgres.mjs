// Synthetic disposable PG18 only. No persistent DB, dotenv or real provider.
import assert from 'node:assert/strict';import {test} from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';import {readFile,readdir} from 'node:fs/promises';import {createRequire} from 'node:module';import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-work-actions-'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('work owner lifecycle preserves purchases and records authentic customer closure',{timeout:120000},async suite=>{
 const migration=await readFile(new URL('../database/migrations/0044-work-owner-actions.sql',import.meta.url),'utf8');
 const {PostgresDatabase}=load('postgres'),{PostgresPaymentIntentStore}=load('postgres-payment-intents'),{hashSessionToken}=load('identity');
 const {PostgresWorkOwnerActions}=load('postgres-work-owner-actions');let container,admin,db,ownerDb;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.work-actions='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Image,image);assert.equal(meta.Config.Labels['blizhniy.work-actions'],name);
  const binding=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const until=Date.now()+20000;
  for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<until);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};admin=new pg.Pool({...config,max:5});
  assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const files=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|4[0-3])-[a-z-]+\.sql$/.test(n)).sort();assert.equal(files.length,43);
  for(const file of files)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));await admin.query(migration);
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.specialist_categories(slug,name,parent_name) values('santehnik','Сантехник','Ремонт')");
  await admin.query(`create role work_action_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to work_action_runtime;grant usage on schema app to work_action_runtime;
   grant select on app.users,app.sessions,app.work_publications,app.work_owner_actions to work_action_runtime;
   grant update(id) on app.users to work_action_runtime;grant update(last_seen_at) on app.sessions to work_action_runtime;
   grant insert(operation_id,publication_id,expected_revision,action,reason) on app.work_owner_actions to work_action_runtime`);
  db=new PostgresDatabase(new pg.Pool({...config,user:'work_action_runtime',max:5}));ownerDb=new PostgresDatabase(new pg.Pool({...config,max:5}));const store=new PostgresWorkOwnerActions(db);
  async function user(){const id=randomUUID(),token=randomBytes(32).toString('hex');await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@work.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);return{id,token};}
  const author=await user(),other=await user();
  async function publication({kind='workRequest',paid=true,expired=false}={}){
   const form={kind,title:'Синтетический заказ',description:'Нужно выполнить работы по ремонту.',cityName:'Краснодар',professionName:'Сантехник',budget:'3500.00',photoIds:[]};
   const id=(await admin.query('insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id) select $1,$2,$3,$4,c.id,p.id from app.cities c cross join app.specialist_categories p returning id',[author.id,kind,randomUUID(),form])).rows[0].id;
   if(!paid)return{id,kind,paymentId:null};
   const paymentId=randomUUID(),provider=randomUUID(),capture=new Date(Date.now()-86400000).toISOString();
   const body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:paymentId,targetId:id,targetType:kind,tariffId:kind==='vacancy'?'vacancy-publication':'work-request-publication'}});
   await ownerDb.transaction(async tx=>{await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{id:paymentId,ownerId:author.id,targetType:kind,targetId:id,targetRevision:'1',tariffId:kind==='vacancy'?'vacancy-publication':'work-request-publication',amount:'199.00',durationDays:30,shopId:'local-fixture-shop',isTest:true,requestBody:body});
    await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[paymentId,author.id,randomUUID(),kind,id]);await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[paymentId]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[paymentId,provider]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[paymentId]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[paymentId,provider,capture]);
    await tx.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,clock_timestamp()-interval '2 days',clock_timestamp()+$2::interval)",[paymentId,expired?'-1 day':'28 days']);
    // Seed a historical expired placement without pretending a new publication can start expired.
    if(expired)await tx.query('alter table app.work_publications disable trigger work_phone_payment_window');
    await tx.query("update app.work_publications set status='published',is_paid=true,published_at=f.published_at,expires_at=f.expires_at from app.payment_fulfillments f where app.work_publications.id=$1 and f.intent_id=$2",[id,paymentId]);
    if(expired)await tx.query('alter table app.work_publications enable trigger work_phone_payment_window');});
   return{id,kind,paymentId};
  }
  const input=(item,action,revision='1')=>({operationId:randomUUID(),publicationId:item.id,kind:item.kind,expectedRevision:revision,action,reason:action==='restore'?null:'Работы больше не требуются.'});
  const snapshot=async item=>(await admin.query('select form,is_paid,published_at::text,expires_at::text,deleted_at::text,status,revision::text from app.work_publications where id=$1',[item.id])).rows[0];
  async function response(item,{captured=false,delivered=false}={}){
   const id=(await admin.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,1,1,'{}') returning id",[other.id,item.id,randomUUID()])).rows[0].id;
   const paymentId=randomUUID(),provider=randomUUID();await ownerDb.transaction(async tx=>{
    const body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:paymentId,targetId:id,targetType:'application',tariffId:'job-response'}});
    await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{id:paymentId,ownerId:other.id,targetType:'application',targetId:id,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:'local-fixture-shop',isTest:true,requestBody:body});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[paymentId,other.id,randomUUID(),id]);
    if(captured){await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[paymentId]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[paymentId,provider]);
     await tx.query("update app.payment_orders set status='succeeded' where id=$1",[paymentId]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[paymentId,provider,new Date(Date.now()-1000).toISOString()]);}
    if(delivered)await tx.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[id]);
   });return{id,paymentId};
  }
  await suite.test('withdraw, restore and soft removal preserve exact financial period and content with exact operation replay',async()=>{
   const item=await publication(),before=await snapshot(item),withdraw=input(item,'withdraw');const hidden=await store.change(author.token,author.id,withdraw);assert.equal(hidden.status,'archived');assert.equal(hidden.resultingRevision,'2');
   assert.deepEqual(await store.change(author.token,author.id,withdraw),hidden);const restored=await store.change(author.token,author.id,input(item,'restore','2'));assert.equal(restored.status,'published');
   const removedInput=input(item,'remove','3'),removed=await store.change(author.token,author.id,removedInput);assert.equal(removed.action,'remove');assert.deepEqual(await store.change(author.token,author.id,removedInput),removed);
   const after=await snapshot(item);for(const field of ['form','is_paid','published_at','expires_at'])assert.deepEqual(after[field],before[field]);assert.ok(after.deleted_at);assert.equal(after.revision,'4');
  });
  await suite.test('other users, mismatched replay, stale revisions and unauthenticated direct SQL cannot mutate work',async()=>{
   const item=await publication(),request=input(item,'withdraw');await assert.rejects(store.change(other.token,other.id,request));await assert.rejects(db.query('insert into app.work_owner_actions(operation_id,publication_id,expected_revision,action,reason) values($1,$2,1,\'withdraw\',\'Причина\')',[randomUUID(),item.id]),{code:'42501'});
   await store.change(author.token,author.id,request);await assert.rejects(store.change(author.token,author.id,{...request,reason:'Другая причина.'}));await assert.rejects(store.change(author.token,author.id,input(item,'restore','1')));
   for(const sql of ["update app.work_publications set status='published' where false","update app.payment_orders set status='refunded' where false","delete from app.work_owner_actions where false","insert into app.work_owner_actions(operation_id,publication_id,expected_revision,action,reason,owner_id) values(gen_random_uuid(),gen_random_uuid(),1,'remove','Причина',gen_random_uuid())"])await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('draft removal is soft and cannot be restored; expiry and refunded payments deny restoration',async()=>{
   const draft=await publication({paid:false});await store.change(author.token,author.id,input(draft,'remove'));await assert.rejects(store.change(author.token,author.id,input(draft,'restore','2')));
   const item=await publication();await store.change(author.token,author.id,input(item,'withdraw'));await admin.query("update app.payment_orders set status='refunded' where id=$1",[item.paymentId]);await assert.rejects(store.change(author.token,author.id,input(item,'restore','2')));
   const expired=await publication({expired:true});await assert.rejects(store.change(author.token,author.id,input(expired,'withdraw')));await store.change(author.token,author.id,input(expired,'remove'));
  });
  await suite.test('disabled profession and rejected current moderation deny restore without extending a period',async()=>{
   const item=await publication();await store.change(author.token,author.id,input(item,'withdraw'));await admin.query('update app.specialist_categories set active=false');try{await assert.rejects(store.change(author.token,author.id,input(item,'restore','2')));}finally{await admin.query('update app.specialist_categories set active=true');}
   await admin.query("insert into app.work_moderation(publication_id,revision,state,decision_note,decided_at,decided_by) values($1,2,'rejected','Нарушение',clock_timestamp(),$2)",[item.id,other.id]);await assert.rejects(store.change(author.token,author.id,input(item,'restore','2')));
  });
  await suite.test('lost COMMIT response recovers the same operation after soft deletion',async()=>{
   const item=await publication({paid:false}),request=input(item,'remove');const uncertain=new PostgresWorkOwnerActions({transaction:async work=>{await db.transaction(work);throw Error('Synthetic lost COMMIT acknowledgement');}});
   await assert.rejects(uncertain.change(author.token,author.id,request));assert.equal((await store.change(author.token,author.id,request)).action,'remove');assert.equal((await admin.query('select count(*)::int as n from app.work_owner_actions where operation_id=$1',[request.operationId])).rows[0].n,1);
  });
  await suite.test('created and captured-but-undelivered response payments fence closure until resolution',async()=>{
   for(const captured of [false,true]){const item=await publication(),reply=await response(item,{captured});
    for(const action of ['withdraw','remove'])await assert.rejects(store.change(author.token,author.id,input(item,action)),{name:'WorkOwnerActionPaymentPendingError'});
    assert.equal((await snapshot(item)).revision,'1');
    if(captured)await admin.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[reply.id]);
    else await admin.query("update app.payment_orders set status='failed' where id=$1",[reply.paymentId]);
    assert.equal((await store.change(author.token,author.id,input(item,'withdraw'))).status,'archived');
   }
  });
  await suite.test('selecting an executor prevents restoration but does not prevent soft removal',async()=>{
   const item=await publication(),reply=await response(item,{captured:true,delivered:true});await admin.query("update app.applications set status='selected' where id=$1",[reply.id]);
   await store.change(author.token,author.id,input(item,'withdraw'));await assert.rejects(store.change(author.token,author.id,input(item,'restore','2')));
   assert.equal((await store.change(author.token,author.id,input(item,'remove','2'))).action,'remove');
  });
  await suite.test('work lock conflicts fail NOWAIT and leave no action or revision change',async()=>{
   const item=await publication(),locker=await admin.connect();try{await locker.query('begin');await locker.query('select id from app.work_publications where id=$1 for update',[item.id]);
    await assert.rejects(store.change(author.token,author.id,input(item,'withdraw')),{name:'WorkOwnerActionBusyError'});
   }finally{await locker.query('rollback');locker.release();}
   assert.equal((await snapshot(item)).revision,'1');assert.equal((await admin.query('select count(*)::int as n from app.work_owner_actions where publication_id=$1',[item.id])).rows[0].n,0);
  });
  await suite.test('vacancy owner actions use the same journal and preserve the paid period',async()=>{
   const item=await publication({kind:'vacancy'}),before=await snapshot(item);await store.change(author.token,author.id,input(item,'withdraw'));
   assert.equal((await store.change(author.token,author.id,input(item,'restore','2'))).kind,'vacancy');await store.change(author.token,author.id,input(item,'remove','3'));
   const after=await snapshot(item);for(const field of ['form','is_paid','published_at','expires_at'])assert.deepEqual(after[field],before[field]);
  });
  await suite.test('restoration still requires a confirmed phone when the current policy requires it',async()=>{
   const item=await publication();await store.change(author.token,author.id,input(item,'withdraw'));
   await admin.query('update app.phone_verification_policy set available=true,required=true');
   try{await assert.rejects(store.change(author.token,author.id,input(item,'restore','2')),{code:'P7601'});assert.equal((await snapshot(item)).revision,'2');}
   finally{await admin.query('update app.phone_verification_policy set required=false,available=false');}
  });
  await suite.test('ON CONFLICT DO NOTHING cannot mutate the publication without inserting closure evidence',async()=>{
   const item=await publication(),withdraw=input(item,'withdraw');await store.change(author.token,author.id,withdraw);await store.change(author.token,author.id,input(item,'restore','2'));
   const before=await snapshot(item);
   await db.transaction(async tx=>{await tx.query("select set_config('blizhniy.work_owner_session',$1,true)",[hashSessionToken(author.token)]);
    await tx.query("insert into app.work_owner_actions(operation_id,publication_id,expected_revision,action,reason) values($1,$2,3,'remove','Повторная операция') on conflict do nothing",[withdraw.operationId,item.id]);});
   assert.deepEqual(await snapshot(item),before);
   assert.equal((await admin.query('select count(*)::int as n from app.work_owner_actions where publication_id=$1',[item.id])).rows[0].n,2);
  });
  await suite.test('authentic withdrawal/removal qualifies unread responses and restoration does not erase the event',async()=>{
   await admin.query(await readFile(new URL('../database/migrations/0045-customer-closure-compensation.sql',import.meta.url),'utf8'));
   const {PostgresApplicationCompensationStore}=load('postgres-application-compensation'),compensation=new PostgresApplicationCompensationStore(ownerDb,{shopId:'local-fixture-shop',isTest:true});
   for(const action of ['withdraw','remove']){
    const item=await publication(),reply=await response(item,{captured:true,delivered:true});assert.equal((await compensation.claim(reply.paymentId)).state,'waiting');
    const closed=await store.change(author.token,author.id,input(item,action));
    if(action==='withdraw')await store.change(author.token,author.id,input(item,'restore','2'));
    const result=await compensation.claim(reply.paymentId);assert.equal(result.state,'claimed');assert.equal(result.case.reason,'customer-closed-unread');assert.equal(result.case.eligibleAt,closed.occurredAt);
    assert.deepEqual(await compensation.claim(reply.paymentId),result);
   }
  });
  await suite.test('contacts viewed before customer closure still exclude compensation',async()=>{
   const {PostgresApplicationCompensationStore}=load('postgres-application-compensation'),compensation=new PostgresApplicationCompensationStore(ownerDb,{shopId:'local-fixture-shop',isTest:true});
   const item=await publication(),reply=await response(item,{captured:true,delivered:true});await admin.query('insert into app.application_contact_views(application_id,recipient_id) values($1,$2)',[reply.id,author.id]);
   await store.change(author.token,author.id,input(item,'remove'));assert.deepEqual(await compensation.claim(reply.paymentId),{state:'ineligible',reason:'viewed'});
   await assert.rejects(admin.query('insert into app.application_compensation_cases(payment_intent_id,merchant_shop_id) values($1,$2)',[reply.paymentId,'local-fixture-shop']),{code:'PBC01'});
  });
 }finally{await db?.close();await ownerDb?.close();await admin?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels['blizhniy.work-actions'],name);await docker(['rm','--force','--volumes',container]);}}
});
