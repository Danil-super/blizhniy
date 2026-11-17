// Disposable loopback PostgreSQL and synthetic captures only; never reads .env.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
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
 }finally{
  for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  await web?.close();await worker?.close();await ownerDb?.close();await admin?.end();if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Config.Labels['blizhniy.specialist-fixture'],name);await docker(['rm','--force','--volumes',container]);}
 }
});
