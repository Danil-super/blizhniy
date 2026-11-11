// Disposable synthetic PostgreSQL18; no dotenv, persistent stand or provider access.
import assert from 'node:assert/strict';import {test} from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,readdir} from 'node:fs/promises';import {randomBytes,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,run=promisify(execFile);
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',name='blizhniy-response-fence-'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('response checkout fences edits, photos and selection until authoritative resolution',{timeout:120000},async suite=>{
 let container,admin,db,ownerDb;try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.response-fence='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Image,image);assert.equal(meta.Config.Labels['blizhniy.response-fence'],name);
  const binding=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const until=Date.now()+20000;
  for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<until);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};admin=new pg.Pool({...config,max:6});assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const files=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|4[0-6])-[a-z-]+\.sql$/.test(n)).sort();assert.equal(files.length,46);for(const file of files)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  await admin.query(`create role response_fence_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to response_fence_runtime;grant usage on schema app to response_fence_runtime;
   grant select on app.work_publications,app.applications,app.work_publication_photos,app.media_objects to response_fence_runtime;
   grant update(form,revision,updated_at) on app.work_publications to response_fence_runtime;grant update(status,revision,updated_at) on app.applications to response_fence_runtime;
   grant insert(publication_id,media_id,position),update(publication_id,media_id,position),delete on app.work_publication_photos to response_fence_runtime`);
  const {PostgresPaymentIntentStore}=load('postgres-payment-intents');const {PostgresDatabase}=load('postgres');db=new PostgresDatabase(new pg.Pool({...config,user:'response_fence_runtime',max:5}));ownerDb=new PostgresDatabase(new pg.Pool({...config,max:5}));
  async function user(){const id=randomUUID();await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@fence.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);return id;}
  const author=await user(),payer=await user(),other=await user();
  async function work(kind='workRequest') {return(await admin.query('insert into app.work_publications(author_id,kind,creation_key,form) values($1,$2,$3,$4) returning id',[author,kind,randomUUID(),{kind,title:'Синтетическая публикация'}])).rows[0].id;}
  async function reply(target,{state='created',delivered=false,actor=payer,query=admin}={}){
   const id=(await query.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,1,1,'{}') returning id",[actor,target,randomUUID()])).rows[0].id;
   const paymentId=randomUUID(),body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:paymentId,targetId:id,targetType:'application',tariffId:'application-response'}});
   await ownerDb.transaction(async tx=>{await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{id:paymentId,ownerId:actor,targetType:'application',targetId:id,targetRevision:'1',tariffId:'application-response',amount:'99.00',durationDays:null,shopId:'local-fixture-shop',isTest:true,requestBody:body});});
   await query.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[paymentId,actor,randomUUID(),id]);
   if(state!=='created')await query.query('update app.payment_orders set status=$2 where id=$1',[paymentId,state]);
   if(delivered)await query.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[id]);return{id,paymentId};
  }
  async function media(){return(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',16,16,12,$3) returning id",[author,randomUUID(),'a'.repeat(64)])).rows[0].id;}
  const edit=(target)=>db.query("update app.work_publications set form=jsonb_set(form,'{title}','\"Изменённый заголовок\"'),revision=revision+1,updated_at=clock_timestamp() where id=$1",[target]);
  await suite.test('created, pending and captured-undelivered responses prevent field/revision and photo changes',async()=>{
   for(const state of ['created','pending','succeeded']){const target=await work(),photo=await media();await reply(target,{state});
    await assert.rejects(edit(target),{code:'PWR01'});await assert.rejects(db.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[target,photo]),{code:'PWR01'});
    assert.equal((await admin.query('select revision::text from app.work_publications where id=$1',[target])).rows[0].revision,'1');
   }
  });
  await suite.test('choosing another executor waits for pending response payment; views and rejection remain available',async()=>{
   const target=await work(),waiting=await reply(target,{state:'succeeded'}),chosen=await reply(target,{state:'succeeded',delivered:true,actor:other});
   await assert.rejects(db.query("update app.applications set status='selected',revision=revision+1 where id=$1",[chosen.id]),{code:'PWR01'});
   await db.query("update app.applications set status='viewed',revision=revision+1 where id=$1",[chosen.id]);
   await admin.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[waiting.id]);
   await db.query("update app.applications set status='selected',revision=revision+1 where id=$1",[chosen.id]);
   assert.equal((await admin.query('select count(*)::int as n from app.application_selection_events where application_id=$1',[chosen.id])).rows[0].n,1);
  });
  await suite.test('confirmed failure or delivery unblocks editing; payment status alone is not delivery',async()=>{
   for(const delivered of [false,true]){const target=await work(),item=await reply(target,{state:delivered?'succeeded':'pending'});await assert.rejects(edit(target),{code:'PWR01'});
    if(delivered)await admin.query("update app.applications set is_paid=true,status='sent',sent_at=clock_timestamp() where id=$1",[item.id]);else await admin.query("update app.payment_orders set status='failed' where id=$1",[item.paymentId]);
    await edit(target);assert.equal((await admin.query('select revision::text from app.work_publications where id=$1',[target])).rows[0].revision,'2');
   }
  });
  await suite.test('vacancy edits are fenced, but selecting one applicant does not close the vacancy to other responses',async()=>{
   const target=await work('vacancy');await reply(target);const chosen=await reply(target,{state:'succeeded',delivered:true,actor:other});await assert.rejects(edit(target),{code:'PWR01'});
   await db.query("update app.applications set status='selected' where id=$1",[chosen.id]);
  });
  await suite.test('photo deletion, reordering and moving between parents cannot bypass the fence',async()=>{
   const first=await work(),second=await work(),photo=await media();
   await db.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[first,photo]);await reply(first);
   await assert.rejects(db.query('delete from app.work_publication_photos where publication_id=$1',[first]),{code:'PWR01'});
   await assert.rejects(db.query('update app.work_publication_photos set position=1 where publication_id=$1',[first]),{code:'PWR01'});
   await assert.rejects(db.query('update app.work_publication_photos set publication_id=$2 where publication_id=$1',[first,second]),{code:'PWR01'});
   await db.query('update app.work_publication_photos set position=position where publication_id=$1',[first]);
   const free=await work(),freePhoto=await media();await db.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[free,freePhoto]);
   await assert.rejects(db.query('update app.work_publication_photos set publication_id=$2 where publication_id=$1',[free,first]),{code:'PWR01'});
  });
  await suite.test('only bookkeeping is exempt; dates, payment, references, visibility and revision remain protected',async()=>{
   const target=await work();await reply(target);
   await db.query('update app.work_publications set updated_at=clock_timestamp() where id=$1',[target]);
   for(const assignment of ["status='archived'","deleted_at=clock_timestamp()","published_at=clock_timestamp()","expires_at=clock_timestamp()+interval '30 days'","is_paid=true","revision=revision+1"])
    await assert.rejects(admin.query('update app.work_publications set '+assignment+' where id=$1',[target]),{code:'PWR01'});
  });
  await suite.test('a waiting edit sees checkout committed after its original statement snapshot',async()=>{
   const target=await work(),locker=await admin.connect(),writer=await admin.connect();let mutation;
   try{await locker.query('begin');await locker.query('select id from app.work_publications where id=$1 for update',[target]);
    const pid=(await writer.query('select pg_backend_pid() as pid')).rows[0].pid;
    mutation=writer.query("update app.work_publications set revision=revision+1 where id=$1",[target]);mutation.catch(()=>{});
    const deadline=Date.now()+3000;
    for(;;){if((await admin.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)break;
     assert.ok(Date.now()<deadline,'Edit did not reach the row-lock barrier');await new Promise(resolve=>setTimeout(resolve,10));}
    await reply(target,{query:locker});await locker.query('commit');await assert.rejects(mutation,{code:'PWR01'});
    assert.equal((await admin.query('select revision::text from app.work_publications where id=$1',[target])).rows[0].revision,'1');
   }finally{await locker.query('rollback');await mutation?.catch(()=>{});locker.release();writer.release();}
  });
  await suite.test('photo row to parent lock inversion fails immediately before the older blocking trigger',async()=>{
   const target=await work(),photo=await media(),locker=await admin.connect();await db.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[target,photo]);
   try{await locker.query('begin');await locker.query('select id from app.work_publications where id=$1 for update',[target]);
    await admin.query("set statement_timeout='1500ms'");
    await assert.rejects(admin.query('update app.work_publication_photos set position=1 where publication_id=$1',[target]),{code:'55P03'});
   }finally{await locker.query('rollback');locker.release();await admin.query('reset statement_timeout');}
  });
  await suite.test('repeatable read cannot use a stale checkout snapshot',async()=>{
   const target=await work(),writer=await admin.connect();
   try{await writer.query('begin isolation level repeatable read');await writer.query('select count(*) from app.payment_orders');await reply(target);
    await assert.rejects(writer.query('update app.work_publications set revision=revision+1 where id=$1',[target]),{code:'PBL02'});
    await writer.query('rollback');await writer.query('begin isolation level repeatable read');
    await assert.rejects(writer.query('insert into app.work_publication_photos(publication_id,media_id,position) values($1,$2,0)',[target,await media()]),{code:'PWR02'});
   }finally{await writer.query('rollback');writer.release();}
  });
  await suite.test('initial placement is allowed but cannot smuggle changed content; only its completed exact refund can terminate it',async()=>{
   const target=await work();await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.specialist_categories(slug,name,parent_name) values('santehnik','Сантехник','Ремонт')");await admin.query('update app.work_publications set city_id=c.id,profession_id=p.id from app.cities c cross join app.specialist_categories p where app.work_publications.id=$1',[target]);await reply(target);const paymentId=randomUUID(),provider=randomUUID();
   const body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:paymentId,targetId:target,targetType:'workRequest',tariffId:'work-request-publication'}});
   await ownerDb.transaction(async tx=>{
    await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{id:paymentId,ownerId:author,targetType:'workRequest',targetId:target,targetRevision:'1',tariffId:'work-request-publication',amount:'199.00',durationDays:30,shopId:'local-fixture-shop',isTest:true,requestBody:body});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'workRequest',$4,1)",[paymentId,author,randomUUID(),target]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[paymentId]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[paymentId,provider]);
    await tx.query("update app.payment_orders set status='succeeded' where id=$1",[paymentId]);await tx.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[paymentId,provider]);
    await tx.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,clock_timestamp(),clock_timestamp()+interval '30 days')",[paymentId]);
   });
   await assert.rejects(admin.query("update app.work_publications set revision=revision+1,status='published',is_paid=true,published_at=f.published_at,expires_at=f.expires_at from app.payment_fulfillments f where app.work_publications.id=$1 and f.intent_id=$2",[target,paymentId]),{code:'PWR01'});
   await admin.query("update app.work_publications set status='published',is_paid=true,published_at=f.published_at,expires_at=f.expires_at from app.payment_fulfillments f where app.work_publications.id=$1 and f.intent_id=$2",[target,paymentId]);
   const before=(await admin.query('select form,revision::text,published_at::text,expires_at::text from app.work_publications where id=$1',[target])).rows[0];
   await assert.rejects(admin.query("update app.work_publications set status='archived',is_paid=false where id=$1",[target]),{code:'PWR01'});
   await admin.query("update app.payment_orders set status='refunded' where id=$1",[paymentId]);
   await assert.rejects(admin.query("update app.work_publications set status='archived',is_paid=false,expires_at=expires_at+interval '1 second' where id=$1",[target]),{code:'PWR01'});
   await assert.rejects(admin.query("update app.work_publications set status='archived',is_paid=false,revision=revision+1 where id=$1",[target]),{code:'PWR01'});
   await admin.query("update app.work_publications set status='archived',is_paid=false,updated_at=clock_timestamp() where id=$1",[target]);
   assert.deepEqual((await admin.query('select form,revision::text,published_at::text,expires_at::text from app.work_publications where id=$1',[target])).rows[0],before);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[paymentId])).rows[0].n,1);
  });
  await suite.test('the manual sparse schema installs and executes the fence without refund/compensation migrations or new grants',async()=>{
   await admin.query('create database response_fence_sparse');const pool=new pg.Pool({...config,database:'response_fence_sparse'}),sparse=new PostgresDatabase(pool);
   try{const names=files.filter(file=>Number(file.slice(0,4))<=35||[41,44,46].includes(Number(file.slice(0,4))));assert.equal(names.length,38);
    for(const file of names)await pool.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
    assert.equal((await pool.query("select to_regclass('app.payment_refund_effects') as name")).rows[0].name,null);
    const target=randomUUID(),id=randomUUID(),payment=randomUUID();
    await pool.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[author,'sparse@fence.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
    await pool.query("insert into app.work_publications(id,author_id,kind,creation_key,form) values($1,$2,'workRequest',$3,'{\"kind\":\"workRequest\",\"title\":\"Синтетическая публикация\"}')",[target,author,randomUUID()]);
    await pool.query("insert into app.applications(id,applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,$4,1,1,'{}')",[id,author,target,randomUUID()]);
    const body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:payment,targetId:id,targetType:'application',tariffId:'job-response'}});
    await sparse.transaction(async tx=>{await new PostgresPaymentIntentStore(sparse).persistInTransaction(tx,{id:payment,ownerId:author,targetType:'application',targetId:id,targetRevision:'1',tariffId:'job-response',amount:'99.00',durationDays:null,shopId:'local-fixture-shop',isTest:true,requestBody:body});
     await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[payment,author,randomUUID(),id]);});
    await assert.rejects(pool.query('update app.work_publications set revision=revision+1 where id=$1',[target]),{code:'PWR01'});
    assert.equal((await pool.query("select has_function_privilege('public','app.require_resolved_response_checkout(uuid)','execute') as allowed")).rows[0].allowed,false);
   }finally{await sparse.close();}
  });
  await suite.test('the runtime receives no financial access or authority to disable the fence',async()=>{
   for(const sql of ['select * from app.payment_orders',"update app.payment_orders set status='failed' where false",'alter table app.work_publications disable trigger all'])await assert.rejects(db.query(sql),{code:'42501'});
  });
 }finally{await db?.close();await ownerDb?.close();await admin?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels['blizhniy.response-fence'],name);await docker(['rm','--force','--volumes',container]);}}
});
