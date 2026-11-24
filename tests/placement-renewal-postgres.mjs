// Owned disposable PostgreSQL only; no manual stand, provider network or money.
import assert from 'node:assert/strict';
import {testPlacementRenewalGuards} from './placement-renewal-guard-cases.mjs';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-renewal-'+randomBytes(8).toString('hex'),label='blizhniy.renewal-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
const stamp=column=>`to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
test('new paid periods preserve historical purchases and undo only the latest extension',{timeout:120000},async suite=>{
 let container,admin,db;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network forbidden');};
 const merchant={shopId:'renewal-fixture',isTest:true,secretKey:'test_synthetic_only'};
 const local={BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:14431',BLIZHNIY_PLACEMENT_RENEWALS:'disabled'},savedEnv=Object.fromEntries(Object.keys(local).map(k=>[k,process.env[k]]));Object.assign(process.env,local);
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const pgConfig={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({...pgConfig,max:5});db=new(load('postgres').PostgresDatabase)(new pg.Pool({...pgConfig,max:5}));
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d{4}-[a-z-]+\.sql$/.test(n)&&n<'0056').sort();assert.equal(migrations.length,55);
  for(const n of migrations)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  await admin.query("create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых')");
  const city=(await admin.query('select id from app.cities')).rows[0].id,category=(await admin.query('select id from app.categories')).rows[0].id;
  const profession=(await admin.query("insert into app.specialist_categories(slug,name,parent_name) values('plumber','Сантехник','Строительство') returning id")).rows[0].id;
  async function fixture(kind='listing'){
   const owner=randomUUID(),phone='+7999'+String(randomInt(10000000)).padStart(7,'0');
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,owner+'@renewal.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:'Синтетический владелец',phone}]);await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner,phone,'renewal-'+owner]);
   const target=kind==='listing'?(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) values($1,'sell',$2,$3,'Синтетическое продление','Описание для проверки нового оплаченного срока.',$4,clock_timestamp()-interval '2 days') returning id",[owner,category,city,phone])).rows[0].id:
    (await admin.query("insert into app.work_publications(author_id,kind,creation_key,form,city_id,profession_id,created_at) values($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '2 days') returning id",[owner,kind,randomUUID(),load('work-publication-contract').parseWorkPublicationForm(kind,{kind,title:'Синтетическое продление',description:'Описание для проверки нового оплаченного срока.',cityName:'Краснодар',professionName:'Сантехник',professionId:profession,contactPhone:phone,placementRightConfirmed:true,...(kind==='vacancy'?{employerType:'person',organization:'Иван Иванов',salary:'3500'}:{budget:'3500'})}),city,profession])).rows[0].id;
   const token=randomBytes(32).toString('hex');await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),owner]);
   return{owner,target,kind,token};
  }
  async function buy(f,{succeeded=true,id=randomUUID()}={}){
   const providerPaymentId=randomUUID(),tariffId='renewal-placement',requestBody=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:id,targetId:f.target,targetType:f.kind,tariffId}});
   await db.transaction(async tx=>{await tx.query('select id from app.users where id=$1 for update',[f.owner]);await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(tx,{id,ownerId:f.owner,targetType:f.kind,targetId:f.target,targetRevision:'1',tariffId,amount:'199.00',durationDays:30,shopId:merchant.shopId,isTest:true,requestBody});await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[id,f.owner,randomUUID(),f.kind,f.target]);await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);});
   const capturedAt=(await admin.query(`select ${stamp('clock_timestamp()')} as value`)).rows[0].value;
   if(succeeded){await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);}
   return{...f,id,providerPaymentId,capturedAt};
  }
  async function initial(f,options){const item=options?.expired?null:await buy(f,options),table=f.kind==='listing'?'listings':'work_publications';
   const dates=(await admin.query(`update app.${table} set status='${options?.expired?'archived':'published'}',is_paid=true,published_at=clock_timestamp()-interval '${options?.expired?'31':'1'} days',expires_at=clock_timestamp()+interval '${options?.expired?'-1':'29'} days' where id=$1 returning ${stamp('published_at')} as "publishedAt",${stamp('expires_at')} as "expiresAt"`,[f.target])).rows[0];
   const saved=item??await buy(f,options);await admin.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2,$3)',[saved.id,dates.publishedAt,dates.expiresAt]);return saved;
  }
  const window=async f=>(await admin.query(`select status,is_paid,${stamp('published_at')} as "publishedAt",${stamp('expires_at')} as "expiresAt" from app.${f.kind==='listing'?'listings':'work_publications'} where id=$1`,[f.target])).rows[0];
  const receipt=async id=>(await admin.query(`select intent_id,${stamp('published_at')} as "publishedAt",${stamp('expires_at')} as "expiresAt",${stamp('fulfilled_at')} as "fulfilledAt" from app.payment_fulfillments where intent_id=$1`,[id])).rows[0];
  const renew=async(item,previous)=>(await admin.query(`insert into app.payment_renewals(intent_id,previous_intent_id) values($1,$2) returning ${stamp('additional_starts_at')} as "additionalStart",${stamp('additional_expires_at')} as "additionalEnd"`,[item.id,previous.id])).rows[0];
  async function refund(item){
   const operation=randomUUID(),providerRefundId=randomUUID();await new(load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,merchant).reserve(item.id,operation);
   const requests=new(load('postgres-refund-requests').PostgresRefundRequestStore)(db,merchant);await requests.prepare(operation);await requests.openWindow(operation);
   const reader=new(load('postgres-refund-journal').PostgresRefundJournalStore)(db,merchant,async url=>String(url).includes('/payments/')?Response.json({id:item.providerPaymentId,amount:{value:'199.00',currency:'RUB'},paid:true,status:'succeeded',test:true,recipient:{account_id:merchant.shopId},captured_at:item.capturedAt,metadata:{localPaymentId:item.id,targetId:item.target,targetType:item.kind,tariffId:'renewal-placement'}}):Response.json({id:providerRefundId,payment_id:item.providerPaymentId,amount:{value:'199.00',currency:'RUB'},status:'succeeded',created_at:new Date(Date.now()+1000).toISOString(),metadata:{localRefundId:operation,localPaymentId:item.id}}));
   await reader.reconcile(operation,providerRefundId);const effects=new(load('postgres-placement-refund-effect').PostgresPlacementRefundEffectStore)(db,merchant);const result=await effects.apply(operation);assert.deepEqual(await effects.apply(operation),result);return result;
  }
  await suite.test('owner archive expires at the exact PostgreSQL statement boundary with or without renewal',async()=>{
   const {PostgresListingCabinetStore}=load('postgres-listing-cabinet');
   for(const mode of ['disabled','local-v1'])for(const [offset,expected] of [[0,'expired'],[1,'archived'],[-1,'expired']]){
    process.env.BLIZHNIY_PLACEMENT_RENEWALS=mode;
    assert.equal(load('placement-renewal-config').readPlacementRenewalsEnabled(),mode==='local-v1');
    const f=await fixture();
    let expiresAt;
    const ownedBoundary={transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
     if(!sql.startsWith('select l.id'))return tx.query(sql,values);
     assert.deepEqual(values,[f.owner]);
     // One simple query message gives the UPDATE and projection the same server timestamp.
     const target=pg.escapeLiteral(f.target),actor=pg.escapeLiteral(f.owner);
     const results=await admin.query(`begin;set local time zone 'America/Los_Angeles';
      update app.listings set status='archived',is_paid=true,published_at=statement_timestamp()-interval '1 day',
       expires_at=statement_timestamp()+${offset}*interval '1 microsecond'
       where id=${target} returning ${stamp('expires_at')} as "expiresAt";
      ${sql.replace('$1',actor)};commit`);
     expiresAt=results[2].rows[0].expiresAt;
     return results[3];
    }}))};
    const {items:[item]}=await new PostgresListingCabinetStore(ownedBoundary,true).list(f.token,f.owner,null);
    assert.equal(item.card.status,expected);
    assert.deepEqual(item.card.placement,{expiresAt,active:offset>0});
   }
  });
  await suite.test('restore replay is idempotent while paid and a listing lock cannot prolong the period',async()=>{
   const f=await fixture(),{PostgresListingOwnerActions}=load('postgres-listing-owner-actions');
   const dates=(await admin.query(`update app.listings set status='archived',is_paid=true,
     published_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()+interval '3 seconds'
     where id=$1 returning ${stamp('published_at')} "publishedAt",${stamp('expires_at')} "expiresAt"`,[f.target])).rows[0];
   const purchase=await buy(f);
   await admin.query('insert into app.payment_fulfillments(intent_id,published_at,expires_at) values($1,$2,$3)',
    [purchase.id,dates.publishedAt,dates.expiresAt]);
   const actions=new PostgresListingOwnerActions(db);
   const restored={id:f.target,revision:'2',status:'published'};
   assert.deepEqual(await actions.change(f.token,f.owner,f.target,'1','restore'),restored);
   assert.deepEqual(await actions.change(f.token,f.owner,f.target,'2','restore'),restored);
   await assert.rejects(actions.change(f.token,f.owner,f.target,'1','restore'),{name:'ListingDraftConflictError'});
   const locker=await admin.connect();
   let running;
   try{
    await locker.query('begin');
    await locker.query('select id from app.listings where id=$1 for update',[f.target]);
    let pid,announce;
    const started=new Promise(resolve=>announce=resolve);
    const waiting=new PostgresListingOwnerActions({transaction:work=>db.transaction(async tx=>{
     pid=(await tx.query('select pg_backend_pid() pid')).rows[0].pid;announce();return work(tx);
    })});
    running=waiting.change(f.token,f.owner,f.target,'2','restore');running.catch(()=>{});
    await started;
    const deadline=Date.now()+2000;
    for(;;){
     if((await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)break;
     assert.ok(Date.now()<deadline,'Restore did not reach the listing lock');
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal((await locker.query('select $1::timestamptz>clock_timestamp() live',[dates.expiresAt])).rows[0].live,true);
    await locker.query('select pg_sleep(greatest(extract(epoch from $1::timestamptz-clock_timestamp()),0)+0.02)',[dates.expiresAt]);
    await locker.query('commit');
    await assert.rejects(running,{name:'ListingDraftAccessError'});
    assert.deepEqual(await window(f),{...dates,is_paid:true,status:'published'});
    assert.equal((await admin.query('select revision::text from app.listings where id=$1',[f.target])).rows[0].revision,'2');
   }finally{await locker.query('rollback');await running?.catch(()=>{});locker.release();}
  });
  const baseline=await fixture(),original=await initial(baseline),originalReceipt=await receipt(original.id);
  await suite.test('migration preserves original receipts and the runtime has no renewal write privilege',async()=>{await admin.query(await readFile(new URL('../database/migrations/0056-placement-renewals.sql',import.meta.url),'utf8'));await admin.query(await readFile(new URL('../database/migrations/0056-placement-renewals.down.sql',import.meta.url),'utf8'));assert.deepEqual(await receipt(original.id),originalReceipt);await admin.query(await readFile(new URL('../database/migrations/0056-placement-renewals.sql',import.meta.url),'utf8'));assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_renewals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as allowed")).rows[0].allowed,false);});
  for(const kind of ['listing','vacancy','workRequest'])await suite.test(kind+': two extensions and latest-first refunds preserve every prior receipt and remaining service',async()=>{
   const f=kind==='listing'?baseline:await fixture(kind),a=kind==='listing'?original:await initial(f),before=await window(f),saved=await receipt(a.id);
   const b=await buy(f),bWindow=await renew(b,a);assert.equal(bWindow.additionalStart,before.expiresAt);const middle=await window(f);assert.equal(middle.publishedAt,before.publishedAt);assert.equal(middle.expiresAt,bWindow.additionalEnd);assert.deepEqual(await receipt(a.id),saved);
   const c=await buy(f),cWindow=await renew(c,b);assert.equal(cWindow.additionalStart,middle.expiresAt);const tail=await window(f);assert.equal(tail.publishedAt,before.publishedAt);
   const reserve=new(load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,merchant);for(const old of [a,b])await assert.rejects(reserve.reserve(old.id,randomUUID()),error=>error.code==='PRN01');
   await admin.query("update app.users set role='admin' where id=$1",[f.owner]);
   const approvals=load('postgres-refund-approvals'),rejectedId=randomUUID();
   await assert.rejects(new approvals.PostgresRefundApprovalStore(db,merchant).approve(f.token,f.owner,{id:rejectedId,paymentIntentId:a.id,reason:'Возврат ранней покупки'}),approvals.RefundApprovalOrderError);
   assert.equal((await admin.query('select count(*)::int n from app.payment_refund_approvals where id=$1',[rejectedId])).rows[0].n,0);
   assert.equal((await refund(c)).effect,'revoked');assert.deepEqual(await window(f),middle);assert.equal((await refund(b)).effect,'revoked');assert.deepEqual(await window(f),before);assert.deepEqual(await receipt(a.id),saved);
   assert.equal((await refund(a)).effect,'revoked');assert.deepEqual(await window(f),{...before,status:'archived',is_paid:false});
  });
  await suite.test('unfulfilled capture and an unresolved replacement checkout prevent overlapping purchases/refunds',async()=>{
   const f=await fixture(),a=await initial(f),b=await buy(f,{succeeded:false});
   await assert.rejects(buy(f),error=>error.code==='23505');await assert.rejects(new(load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,merchant).reserve(a.id,randomUUID()),error=>error.code==='PRN01');
   await admin.query("update app.payment_orders set status='failed' where id=$1",[b.id]);const c=await buy(f);await assert.rejects(buy(f),error=>error.code==='PRN01');await assert.rejects(new(load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,merchant).reserve(a.id,randomUUID()),error=>error.code==='PRN01');await renew(c,a);
  });
  await suite.test('real session checkout and fulfillment renew all three types once, with unchanged default admission',async()=>{
   await admin.query("insert into app.tariffs(id,action,name,price,duration_days) values('listing-publication','listing_publication','Объявление',199,30),('vacancy-publication','vacancy_publication','Вакансия',199,30),('work-request-publication','work_request_publication','Заказ',199,30)");
   for(const kind of ['listing','vacancy','workRequest']){
    const f=await fixture(kind),a=await initial(f),old=await receipt(a.id),before=await window(f);
    const policy={postmoderation:true,renewals:true,...(kind==='listing'?{}:{targetType:kind})},config={...merchant,siteOrigin:'https://fixture.example.invalid',receiptVatCode:1};
    const store=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(db,config,policy);
    const strict=new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(db,config,{...policy,renewals:false});await assert.rejects(strict.preview(f.token,f.owner,f.target,'1'));
    const preview=await store.preview(f.token,f.owner,f.target,'1');assert.equal(preview.activePayment,null);
    const input={listingId:f.target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount,expectedDurationDays:preview.tariff.durationDays};
    const order=await store.prepare(f.token,f.owner,input);assert.deepEqual(await store.prepare(f.token,f.owner,input),order);await store.authorizeDispatch(f.token,f.owner,order.id,true);
    await db.transaction(async tx=>{await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[order.id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[order.id,randomUUID()]);await tx.query("update app.payment_orders set status='succeeded' where id=$1",[order.id]);await tx.query(`insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) select intent_id,provider_payment_id,'succeeded',${stamp('clock_timestamp()')} from app.payment_provider_links where intent_id=$1`,[order.id]);});
    const fulfill=new(load('postgres-listing-payment-fulfillment').PostgresListingPaymentFulfillmentStore)(db,merchant,policy),result=await fulfill.fulfill(order.id);assert.equal(result.state,'fulfilled');assert.deepEqual(await fulfill.fulfill(order.id),result);assert.deepEqual(await receipt(a.id),old);assert.equal((await window(f)).publishedAt,before.publishedAt);assert.ok((await window(f)).expiresAt>before.expiresAt);
    const read=await store.readOrder(f.token,f.owner,order.id);assert.equal(read.fulfillment.publishedAt,before.expiresAt);assert.equal(read.fulfillment.expiresAt,(await window(f)).expiresAt);
    assert.deepEqual(load('client-listing-payment').parseListingPaymentSnapshot(read,order.id),read);
    await admin.query('grant usage on schema app to blizhniy_runtime;grant select on app.users,app.sessions to blizhniy_runtime;grant update(id) on app.users to blizhniy_runtime;grant update(last_seen_at) on app.sessions to blizhniy_runtime');
    await admin.query(await readFile(new URL('../database/permissions/listing-checkout.sql',import.meta.url),'utf8'));
    await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
    const limited=new(load('postgres').PostgresDatabase)(new pg.Pool({...pgConfig,user:'blizhniy_runtime',max:1}));
    assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_renewals','SELECT') allowed")).rows[0].allowed,false);
    try{const limitedRead=await new(load('postgres-listing-checkout').PostgresListingCheckoutStore)(limited,config,policy).readOrder(f.token,f.owner,order.id);assert.deepEqual(limitedRead,read);}finally{await limited.close();}

    assert.equal((await admin.query('select count(*)::int n from app.payment_renewals where intent_id=$1',[order.id])).rows[0].n,1);
   }
  });
  await suite.test('renewing an expired period starts at new availability and refund preserves the expired original receipt',async()=>{
   for(const kind of ['listing','vacancy','workRequest']){
    const f=await fixture(kind),a=await initial(f,{expired:true}),before=await window(f),old=await receipt(a.id),b=await buy(f),extra=await renew(b,a),current=await window(f);
    assert.ok(current.publishedAt>before.expiresAt);assert.equal(current.publishedAt,extra.additionalStart);assert.equal(current.expiresAt,extra.additionalEnd);assert.deepEqual(await receipt(a.id),old);
    await refund(b);assert.deepEqual(await window(f),{...before,status:'archived'});assert.deepEqual(await receipt(a.id),old);
    const store=kind==='listing'?new(load('postgres-listing-cabinet').PostgresListingCabinetStore)(db,true):new(load('postgres-work-cabinet').PostgresWorkCabinetStore)(db,true);
    const cards=kind==='listing'?await store.list(f.token,f.owner,null):await store.list(f.token,f.owner,kind,null),card=cards.items.find(item=>item.id===f.target);assert.equal(kind==='listing'?card.card.status:card.status,'expired');

   }
  });
  await suite.test('a target-update failure rolls back both the renewal journal and its early receipt',async()=>{
   const f=await fixture(),a=await initial(f),before=await window(f),b=await buy(f);
   await admin.query("create function app.synthetic_renewal_failure() returns trigger language plpgsql as $$begin raise exception using errcode='PT001',message='Synthetic target failure';end$$;create trigger synthetic_renewal_failure before update on app.listings for each row execute function app.synthetic_renewal_failure()");
   try{await assert.rejects(renew(b,a),{code:'PT001'});assert.equal(await receipt(b.id),undefined);assert.deepEqual(await window(f),before);assert.equal((await admin.query('select count(*)::int n from app.payment_renewals where intent_id=$1',[b.id])).rows[0].n,0);}
   finally{await admin.query('drop trigger synthetic_renewal_failure on app.listings;drop function app.synthetic_renewal_failure()');}
   await renew(b,a);assert.ok((await window(f)).expiresAt>before.expiresAt);
  });
  await suite.test('the fourth paid period can be withdrawn and restored without relying on UUID history order',async()=>{
   const f=await fixture('workRequest'),identity=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
   let previous=await initial(f,{id:identity(1)});for(const n of [2,3,4]){const next=await buy(f,{id:identity(n)});await renew(next,previous);previous=next;}
   const before=await window(f),actions=new(load('postgres-work-owner-actions').PostgresWorkOwnerActions)(db);
   const base={publicationId:f.target,kind:f.kind};const withdrawn=await actions.change(f.token,f.owner,{...base,operationId:randomUUID(),expectedRevision:'1',action:'withdraw',reason:'Временно снимаю заказ'});
   assert.equal(withdrawn.status,'archived');assert.deepEqual(await window(f),{...before,status:'archived'});
   const restored=await actions.change(f.token,f.owner,{...base,operationId:randomUUID(),expectedRevision:'2',action:'restore',reason:null});assert.equal(restored.status,'published');assert.deepEqual(await window(f),before);
  });
  await suite.test('unresolved response checkout permits only journal-backed renewal and undo, preserving content and edit fences',async()=>{
   for(const state of ['pending','succeeded']){
    const f=await fixture('workRequest'),a=await initial(f),before=await window(f),applicant=await fixture('workRequest'),application=randomUUID(),payment=randomUUID();
    await admin.query("insert into app.applications(id,applicant_id,work_publication_id,creation_key,target_revision,specialist_revision,snapshot) values($1,$2,$3,$4,1,1,'{}')",[application,applicant.owner,f.target,randomUUID()]);
    const body=JSON.stringify({amount:{value:'99.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:payment,targetId:application,targetType:'application',tariffId:'application-response'}});
    await db.transaction(async tx=>{await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(tx,{id:payment,ownerId:applicant.owner,targetType:'application',targetId:application,targetRevision:'1',tariffId:'application-response',amount:'99.00',durationDays:null,shopId:merchant.shopId,isTest:true,requestBody:body});await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'application',$4,1)",[payment,applicant.owner,randomUUID(),application]);await tx.query('update app.payment_orders set status=$2 where id=$1',[payment,state]);});
    const content=(await admin.query('select form,revision::text from app.work_publications where id=$1',[f.target])).rows[0];
    const rejectEdits=async()=>{for(const assignment of ["expires_at=expires_at+interval '1 second'","form=jsonb_set(form,'{title}','\"Другой заказ\"')","revision=revision+1","status='archived'"])await assert.rejects(admin.query('update app.work_publications set '+assignment+' where id=$1',[f.target]),{code:'PWR01'});};
    await rejectEdits();const b=await buy(f);await renew(b,a);assert.ok((await window(f)).expiresAt>before.expiresAt);await rejectEdits();await refund(b);assert.deepEqual(await window(f),before);await rejectEdits();
    assert.deepEqual((await admin.query('select form,revision::text from app.work_publications where id=$1',[f.target])).rows[0],content);
    assert.equal((await admin.query('select status,is_paid,sent_at from app.applications where id=$1',[application])).rows[0].is_paid,false);
   }
  });
  await suite.test('SQL refuses forged renewal dates and immutable history changes',async()=>{
   const f=await fixture(),a=await initial(f),b=await buy(f);
   await assert.rejects(admin.query("insert into app.payment_renewals(intent_id,previous_intent_id,expires_at) values($1,$2,clock_timestamp()+interval '9 years')",[b.id,a.id]),error=>error.code==='PRN01');await renew(b,a);
   for(const sql of ['update app.payment_renewals set recorded_at=clock_timestamp()','delete from app.payment_renewals','truncate app.payment_renewals'])await assert.rejects(admin.query(sql),error=>error.code==='23514');
   await assert.rejects(admin.query(await readFile(new URL('../database/migrations/0056-placement-renewals.down.sql',import.meta.url),'utf8')),error=>error.code==='23514');await admin.query('rollback');assert.ok((await admin.query('select count(*)::int n from app.payment_renewals')).rows[0].n>0);
  });
  await testPlacementRenewalGuards(suite,{admin,config:pgConfig,load});
 }finally{globalThis.fetch=previousFetch;for(const k of Object.keys(local))if(savedEnv[k]===undefined)delete process.env[k];else process.env[k]=savedEnv[k];try{await db?.close();}finally{try{await admin?.end();}finally{if(container){const owned=JSON.parse(await docker(['inspect',container]))[0];assert.equal(owned.Id,container);assert.equal(owned.Config.Labels[label],name);assert.equal(owned.Config.Image,image);await docker(['rm','--force',container]);}}}}
});
