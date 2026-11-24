// Disposable loopback PostgreSQL and synthetic captures only; never reads .env.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {checkSpecialistAccountCheckout} from './specialist-account-checkout-cases.mjs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {getPaymentReconciliationRolePlan} from '../scripts/payment-reconciliation-role.mjs';
import {createRequire} from 'node:module';
import pg from 'pg';
import {getPublicationTestMigrationPlan} from '../scripts/publication-test-release-plan.mjs';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,run=promisify(execFile);
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
for(const full of [false,true])test('specialist synthetic checkout on '+(full?'full local58':'production36')+' schema',{timeout:90000},async suite=>{
 const name='blizhniy-specialist-'+randomBytes(6).toString('hex'),password=randomBytes(32).toString('hex');let container,admin,web,worker,ownerDb;
 const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',POSTGRES_PASSWORD:password}})).stdout.trim();
 const keys=['NODE_ENV','BLIZHNIY_SPECIALIST_CHECKOUT','BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN','BLIZHNIY_LISTING_WORKFLOW'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{NODE_ENV:'test',BLIZHNIY_SPECIALIST_CHECKOUT:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'});
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.specialist-fixture='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0],binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const until=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<until);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({...config,max:4});
  if(full){for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d{4}-[a-z-]+\.sql$/.test(n)&&n<'0058').sort())await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
   await admin.query(await readFile(new URL('../database/candidates/0058-media-reference-journal.sql',import.meta.url),'utf8'));
  }else for(const {sql} of getPublicationTestMigrationPlan())await admin.query(sql);
  await suite.test('specialist history can read a database that has never installed specialist checkout',async()=>{
   const {readPlacementOrder}=load('postgres-listing-checkout');
   assert.equal((await admin.query("select to_regclass('app.specialist_checkout_terms') as terms")).rows[0].terms,null);
   assert.equal(await readPlacementOrder(admin,randomUUID(),randomUUID(),'specialist',{includeTestFlag:true}),null);
  });
  await admin.query(await readFile(new URL('../database/candidates/0060-local-specialist-checkout.sql',import.meta.url),'utf8'));
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.specialist_categories(slug,name,parent_name) values('plumber','Сантехник','Строительство');insert into app.tariffs(id,action,name,price,duration_days) values('specialist-publication','specialist_publication','Анкета',299,30)");
  await admin.query(`create role specialist_web login password '${password}';create role specialist_worker login password '${password}';grant usage on schema app to specialist_web,specialist_worker;grant select on all tables in schema app to specialist_web,specialist_worker;
   grant update(id) on app.users,app.cities,app.specialist_categories,app.service_publications,app.service_moderation,app.payment_checkout_intents,app.payment_orders to specialist_web,specialist_worker;
   grant update(last_seen_at) on app.sessions to specialist_web;grant update(token_hash) on app.sessions to specialist_web;
   grant update(user_id) on app.cabinet_profiles to specialist_web,specialist_worker;
   grant update(form,city_id,profession_id,revision,updated_at) on app.service_publications to specialist_web;
   grant insert(author_id,kind,creation_key,form,city_id,profession_id) on app.service_publications to specialist_web;
   grant insert(publication_id,media_id,position),delete on app.service_publication_photos to specialist_web;
   grant insert(id,owner_id,creation_key,target_type,target_id,target_revision) on app.payment_orders to specialist_web;
   grant insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body) on app.payment_checkout_intents to specialist_web;
   grant insert(intent_id) on app.specialist_checkout_terms,app.payment_dispatch_anchors to specialist_web;
   grant insert(intent_id,provider_payment_id) on app.payment_provider_links to specialist_web;
   grant insert(intent_id) on app.payment_fulfillments to specialist_worker;
   grant execute on function app.phone_is_confirmed(uuid) to specialist_web,specialist_worker;`);
  await admin.query('revoke update(id) on app.cities,app.specialist_categories from specialist_web');
  const DB=load('postgres').PostgresDatabase;web=new DB(new pg.Pool({...config,user:'specialist_web',max:4}));worker=new DB(new pg.Pool({...config,user:'specialist_worker',max:4}));ownerDb=new DB(new pg.Pool({...config,max:4}));
  const profession=(await admin.query('select id from app.specialist_categories')).rows[0].id;
  async function draft(){
   const owner=randomUUID(),token=randomBytes(32).toString('hex'),phone='+7999'+String(randomInt(10000000)).padStart(7,'0');
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,owner+'@specialist.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:'Тестовый специалист',phone}]);
   await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner,phone,'test-'+owner]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),owner]);
   const forms=new(load('postgres-service-publications').PostgresServicePublicationStore)(web,{specialistProfileIdentity:true});
   const row=await forms.create(token,owner,'specialist',randomUUID(),{title:'Имя из профиля',description:'Выполняю монтаж и ремонт сантехники.',cityName:'Краснодар',professionName:'Сантехник',professionId:profession,price:'1500',contactPhone:phone,placementRightConfirmed:true});
   await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_by,decided_at) values($1,$2,'approved',$3,clock_timestamp())",[row.id,row.revision,owner]);
   return{owner,token,id:row.id,revision:row.revision,forms};
  }
  const merchant={shopId:'local-fixture-shop',isTest:true},Store=load('postgres-listing-checkout').PostgresListingCheckoutStore;
  const store=new Store(web,{...merchant,siteOrigin:'https://xn----9sbphbgks4a4a.xn--p1ai',receiptVatCode:1},{postmoderation:true,targetType:'specialist'});
  const fulfillment=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(worker,merchant,{postmoderation:true,targetType:'specialist'});
  async function prepare(d){const q=await store.preview(d.token,d.owner,d.id,d.revision),input={listingId:d.id,expectedRevision:d.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays};return{input,order:await store.prepare(d.token,d.owner,input)};}
  async function capture(d,order){const b=await store.authorizeDispatch(d.token,d.owner,order.id),intents=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(web),providerId=randomUUID();await intents.authorize(b);await intents.bindProvider(b,providerId);
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[order.id,providerId]);}
  await suite.test('owner preparation, lost reply readback, concurrency and one public paid period',async()=>{
   const d=await draft(),other=await draft(),{input,order}=await prepare(d);
   assert.deepEqual(await store.prepare(d.token,d.owner,input),order);assert.equal((await store.readIntent(d.token,d.owner,input.creationKey)).id,order.id);
   assert.equal(await store.readOrder(other.token,other.owner,order.id),null);await assert.rejects(store.preview(other.token,other.owner,d.id,d.revision));
   await assert.rejects(d.forms.update(d.token,d.owner,'specialist',d.id,d.revision,{description:'Изменено во время оплаты.'}));
   await assert.rejects(web.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]),{code:'42501'});
   await assert.rejects(web.query('insert into app.payment_fulfillments(intent_id) values($1)',[order.id]),{code:'42501'});
   await assert.rejects(worker.query('insert into app.payment_fulfillments(intent_id) values($1)',[order.id]));
   await capture(d,order);
   await assert.rejects(admin.query("insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,clock_timestamp(),clock_timestamp()+interval '90 days')",[order.id]),{code:'PSP03'});
   const results=await Promise.all([fulfillment.fulfill(order.id),fulfillment.fulfill(order.id)]);assert.equal(results[0].state,'fulfilled');assert.deepEqual(results[1],results[0]);
   const snapshot=await store.readOrder(d.token,d.owner,order.id);assert.ok(snapshot.fulfillment);assert.equal(Date.parse(snapshot.fulfillment.expiresAt)-Date.parse(snapshot.fulfillment.publishedAt),30*86400000);
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,1);
   const catalogue=new(load('postgres-public-service').PostgresPublicServiceStore)(web,{specialistProfileIdentity:true});const published=await catalogue.read('specialist',d.id);assert.ok(published);assert.equal(JSON.stringify(published).includes('@specialist.invalid'),false);
   await assert.rejects(web.query("update app.service_publications set form=jsonb_set(form,'{description}',to_jsonb('Unreviewed raw SQL material edit'::text)) where id=$1",[d.id]),{code:'PSP02'});
   assert.deepEqual(await catalogue.read('specialist',d.id),published);
   await assert.rejects(prepare(d));
   const before=await d.forms.read(d.token,d.owner,'specialist',d.id),edited=await d.forms.update(d.token,d.owner,'specialist',d.id,before.revision,{...before.form,description:'Новое описание после размещения анкеты.'});
   assert.equal(await catalogue.read('specialist',d.id),undefined,'changed revision is private until approved');
   assert.deepEqual((await fulfillment.fulfill(order.id)).period,snapshot.fulfillment,'replay never renews or republishes edited revision');
   await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_by,decided_at) values($1,$2,'approved',$3,clock_timestamp())",[d.id,edited.revision,other.owner]);assert.ok(await catalogue.read('specialist',d.id));
   assert.deepEqual((await store.readOrder(d.token,d.owner,order.id)).fulfillment,snapshot.fulfillment);
  });
  await suite.test('ordinary account payment history reads bookmarked specialist orders with checkout disabled',async()=>{
   const owner=await draft(),peer=await draft(),{order}=await prepare(owner);
   const history=new(load('postgres-payment-history').PostgresPaymentHistoryStore)(web);
   const origin='https://example.invalid';
   const handle=load('payment-history-http').createPaymentHistoryHandler({origin},()=>({store:history,limiter:{allowProduction:async()=>true}}),()=>{});
   function read(actor,id=order.id,expectedOwnerId=actor.owner){
    return handle(new Request(origin+'/api/account/payments',{method:'POST',headers:{host:'example.invalid',origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+actor.token},
     body:JSON.stringify({action:'specialistOrder',expectedOwnerId,paymentId:id})}));
   }
   async function snapshot(){
    const response=await read(owner);
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    return load('client-listing-payment').parseListingPaymentSnapshot(await response.json(),order.id);
   }
   async function withPurchasesOff(work){
    const checkout=process.env.BLIZHNIY_SPECIALIST_CHECKOUT,workflow=process.env.BLIZHNIY_LISTING_WORKFLOW;
    delete process.env.BLIZHNIY_SPECIALIST_CHECKOUT;delete process.env.BLIZHNIY_LISTING_WORKFLOW;
    try{await work();}finally{process.env.BLIZHNIY_SPECIALIST_CHECKOUT=checkout;process.env.BLIZHNIY_LISTING_WORKFLOW=workflow;}
   }
   await withPurchasesOff(async()=>{
    const pending=await snapshot();assert.deepEqual(pending.order,order);assert.equal(pending.fulfillment,null);assert.equal(pending.testPublication,true);
    const foreign=await read(peer),missing=await read(owner,randomUUID());
    assert.equal(foreign.status,200);assert.equal(missing.status,200);assert.deepEqual(await foreign.json(),null);assert.deepEqual(await missing.json(),null);
    assert.equal((await read(peer,order.id,owner.owner)).status,401);assert.equal((await read({...owner,token:''})).status,401);
   });
   await capture(owner,order);const result=await fulfillment.fulfill(order.id);
   await withPurchasesOff(async()=>{
    const paid=await snapshot();assert.equal(paid.order.status,'succeeded');assert.equal(paid.testOnly,true);
    assert.deepEqual(paid.fulfillment,result.period);assert.deepEqual(await snapshot(),paid);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,1);
   });
  });
  await suite.test('active specialist orders return a typed edit conflict while failed orders release the form',async()=>{
   for(const status of ['created','pending','succeeded','failed']){
    const d=await draft(),{order}=await prepare(d),before=await d.forms.read(d.token,d.owner,'specialist',d.id);
    if(status!=='created')await admin.query('update app.payment_orders set status=$2 where id=$1',[order.id,status]);
    const form={...before.form,description:'Изменённое описание для проверки активной оплаты.'};
    if(status==='failed')assert.equal((await d.forms.update(d.token,d.owner,'specialist',d.id,before.revision,form)).form.description,form.description);
    else{
     await assert.rejects(d.forms.update(d.token,d.owner,'specialist',d.id,before.revision,form),{name:'ServicePublicationCheckoutActiveError'});
     assert.deepEqual(await d.forms.read(d.token,d.owner,'specialist',d.id),before);
    }
   }
  });
  await suite.test('lost simulator response recovers one provider identity after reference change; disabled mode retains read-only history',async()=>{
   const {localPrimaryPaymentHandler}=await import('../scripts/local-primary-payment.mjs'),d=await draft(),{order}=await prepare(d);let lose=true,postTransactions=0;
   const providerOwner={query:(...args)=>ownerDb.query(...args),transaction:async work=>{
    let providerPost=false;const result=await ownerDb.transaction(tx=>work({query:async(...args)=>{if(args[0].startsWith('select * from local_primary.provider_payments where intent_id'))providerPost=true;return tx.query(...args);}}));
    if(providerPost){postTransactions++;if(lose)throw Error('Synthetic lost provider response after COMMIT');}return result;
   }};
   const context={ownerDb:providerOwner,runtimeDb:web,state:{origin:'https://127.0.0.1:3045',rateSecret:'s'.repeat(64)},load:name=>name==='auth-http'?{...load(name),AuthRateLimiter:class{async allowProduction(){return true;}}}:load(name)};
   const endpoint='https://xn----9sbphbgks4a4a.xn--p1ai',headers={host:new URL(endpoint).host,origin:endpoint,'x-real-ip':'192.0.2.4','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+d.token};
   const request=action=>new Request(endpoint+'/api/account/specialist-checkout',{method:'POST',headers,body:JSON.stringify({expectedOwnerId:d.owner,action,paymentId:order.id})});
   assert.equal((await localPrimaryPaymentHandler(request('dispatch'),context)).status,503);assert.ok(postTransactions>0);
   assert.equal((await admin.query('select count(*)::int n from app.payment_provider_links where intent_id=$1',[order.id])).rows[0].n,0);
   assert.equal((await admin.query('select count(*)::int n from local_primary.provider_payments where intent_id=$1',[order.id])).rows[0].n,1);
   lose=false;await admin.query('update app.specialist_categories set active=false where id=$1',[profession]);const before=postTransactions;
   const recovered=await localPrimaryPaymentHandler(request('dispatch'),context);assert.equal(recovered.status,200);assert.equal(postTransactions,before);
   assert.equal((await admin.query('select count(*)::int n from app.payment_provider_links where intent_id=$1',[order.id])).rows[0].n,1);
   await admin.query('update app.specialist_categories set active=true where id=$1',[profession]);
   const completed=await localPrimaryPaymentHandler(new Request(endpoint+'/__local/payment?intent='+order.id+'&type=specialist',{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'},body:'action=succeed'}),context);
   assert.equal(completed.status,200);assert.match(await completed.text(),/размещение выполнено/);assert.equal(postTransactions,before);
   const snapshot=await store.readOrder(d.token,d.owner,order.id);assert.ok(snapshot.fulfillment);assert.equal(snapshot.testPublication,true);
   process.env.BLIZHNIY_SPECIALIST_CHECKOUT='disabled';
   try{assert.equal((await localPrimaryPaymentHandler(request('order'),context)).status,200);assert.equal((await localPrimaryPaymentHandler(request('dispatch'),context)).status,503);assert.deepEqual(await store.readOrder(d.token,d.owner,order.id),snapshot);await assert.rejects(store.preview(d.token,d.owner,d.id,d.revision));await assert.rejects(fulfillment.fulfill(order.id));
    const oversized=new Request(endpoint+'/api/account/specialist-checkout',{method:'POST',headers:{...headers,'content-length':'999999'},body:'invalid-json'});assert.equal((await localPrimaryPaymentHandler(oversized,context)).status,413);
   }
   finally{process.env.BLIZHNIY_SPECIALIST_CHECKOUT='local-v1';}
  });
  await suite.test('read-only web references retain the privileged first-POST fence and committed idempotency recovery',async()=>{
   const {localPrimaryPaymentHandler}=await import('../scripts/local-primary-payment.mjs');
   for(const mode of ['changed-before-post','committed-before-user-lock']){
    const d=await draft(),{order}=await prepare(d);let interleaved=false;
    const providerOwner={query:(...args)=>ownerDb.query(...args),transaction:async work=>{
     if(mode==='changed-before-post'&&!interleaved){interleaved=true;await admin.query('update app.specialist_categories set active=false where id=$1',[profession]);}
     return ownerDb.transaction(tx=>work({query:async(sql,values)=>{
      if(mode==='committed-before-user-lock'&&!interleaved&&sql==='select id from app.users where id=$1 for update'){
       interleaved=true;await admin.query("insert into local_primary.provider_payments(intent_id,provider_id,status) values($1,$2,'pending')",[order.id,randomUUID()]);
       await admin.query('update app.specialist_categories set active=false where id=$1',[profession]);
      }
      return tx.query(sql,values);
     }}));
    }};
    const context={ownerDb:providerOwner,runtimeDb:web,state:{origin:'https://127.0.0.1:3045',rateSecret:'s'.repeat(64)},load:name=>name==='auth-http'?{...load(name),AuthRateLimiter:class{async allowProduction(){return true;}}}:load(name)};
    const origin='https://xn----9sbphbgks4a4a.xn--p1ai',request=()=>new Request(origin+'/api/account/specialist-checkout',{method:'POST',headers:{host:new URL(origin).host,origin,'x-real-ip':'192.0.2.4','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+d.token},body:JSON.stringify({expectedOwnerId:d.owner,action:'dispatch',paymentId:order.id})});
    try{
     const response=await localPrimaryPaymentHandler(request(),context);assert.equal(interleaved,true);
     const committed=mode==='committed-before-user-lock';assert.equal(response.status,committed?200:409);
     if(!committed)assert.equal((await response.json()).error.code,'CHECKOUT_NOT_READY');
     assert.equal((await admin.query('select count(*)::int n from local_primary.provider_payments where intent_id=$1',[order.id])).rows[0].n,committed?1:0);
     assert.equal((await admin.query('select count(*)::int n from app.payment_provider_links where intent_id=$1',[order.id])).rows[0].n,committed?1:0);
    }finally{await admin.query('update app.specialist_categories set active=true where id=$1',[profession]);}
   }
  });
  await suite.test('stale photo snapshots and cached fulfillment cannot mutate after preparation or disabling',async()=>{
   const d=await draft(),media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',40,20,12,$3) returning id",[d.owner,randomUUID(),'a'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
   const rr=await admin.connect();let order;
   try{await rr.query('begin isolation level repeatable read');await rr.query('select id from app.service_publications where id=$1',[d.id]);order=(await prepare(d)).order;
    await assert.rejects(rr.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[d.id,media]),{code:'PSP02'});
   }finally{await rr.query('rollback');rr.release();}
   await assert.rejects(web.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[d.id,media]),{code:'PSP02'});
   await capture(d,order);process.env.BLIZHNIY_SPECIALIST_CHECKOUT='disabled';
   try{await assert.rejects(fulfillment.fulfill(order.id));assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,0);}
   finally{process.env.BLIZHNIY_SPECIALIST_CHECKOUT='local-v1';}
   assert.equal((await fulfillment.fulfill(order.id)).state,'fulfilled');
  });
  await suite.test('unmarked historical specialist captures and direct paid inserts cannot adopt the new publication path',async()=>{
   const template=await draft(),{order}=await prepare(template),binding=await store.authorizeDispatch(template.token,template.owner,order.id),target=await draft(),id=randomUUID();
   const body=JSON.parse((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body);
   body.metadata.localPaymentId=id;body.metadata.targetId=target.id;body.receipt.customer.email=target.owner+'@specialist.invalid';
   await ownerDb.transaction(async tx=>{await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'specialist',$4,$5)",[id,target.owner,randomUUID(),target.id,target.revision]);
    await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(ownerDb).persistInTransaction(tx,{...binding,id,ownerId:target.owner,targetId:target.id,targetRevision:target.revision,requestBody:JSON.stringify(body)});});
   const provider=randomUUID();await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await admin.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,provider]);
   await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'))",[id,provider]);
   await assert.rejects(fulfillment.fulfill(id),{code:'PSP03'});assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[id])).rows[0].n,0);
   await assert.rejects(admin.query("insert into app.service_publications(author_id,kind,creation_key,form,city_id,profession_id,status,is_paid,published_at,expires_at) select author_id,kind,$2,form,city_id,profession_id,'published',true,clock_timestamp(),clock_timestamp()+interval '30 days' from app.service_publications where id=$1",[target.id,randomUUID()]),{code:'PSP03'});
  });
  await suite.test('inactive references, missing phone and changed tariff cannot create or fulfill an order',async()=>{
   const d=await draft();await admin.query('update app.specialist_categories set active=false where id=$1',[profession]);await assert.rejects(prepare(d));await admin.query('update app.specialist_categories set active=true where id=$1',[profession]);
   const {order}=await prepare(d);await capture(d,order);await admin.query('delete from app.telegram_phone_bindings where user_id=$1',[d.owner]);assert.equal((await fulfillment.fulfill(order.id)).state,'blocked');
   assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[order.id])).rows[0].n,0);
   await assert.rejects(admin.query("update app.service_publications set status='published',is_paid=true,published_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 days' where id=$1",[d.id]));
   const next=await draft(),q=await store.preview(next.token,next.owner,next.id,next.revision);await admin.query("update app.tariffs set price=399 where id='specialist-publication'");
   await assert.rejects(store.prepare(next.token,next.owner,{listingId:next.id,expectedRevision:next.revision,creationKey:randomUUID(),expectedTariffId:q.tariff.id,expectedAmount:q.tariff.amount,expectedDurationDays:q.tariff.durationDays}));
  });
  await suite.test('synthetic-only admission refuses live merchants, renewal and old publication metadata',()=>{
   for(const [config,policy] of [[{...merchant,isTest:false},{}],[{...merchant,shopId:'real-shop'},{}],[merchant,{renewals:true}],[merchant,{publicationTestOwner:randomUUID()}]])assert.throws(()=>new Store(web,{...config,siteOrigin:'https://example.invalid',receiptVatCode:1},{postmoderation:true,targetType:'specialist',...policy}));
  });
  await suite.test('hosted specialist TEST admission stays bound to a new owner order and survives closing the enrollment',async admission=>{
   const owner=await draft(),peer=await draft(),shopId='900000001',mode='specialist-account-test-v1';
   const hash=load('identity').hashSessionToken,amount=(await admin.query("select price::text as amount from app.tariffs where id='specialist-publication'")).rows[0].amount;
   const make=(actor,overrides={})=>{
    const b={id:randomUUID(),ownerId:actor.owner,targetType:'specialist',targetId:actor.id,targetRevision:actor.revision,tariffId:'specialist-publication',amount,durationDays:30,shopId,isTest:true,...overrides};
    const money={value:amount,currency:'RUB'};
    return {binding:b,body:{amount:money,capture:true,confirmation:{type:'redirect',return_url:'https://xn----9sbphbgks4a4a.xn--p1ai/oplata/'+b.id+'?type=specialist'},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId,publicationMode:mode},
     receipt:{customer:{email:actor.owner+'@specialist.invalid'},internet:true,items:[{amount:money,description:'Размещение анкеты специалиста',payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:1}]}}};
   };
   async function insert(tx,actor,{binding:b,body},terms=true){
    await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6)',[b.id,b.ownerId,randomUUID(),b.targetType,b.targetId,b.targetRevision]);
    await tx.query('insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[b.id,b.ownerId,b.targetType,b.targetId,b.targetRevision,b.tariffId,b.amount,b.durationDays,b.shopId,b.isTest,JSON.stringify(body)]);
    if(terms)await addTerms(tx,actor,b.id);
   }
   async function addTerms(tx,actor,id){
    await tx.query("select set_config('blizhniy.specialist_checkout_session',$1,true)",[hash(actor.token)]);
    await tx.query('insert into app.specialist_checkout_terms(intent_id) values($1)',[id]);
   }
   const historical=await draft(),old=make(historical);
   await web.transaction(tx=>insert(tx,historical,old,false));
   const legacy=await draft(),unmarkedLegacy=make(legacy);delete unmarkedLegacy.body.metadata.publicationMode;
   await web.transaction(tx=>insert(tx,legacy,unmarkedLegacy,false));
   const oldProvider=randomUUID();
   await web.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[old.binding.id]);
   await web.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[old.binding.id,oldProvider]);
   const sql=await readFile(new URL('../database/candidates/0065-specialist-account-test.sql',import.meta.url),'utf8');
   await admin.query(sql);
   assert.equal((await web.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[unmarkedLegacy.binding.id])).rowCount,1);
   await assert.rejects(worker.query('insert into app.payment_fulfillments(intent_id) values($1)',[unmarkedLegacy.binding.id]),{code:'PSP03'});
   const enroll=d=>admin.query('insert into app.specialist_test_enrollment(owner_id,shop_id) values($1,$2)',[d.owner,shopId]);
   const remove=()=>admin.query('delete from app.specialist_test_enrollment');
   for(const db of [web,worker])await assert.rejects(db.query('select owner_id from app.specialist_test_enrollment'),{code:'42501'});
   await assert.rejects(web.query('insert into app.specialist_test_enrollment(owner_id,shop_id) values($1,$2)',[owner.owner,shopId]),{code:'42501'});
   await assert.rejects(web.transaction(tx=>insert(tx,owner,make(owner))),{code:'PSP01'});
   await enroll(historical);await assert.rejects(web.transaction(tx=>addTerms(tx,historical,old.binding.id)),{code:'PSP01'});await remove();
   await enroll(owner);await assert.rejects(enroll(peer),{code:'23505'});
   const noTerms=make(owner);await assert.rejects(web.transaction(tx=>insert(tx,owner,noTerms,false)),{code:'PSP01'});
   assert.equal((await admin.query('select id from app.payment_orders where id=$1',[noTerms.binding.id])).rowCount,0);
   const unmarked=make(owner);delete unmarked.body.metadata.publicationMode;
   const noReceipt=make(owner);delete noReceipt.body.receipt;
   const wrongMarker=make(owner);wrongMarker.body.metadata.publicationMode='account-test-v1';
   for(const [actor,intent] of [[peer,make(peer)],[owner,make(owner,{shopId:'900000002'})],[owner,make(owner,{isTest:false})],[owner,unmarked],[owner,noReceipt],[owner,wrongMarker]]){
    await assert.rejects(web.transaction(tx=>insert(tx,actor,intent)),{code:'PSP01'});
   }
   const holding=await admin.connect();let closing;
   try{
    await holding.query('begin');await holding.query('delete from app.specialist_test_enrollment');
    let identify;const identified=new Promise(resolve=>{identify=resolve;});
    closing=web.transaction(async tx=>{
     identify((await tx.query('select pg_backend_pid() pid')).rows[0].pid);
     await insert(tx,owner,make(owner));
    }).then(()=>null,error=>error.code);
    const writer=await identified,end=Date.now()+4000;
    while(!(await holding.query('select pg_backend_pid()=any(pg_blocking_pids($1)) waiting',[writer])).rows[0].waiting){
     assert.ok(Date.now()<end,'admission must wait for closing enrollment');
     await new Promise(resolve=>setTimeout(resolve,20));
    }
    await holding.query('commit');assert.equal(await closing,'PSP01');
   }finally{await holding.query('rollback');holding.release();if(closing)await closing;}
   // Advance wall time while a legitimate purchase waits on the enrollment row.
   const expiring=await draft();await enroll(expiring);
   const pin=await admin.connect();let finishing;
   try{
    await pin.query('begin');await pin.query('select owner_id from app.specialist_test_enrollment for update');
    // The initial session lookup must pass before the absolute expiry.
    await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '1500 milliseconds' where token_hash=$1",[hash(expiring.token)]);
    let identify;const identified=new Promise(resolve=>{identify=resolve;});
    finishing=web.transaction(async tx=>{
     identify((await tx.query('select pg_backend_pid() pid')).rows[0].pid);await insert(tx,expiring,make(expiring));
    }).then(()=>null,error=>error.code);
    const pid=await identified,end=Date.now()+4000;
    while(!(await pin.query('select pg_backend_pid()=any(pg_blocking_pids($1)) as waiting',[pid])).rows[0].waiting){
     assert.ok(Date.now()<end,'authorized checkout must reach the enrollment row');await new Promise(resolve=>setTimeout(resolve,20));
    }
    await pin.query("select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp())::float8)+0.03) from app.sessions where token_hash=$1",[hash(expiring.token)]);
    await pin.query('commit');assert.equal(await finishing,'PSP01');
    assert.equal((await admin.query('select id from app.payment_orders where owner_id=$1',[expiring.owner])).rowCount,0);
   }finally{await pin.query('rollback');pin.release();if(finishing)await finishing;}
   await remove();
   await enroll(peer);
   const preparedBeforeClosure=make(peer);await web.transaction(tx=>insert(tx,peer,preparedBeforeClosure));await remove();
   const frozen=new(load('postgres-payment-intents').PostgresPaymentIntentStore)(web);
   await assert.rejects(frozen.authorize(preparedBeforeClosure.binding),{code:'PSP01'});
   assert.equal((await admin.query('select intent_id from app.payment_dispatch_anchors where intent_id=$1',[preparedBeforeClosure.binding.id])).rowCount,0);
   await admission.test('account checkout route prepares, reopens and dispatches only the approved specialist order',async()=>{
    await checkSpecialistAccountCheckout({load,db:web,admin,owner:await draft(),peer,enroll,remove});
   });
   await enroll(owner);
   const purchase=make(owner),binding=purchase.binding;
   const parsed=load('postgres-payment-intents').parsePaymentIntent;
   for(const invalid of [noReceipt,wrongMarker,make(owner,{isTest:false}),make(owner,{shopId:'local-fixture-shop'}),make(owner,{tariffId:'listing-publication'})])
    assert.throws(()=>parsed({...invalid.binding,requestBody:JSON.stringify(invalid.body)}));
   assert.deepEqual(parsed({...binding,requestBody:JSON.stringify(purchase.body)}).id,binding.id);
   await web.transaction(tx=>insert(tx,owner,purchase));
   await assert.rejects(worker.query('insert into app.payment_fulfillments(intent_id) values($1)',[binding.id]),{code:'PSP03'});
   const providerId=randomUUID(),merchant={shopId,isTest:true,secretKey:'test_synthetic_only'};
   let posts=0,gets=0,paid=false,capturedAt;const accepted=new Map();
   const fetcher=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://api.yookassa.ru');
    if(init.method==='POST'){
     assert.equal(init.headers['Idempotence-Key'],binding.id);assert.deepEqual(JSON.parse(init.body),purchase.body);posts++;
     if(!accepted.has(binding.id)){
      accepted.set(binding.id,init.body);await remove();throw new TypeError('Lost synthetic response');
     }
     assert.equal(accepted.get(binding.id),init.body);
    }else{assert.equal(init.method,'GET');assert.equal(new URL(url).pathname,'/v3/payments/'+providerId);gets++;}
    return Response.json({id:providerId,status:paid?'succeeded':'pending',paid,test:true,recipient:{account_id:shopId},amount:purchase.body.amount,metadata:purchase.body.metadata,
     ...(paid?{captured_at:capturedAt}:{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}})});
   };
   const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(web,merchant,fetcher);
   assert.equal((await dispatcher.dispatch(binding)).providerPaymentId,providerId);
   await remove();
   await admission.test('compiled scoped worker discovers an admitted payment after closure and resumes a pending job from backup',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'blizhniy-specialist-queue-')),artifact=join(directory,'worker');
    let copy,bounded,resumed,inspector;
    const envKeys=['BLIZHNIY_LOCAL_PRIMARY','BLIZHNIY_LOCAL_PRIMARY_ORIGIN','BLIZHNIY_SPECIALIST_CHECKOUT','BLIZHNIY_AUTH_MODE','BLIZHNIY_AUTH_ORIGIN'];
    const original=envKeys.map(key=>process.env[key]);
    try{
     buildPaymentWorker(artifact,{publicationTest:true});
     await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(artifact,'node_modules'),'dir');
     const create=createRequire(import.meta.url)(join(artifact,'compiled/lib/payment-reconciliation-worker.js')).createPaymentReconciliationWorker;
     for(const key of envKeys.slice(0,3))delete process.env[key];
     process.env.BLIZHNIY_AUTH_MODE='postgres';process.env.BLIZHNIY_AUTH_ORIGIN='https://xn----9sbphbgks4a4a.xn--p1ai';
     async function restore(source,database){
      await docker(['exec',container,'createdb','-U','postgres',database]);
      await docker(['exec',container,'bash','-euo','pipefail','-c','pg_dump -Fc -U postgres "$1" | pg_restore --single-transaction --exit-on-error -U postgres -d "$2"','queue-test',source,database]);
     }
     await restore(config.database,'queue_test');
     copy=new pg.Pool({...config,database:'queue_test'});
     await copy.query('create schema if not exists blizhniy_meta;create table if not exists blizhniy_meta.migrations(name text primary key,sha256 text not null)');
     const plan=getPaymentReconciliationRolePlan('queue_test',{cabinet:true,publicationTest:true});
     await copy.query(plan.createRole);await copy.query(`alter role ${plan.role} login password '${password}'`);
     for(const grant of plan.grants)await copy.query(grant);
     bounded=new DB(new pg.Pool({...config,database:'queue_test',user:plan.role,max:2}));
     let reads=0,success=false,captured;
     const read=async(url,init)=>{
      assert.equal(init.method,'GET');assert.equal(String(url),'https://api.yookassa.ru/v3/payments/'+providerId);reads++;
      return Response.json({id:providerId,status:success?'succeeded':'pending',paid:success,test:true,recipient:{account_id:shopId},amount:purchase.body.amount,metadata:purchase.body.metadata,
       ...(success?{captured_at:captured}:{})});
     };
     assert.throws(()=>create(bounded,{...merchant,isTest:false},read,owner.owner,true));
     assert.throws(()=>create(bounded,merchant,read,undefined,true));
     assert.deepEqual(await create(bounded,merchant,read,owner.owner).tick(),{state:'idle'});
     const scoped=create(bounded,merchant,read,owner.owner,true);
     await assert.rejects(scoped.tick(),{code:'42501'});
     await copy.query('grant select(intent_id) on app.specialist_checkout_terms to blizhniy_payment_reconciler');
     for(const [table,column] of [['service_publications','form'],['cabinet_profiles','profile'],['specialist_test_enrollment','owner_id']])
      assert.equal((await bounded.query("select has_column_privilege(current_user,$1,$2,'SELECT') ok",['app.'+table,column])).rows[0].ok,false);
     assert.deepEqual(await create(bounded,merchant,read,peer.owner,true).tick(),{state:'idle'});
     assert.deepEqual(await create(bounded,{...merchant,shopId:'900000002'},read,owner.owner,true).tick(),{state:'idle'});
     const Queue=load('postgres-payment-reconciliation').PostgresPaymentReconciliationQueue;
     const historicalQueue=new Queue(bounded,{shopId,isTest:true,publicationTestOwner:historical.owner,specialistAccountTest:true});
     assert.equal(await historicalQueue.enqueue(oldProvider),false);
     await copy.query('insert into app.payment_reconciliation_jobs(intent_id) values($1)',[old.binding.id]);
     assert.deepEqual(await create(bounded,merchant,read,historical.owner,true).tick(),{state:'idle'});
     assert.equal((await copy.query("select attempts from app.payment_reconciliation_jobs where intent_id=$1",[old.binding.id])).rows[0].attempts,0);
     // Old jobs without admitted specialist terms keep the general phone policy.
     await copy.query('delete from app.telegram_phone_bindings where user_id=$1',[historical.owner]);
     const waitOld=()=>copy.query("update app.payment_reconciliation_jobs set state='waiting_phone',last_code='phone_required' where intent_id=$1 returning state",[old.binding.id]);
     assert.equal((await waitOld()).rows[0].state,'queued');
     await copy.query('update app.phone_verification_policy set available=true,required=true where singleton');
     assert.equal((await waitOld()).rows[0].state,'waiting_phone');
     await copy.query('update app.phone_verification_policy set required=false where singleton');
     assert.equal((await copy.query('select state from app.payment_reconciliation_jobs where intent_id=$1',[old.binding.id])).rows[0].state,'queued');
     assert.equal(reads,0);
     const ticks=await Promise.all([scoped.tick(),scoped.tick()]);
     assert.deepEqual(ticks.find(t=>t.state==='deferred'),{state:'deferred',code:'provider_pending'});
     assert.deepEqual(ticks.find(t=>t.state==='idle'),{state:'idle'});assert.equal(reads,1);
     await restore('queue_test','queue_resume');
     inspector=new pg.Pool({...config,database:'queue_resume'});
     assert.equal((await inspector.query('select owner_id from app.specialist_test_enrollment')).rowCount,0);
     assert.equal((await inspector.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp() where intent_id=$1 and state='queued' and last_code='provider_pending'",[binding.id])).rowCount,1);
     resumed=new DB(new pg.Pool({...config,database:'queue_resume',user:plan.role,max:2}));
     success=true;captured=new Date().toISOString();const replay=create(resumed,merchant,read,owner.owner,true);
     if(full)await inspector.query('update app.phone_verification_policy set available=true,required=true where singleton');
     const previousPhone=(await inspector.query('delete from app.telegram_phone_bindings where user_id=$1 returning phone,telegram_subject',[owner.owner])).rows[0];
     assert.ok(previousPhone);
     assert.deepEqual(await replay.tick(),{state:'deferred',code:'phone_required'});
     assert.deepEqual(await replay.tick(),{state:'idle'});assert.equal(reads,2);
     assert.equal((await inspector.query('select status from app.payment_orders where id=$1',[binding.id])).rows[0].status,'succeeded');
     assert.equal((await inspector.query('select intent_id from app.payment_fulfillments where intent_id=$1',[binding.id])).rowCount,0);
     const confirmedAt=(await inspector.query('select clock_timestamp() as t')).rows[0].t;
     await inspector.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner.owner,previousPhone.phone,previousPhone.telegram_subject]);
     assert.deepEqual(await replay.tick(),{state:'completed'});assert.deepEqual(await replay.tick(),{state:'idle'});assert.equal(reads,3);
     assert.equal((await inspector.query('select intent_id from app.payment_fulfillments where intent_id=$1 and published_at >= $2',[binding.id,confirmedAt])).rowCount,1);
     assert.equal((await inspector.query("select f.intent_id from app.payment_fulfillments f join app.service_publications s on s.published_at=f.published_at and s.expires_at=f.expires_at where f.intent_id=$1 and s.id=$2 and s.is_paid and s.status='published' and f.expires_at-f.published_at=interval '30 days'",[binding.id,owner.id])).rowCount,1);
     assert.equal((await copy.query('select intent_id from app.payment_fulfillments where intent_id=$1',[binding.id])).rowCount,0);
    }finally{
     envKeys.forEach((key,i)=>{if(original[i]===undefined)delete process.env[key];else process.env[key]=original[i];});
     await resumed?.close();await bounded?.close();await inspector?.end();await copy?.end();await rm(directory,{recursive:true,force:true});
    }
   });
   const verification=new(load('postgres-payment-verification').PostgresPaymentVerificationStore)(worker,merchant,fetcher);
   await admin.query('grant insert(intent_id,provider_payment_id,status,captured_at),update(status,captured_at) on app.payment_verifications to specialist_worker;grant update(status) on app.payment_orders to specialist_worker');
   assert.equal((await verification.reconcile(binding.id)).orderStatus,'pending');
   await assert.rejects(worker.query('insert into app.payment_fulfillments(intent_id) values($1)',[binding.id]),{code:'PSP03'});
   paid=true;capturedAt=new Date().toISOString();
   assert.equal((await verification.reconcile(binding.id)).orderStatus,'succeeded');
   await worker.query('insert into app.payment_fulfillments(intent_id) values($1)',[binding.id]);
   const snapshot=await new(load('postgres-payment-history').PostgresPaymentHistoryStore)(web).readSpecialistOrder(owner.token,owner.owner,binding.id);
   assert.equal(snapshot.testOnly,true);assert.equal(snapshot.testPublication,true);
   const publicProfiles=new(load('postgres-public-service').PostgresPublicServiceStore)(web,{specialistProfileIdentity:true,testPublicationLabels:true});
   const publicName='ТЕСТ · Тестовый специалист';
   assert.equal((await publicProfiles.read('specialist',owner.id)).name,publicName);
   assert.equal((await publicProfiles.readMany([owner.id]))[0].name,publicName);
   assert.equal((await publicProfiles.professionPage(profession)).items.find(item=>item.id===owner.id)?.name,publicName);
   assert.equal((await publicProfiles.list('specialist')).find(item=>item.id===owner.id)?.name,publicName);
   assert.equal(Date.parse(snapshot.fulfillment.expiresAt)-Date.parse(snapshot.fulfillment.publishedAt),30*86400000);
   const again=await dispatcher.dispatch(binding);assert.equal(again.confirmationUrl,null);
   assert.equal(posts,2);assert.equal(accepted.size,1);assert.equal(gets,3);
   assert.equal((await admin.query("select count(*)::int as n from app.service_publications s join app.payment_fulfillments f on f.published_at=s.published_at and f.expires_at=s.expires_at where s.id=$1 and s.is_paid and s.status='published' and f.intent_id=$2",[owner.id,binding.id])).rows[0].n,1);
   // Restore the post-capture database with enrollment closed and both financial histories present.
   await docker(['exec',container,'pg_dump','-U','postgres','-Fc','-f','/tmp/admission.backup',config.database]);
   await docker(['exec',container,'createdb','-U','postgres','restored_admission']);
   await docker(['exec',container,'pg_restore','--exit-on-error','-U','postgres','-d','restored_admission','/tmp/admission.backup']);
   const restored=new pg.Pool({...config,database:'restored_admission'});
   try{
    assert.equal((await restored.query('select owner_id from app.specialist_test_enrollment')).rowCount,0);
    assert.equal((await restored.query('select intent_id from app.specialist_checkout_terms where intent_id=$1',[unmarkedLegacy.binding.id])).rowCount,0);
    const original=(await admin.query('select published_at::text,expires_at::text from app.payment_fulfillments where intent_id=$1',[binding.id])).rows;
    assert.deepEqual((await restored.query('select published_at::text,expires_at::text from app.payment_fulfillments where intent_id=$1',[binding.id])).rows,original);
    assert.equal((await restored.query("select count(*)::int as n from pg_trigger where tgname in ('specialist_test_dispatch_guard','specialist_test_terms_required','specialist_test_enrollment_no_update') and tgenabled='O'")).rows[0].n,3);
    for(const role of ['specialist_web','specialist_worker'])assert.equal((await restored.query("select has_table_privilege($1,'app.specialist_test_enrollment','INSERT,UPDATE,DELETE') ok",[role])).rows[0].ok,false);
    await assert.rejects(restored.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[preparedBeforeClosure.binding.id]),{code:'PSP01'});
   }finally{await restored.end();}
   const last=await draft();await assert.rejects(web.transaction(tx=>insert(tx,last,make(last))),{code:'PSP01'});
   await admission.test('a separately enrolled hosted specialist can cancel and edit an undispatched draft',async()=>{
    if(!full)await admin.query(await readFile(new URL('../database/migrations/0047-checkout-cancellation.sql',import.meta.url),'utf8'));
    await admin.query(await readFile(new URL('../database/candidates/0071-checkout-cancellation-test-policy.sql',import.meta.url),'utf8'));
    await admin.query('grant select on app.payment_checkout_cancellations to specialist_web;grant insert(payment_id) on app.payment_checkout_cancellations to specialist_web');
    const fresh=await draft(),purchase=make(fresh),input={paymentId:purchase.binding.id,targetType:'specialist'};
    await enroll(fresh);await web.transaction(tx=>insert(tx,fresh,purchase));
    const store=new(load('postgres-checkout-cancellation').PostgresCheckoutCancellation)(web,{
     specialist:{ownerId:fresh.owner,shopId,publicationMode:mode},
    });
    await assert.rejects(store.cancel(fresh.token,fresh.owner,input),{code:'CHECKOUT_NOT_FOUND'});
    await admin.query("insert into app.checkout_cancellation_test_enrollment(target_type,owner_id,shop_id) values('specialist',$1,$2)",[fresh.owner,shopId]);
    await assert.rejects(web.query('select * from app.checkout_cancellation_test_enrollment'),{code:'42501'});
    const cancelled={...input,state:'cancelled'};
    assert.deepEqual(await store.cancel(fresh.token,fresh.owner,input),cancelled);
    assert.deepEqual(await store.read(fresh.token,fresh.owner,input),cancelled);
    await assert.rejects(web.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[purchase.binding.id]),{code:'PCA02'});
    const updated=await fresh.forms.update(fresh.token,fresh.owner,'specialist',fresh.id,fresh.revision,
     {...(await fresh.forms.read(fresh.token,fresh.owner,'specialist',fresh.id)).form,description:'Обновлённое синтетическое описание услуги.'});
    assert.notEqual(updated.revision,fresh.revision);
   });

  });

 }finally{
  for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  await web?.close();await worker?.close();await ownerDb?.close();await admin?.end();if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Config.Labels['blizhniy.specialist-fixture'],name);await docker(['rm','--force','--volumes',container]);}
 }
});
