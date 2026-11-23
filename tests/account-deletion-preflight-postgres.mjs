// Disposable synthetic PostgreSQL only. The planner itself always runs read-only.
import assert from 'node:assert/strict';import{test}from'node:test';
import{execFile}from'node:child_process';import{promisify}from'node:util';import{randomBytes,randomUUID,randomInt}from'node:crypto';
import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import pg from'pg';
import{getRefundWorkerRolePlan}from'../scripts/refund-worker-role.mjs';
import{getAdminUserAccessMigration}from'../scripts/admin-user-access-release.mjs';import{getAdminTariffMigration}from'../scripts/admin-tariff-release.mjs';
import{localPrimaryImage}from'../scripts/local-primary-config.mjs';
import{readAccountExport}from'../scripts/export-local-account-data.mjs';
import{inspectAccountDeletionCase}from'../src/lib/account-deletion-preflight.ts';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,run=promisify(execFile);

test('deletion advisory plans bind one request and observe real domain blockers without changing data',{timeout:90000},async suite=>{
 const name='blizhniy-deletion-plan-'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex'),label='blizhniy.deletion-plan';let container,owner,db;
 const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
 const envKeys=['NODE_ENV','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN','BLIZHNIY_LISTING_WORKFLOW'],saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',localPrimaryImage]);
  assert.match(container,/^[a-f0-9]{64}$/);const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels[label],name);assert.equal(meta.Config.Image,localPrimaryImage);
  const port=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');
  for(const deadline=Date.now()+20000;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(port.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  owner=new pg.Pool({...config,max:3});db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:3}));
  for(const row of getRefundWorkerRolePlan('blizhniy_test',{schema:60,localPrimary:true}).journal)await owner.query(await readFile(new URL('../database/'+(/^(0058|0060)-/.test(row.name)?'candidates/':'migrations/')+row.name,import.meta.url),'utf8'));
  for(const migration of [getAdminUserAccessMigration(),getAdminTariffMigration()])await owner.query(migration.source);
  await owner.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых');insert into app.tariffs(id,action,name,price,duration_days) values('listing-publication','listing_publication','Объявление',199,30)");
  const city=(await owner.query('select id from app.cities')).rows[0].id,category=(await owner.query('select id from app.categories')).rows[0].id;
  async function person(role='user'){
   const id=randomUUID(),token=randomBytes(32).toString('hex'),phone='+7999'+randomInt(1000000,9999999);
   await owner.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@deletion.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
   await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,{name:'Тестовый пользователь',phone,city:'Краснодар'}]);
   await owner.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[id,phone,'synthetic-deletion-'+id]);
   await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version) values($1,$2,'app',0)",[load('identity').hashSessionToken(token),id]);
   const request=await new(load('postgres-account-deletion').PostgresAccountDeletionStore)(db).request(token,id);return{id,token,phone,request:request.request};
  }
  const plan=actor=>db.readTransaction(tx=>inspectAccountDeletionCase(tx,actor.request.id,actor.request.revision),{timeoutMs:5000});
  async function purchase(actor){
   const id=(await owner.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone) values($1,'sell',$2,$3,'Синтетическая публикация','Синтетическое описание для проверки удаления.',$4) returning id",[actor.id,category,city,actor.phone])).rows[0].id;
   const merchant={shopId:'local-fixture-shop',isTest:true},store=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(db,{...merchant,siteOrigin:'https://xn----9sbphbgks4a4a.xn--p1ai',receiptVatCode:1},{postmoderation:true,renewals:true});
   const quote=await store.preview(actor.token,actor.id,id,'1'),order=await store.prepare(actor.token,actor.id,{listingId:id,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays});
   return{id,order,store,merchant};
  }
  await suite.test('case binding, exact revision, blocked rights request and strict read-only context',async()=>{
   const actor=await person(),other=await person(),result=await plan(actor);assert.equal(result.subject.id,actor.id);assert.equal(result.decision,'no-operational-blocker');assert.equal(result.executionAuthorized,false);assert.equal(result.counts.caseAudit,'1');
   assert.equal((await plan(other)).subject.id,other.id);
   await assert.rejects(db.readTransaction(tx=>inspectAccountDeletionCase(tx,actor.request.id,'2'),{timeoutMs:5000}),{name:'DeletionPreflightCaseError'});
   await assert.rejects(db.transaction(tx=>inspectAccountDeletionCase(tx,actor.request.id,'1')),{name:'DeletionPreflightUnavailableError'});
   await owner.query('update app.users set is_blocked=true where id=$1',[actor.id]);assert.equal((await plan(actor)).subject.blocked,true);
  });
  await suite.test('created, pending and succeeded without fulfillment remain manual; failed keeps only history review',async()=>{
   for(const status of ['created','pending','succeeded','failed']){
    const actor=await person(),p=await purchase(actor);if(status!=='created')await owner.query('update app.payment_orders set status=$2 where id=$1',[p.order.id,status]);
    const result=await plan(actor);assert.equal(result.counts.payments,'1');assert.equal(result.counts.openPayments,status==='failed'?'0':'1');assert.equal(result.decision,status==='failed'?'storage-policy-review':'manual-review');
    assert.equal((await plan(await person())).counts.payments,'0');
   }
  });
  await suite.test('a verified data subject exports only their stored records without changing their session',async()=>{
   const actor=await person(),other=await person(),own=await purchase(actor),foreign=await purchase(other);
   const token=randomBytes(32).toString('hex'),hash=load('identity').hashSessionToken(token);
   await owner.query("insert into app.sessions(token_hash,user_id,scope,auth_version) values($1,$2,'data-subject',0)",[hash,actor.id]);
   const read=()=>readAccountExport(db,token,actor.id);
   const seen=async()=>(await owner.query('select last_seen_at::text value from app.sessions where token_hash=$1',[hash])).rows[0].value;
   const before=await seen();
   const result=await read();
   assert.equal(result.account.id,actor.id);
   assert.equal(result.account.email,actor.id+'@deletion.invalid');
   assert.equal(result.profile.name,'Тестовый пользователь');
   assert.deepEqual(result.listings.map(row=>row.id),[own.id]);
   assert.deepEqual(result.payments.map(row=>row.id),[own.order.id]);
   assert.equal(result.payments[0].amount,'199.00');
   assert.deepEqual(result.deletionRequests.map(row=>row.id),[actor.request.id]);
   const serialized=JSON.stringify(result);
   for(const privateValue of [hash,token,other.id,foreign.id,foreign.order.id,'scrypt','request_body','merchant_shop_id'])
    assert.equal(serialized.includes(privateValue),false);
   await assert.rejects(readAccountExport(db,other.token,actor.id),{name:'DeletionAccessError'});
   await owner.query('update app.users set is_blocked=true where id=$1',[actor.id]);
   assert.equal((await read()).account.isBlocked,true);
   assert.equal(await seen(),before);
   await owner.query('update app.users set auth_version=auth_version+1 where id=$1',[actor.id]);
   await assert.rejects(read(),{name:'DeletionAccessError'});
  });
  await suite.test('completed publication stays in retention review without an unfinished payment',async()=>{
   const actor=await person(),p=await purchase(actor),binding=await p.store.authorizeDispatch(actor.token,actor.id,p.order.id),provider=randomUUID();
   const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);await intents.authorize(binding);await intents.bindProvider(binding,provider);
   await owner.query("update app.payment_orders set status='succeeded' where id=$1",[p.order.id]);
   await owner.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[p.order.id,provider]);
   await new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,p.merchant,{postmoderation:true,renewals:true}).fulfill(p.order.id);
   const result=await plan(actor);assert.equal(result.counts.openPayments,'0');assert.equal(result.decision,'storage-policy-review');
   const before=(await owner.query('select request_body from app.payment_checkout_intents where id=$1',[p.order.id])).rows[0];await plan(actor);assert.deepEqual((await owner.query('select request_body from app.payment_checkout_intents where id=$1',[p.order.id])).rows[0],before);
  });
  await suite.test('pending media and unknown mail are operational blockers and admin accounts require manual review',async()=>{
   const actor=await person();await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',2,2,12,$3)",[actor.id,randomUUID(),'a'.repeat(64)]);
   await owner.query("insert into app.mail_outbox(id,user_id,purpose,key_id,payload,created_at,expires_at,state) values($1,$2,'confirm',$3,$4,date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())+interval '30 minutes','unknown')",[randomUUID(),actor.id,'a'.repeat(32),Buffer.concat([Buffer.from([1]),Buffer.alloc(29)])]);
   const result=await plan(actor);assert.equal(result.counts.openUploads,'1');assert.equal(result.counts.openMail,'1');assert.equal(result.decision,'manual-review');assert.equal((await plan(await person('admin'))).decision,'manual-review');
  });
  await suite.test('bookings are found for host and guest; cancellation preserves history instead of an open blocker',async()=>{
   const host=await person(),guest=await person();
   const listing=(await owner.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description) values($1,'rent',$2,$3,'Синтетическая аренда','Проверка связанной брони.') returning id",[host.id,category,city])).rows[0].id;
   const booking=await db.transaction(async tx=>{
    await tx.query("select set_config('blizhniy.booking_actor',$1,true)",[guest.id]);
    return(await tx.query("insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot) values($1,$2,$3,'stay',current_date+2,current_date+3,1,100,'{}') returning id",[listing,guest.id,randomUUID()])).rows[0].id;
   });
   for(const actor of [host,guest]){const result=await plan(actor);assert.equal(result.counts.openBookings,'1');assert.equal(result.decision,'manual-review');}
   await db.transaction(async tx=>{await tx.query("select set_config('blizhniy.booking_actor',$1,true)",[guest.id]);await tx.query("update app.booking_requests set status='cancelled',revision=revision+1,cancelled_by=$2,cancellation_reason='Синтетическая отмена' where id=$1",[booking,guest.id]);});
   const result=await plan(guest);assert.equal(result.counts.openBookings,'0');assert.equal(result.counts.bookings,'1');assert.equal(result.decision,'storage-policy-review');
   const guestExport=await readAccountExport(db,guest.token,guest.id),hostExport=await readAccountExport(db,host.token,host.id);
   assert.equal(guestExport.bookings[0].side,'guest');
   assert.equal(guestExport.bookings[0].cancellation_reason,'Синтетическая отмена');
   assert.equal(hostExport.bookings[0].side,'host');
   assert.equal(hostExport.bookings[0].cancellation_reason,null);
  });
  await suite.test('an incoming response purchase belongs to the requester preflight even when another user paid',async()=>{
   const recipient=await person(),payer=await person();
   const work=(await owner.query("insert into app.work_publications(author_id,kind,creation_key,form) values($1,'workRequest',$2,$3) returning id",[recipient.id,randomUUID(),load('work-publication-contract').parseWorkPublicationForm('workRequest',{title:'Синтетический заказ',description:'Синтетическая проверка входящих откликов.'})])).rows[0].id;
   const application=(await owner.query("insert into app.applications(applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,1,1,'{}') returning id",[payer.id,work,randomUUID()])).rows[0].id;
   const id=randomUUID(),body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/'},metadata:{localPaymentId:id,targetId:application,targetType:'application',tariffId:'response-payment'}});
   await db.transaction(async tx=>{
    await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(tx,{id,ownerId:payer.id,targetType:'application',targetId:application,targetRevision:'1',tariffId:'response-payment',amount:'99.00',durationDays:null,shopId:'local-fixture-shop',isTest:true,requestBody:body});
    await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[id,payer.id,randomUUID(),application]);
   });
   for(const actor of [recipient,payer]){const result=await plan(actor);assert.equal(result.counts.applications,'1');assert.equal(result.counts.openPayments,'1');assert.equal(result.decision,'manual-review');}
   assert.equal((await plan(await person())).counts.openPayments,'0');
  });
  await suite.test('a reserved refund is operationally unfinished even after the original payment was fulfilled',async()=>{
   const actor=await person(),p=await purchase(actor),binding=await p.store.authorizeDispatch(actor.token,actor.id,p.order.id),provider=randomUUID();
   const intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db);await intents.authorize(binding);await intents.bindProvider(binding,provider);
   await owner.query("update app.payment_orders set status='succeeded' where id=$1",[p.order.id]);
   await owner.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[p.order.id,provider]);
   await new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,p.merchant,{postmoderation:true,renewals:true}).fulfill(p.order.id);
   await owner.query('insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) values($1,$2,$3,$4,true,$5)',[randomUUID(),p.order.id,provider,p.merchant.shopId,p.order.amount]);
   const result=await plan(actor);assert.equal(result.counts.openPayments,'0');assert.equal(result.counts.openRefunds,'1');assert.equal(result.decision,'manual-review');
   const exported=await readAccountExport(db,actor.token,actor.id);
   assert.equal(exported.refunds.length,1);
   assert.equal(exported.refunds[0].payment_intent_id,p.order.id);
   assert.equal(exported.refunds[0].amount,p.order.amount);
   assert.ok(!JSON.stringify(exported).includes(provider));
  });
  await suite.test('a coherent advisory snapshot does not authorize acting on a case changed concurrently',async()=>{
   const actor=await person(),moderator=await person('admin'),store=new(load('postgres-account-deletion').PostgresAccountDeletionStore)(db);let changed=false;
   const result=await db.readTransaction(tx=>inspectAccountDeletionCase({query:async(sql,values)=>{
    const rows=await tx.query(sql,values);
    if(!changed&&sql.includes('from app.account_deletion_requests r join app.users')){changed=true;await store.begin(moderator.token,moderator.id,actor.request.id,'1');}
    return rows;
   }},actor.request.id,'1'),{timeoutMs:5000});
   assert.equal(result.requestRevision,'1');assert.equal(result.executionAuthorized,false);
   await assert.rejects(plan(actor),{name:'DeletionPreflightCaseError'});
   const latest=await db.readTransaction(tx=>inspectAccountDeletionCase(tx,actor.request.id,'2'),{timeoutMs:5000});assert.equal(latest.requestRevision,'2');
   await store.resolve(moderator.token,moderator.id,actor.request.id,'2',{resolution:'declined',caseReference:'SYNTHETIC_CASE_0001',confirmedManualDecision:true});
   await assert.rejects(db.readTransaction(tx=>inspectAccountDeletionCase(tx,actor.request.id,'3'),{timeoutMs:5000}),{name:'DeletionPreflightCaseError'});
  });
 }finally{
  await db?.close();await owner?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Config.Labels[label],name);await docker(['rm','--force',container]);}
  for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
