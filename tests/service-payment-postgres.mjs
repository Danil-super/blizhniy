// Owned disposable database. Never installs the candidate on the permanent local stand.
import assert from 'node:assert/strict';import {test} from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';import {readFile,readdir} from 'node:fs/promises';import {createRequire} from 'node:module';import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',name='blizhniy-service-pay-'+randomBytes(8).toString('hex'),label='blizhniy.service-pay-fixture',password=randomBytes(32).toString('hex');
const docker=async args=>(await run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',POSTGRES_PASSWORD:password}})).stdout.trim();
const stamp=c=>`to_char(${c} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
test('service event terms and advertising slots are authoritative and once only',{timeout:120000},async suite=>{
 const local={NODE_ENV:'test',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'},savedEnv=Object.fromEntries(Object.keys(local).map(k=>[k,process.env[k]]));Object.assign(process.env,local);
 let container,admin,db;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External network forbidden');};
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);assert.equal(metadata.Config.Image,image);assert.equal(metadata.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  const deadline=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<deadline);}await new Promise(r=>setTimeout(r,100));}
  admin=new pg.Pool({...config,max:8});db=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,max:5}));
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d{4}-[a-z-]+\.sql$/.test(n)&&n<'0057').sort();assert.equal(migrations.length,56);
  for(const n of migrations)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  await admin.query("create role blizhniy_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.tariffs(id,action,name,price,duration_days) values('fair-participation','fair_participation','Ярмарка',1000,null),('ad-marquee','ad_marquee','Реклама',299,7)");
  const city=(await admin.query('select id from app.cities')).rows[0].id;
  await suite.test('candidate adds no roles or grants and empty rollback preserves the complete old schema',async()=>{
   assert.equal((await admin.query("select to_regclass('app.service_payment_terms') absent")).rows[0].absent,null);
   const up=await readFile(new URL('../database/migrations/0057-service-payment-terms.sql',import.meta.url),'utf8');await admin.query(up);
   assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.service_payment_terms','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed")).rows[0].allowed,false);
   await admin.query(await readFile(new URL('../database/migrations/0057-service-payment-terms.down.sql',import.meta.url),'utf8'));await admin.query(up);
  });
  async function fixture(kind='marquee'){
   const owner=randomUUID(),phone='+7999'+String(randomInt(10000000)).padStart(7,'0'),token=randomBytes(32).toString('hex');
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,owner+'@service.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[owner,{name:'Синтетический владелец',phone}]);await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',[owner,phone,'service-'+owner]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[load('identity').hashSessionToken(token),owner]);
   const form=load('service-publication-contract').parseServicePublicationForm(kind,{kind,title:'Синтетическая услуга',placementRightConfirmed:true,...(kind==='fair'?{description:'Описание участника ярмарки',category:'Посуда',cityName:'Краснодар',contactPhone:phone,email:owner+'@service.invalid'}:{href:'https://fixture.example.invalid/'})});
   const target=(await admin.query('insert into app.service_publications(author_id,kind,creation_key,form,city_id) values($1,$2,$3,$4,$5) returning id',[owner,kind,randomUUID(),form,kind==='fair'?city:null])).rows[0].id;
   await admin.query("insert into app.service_moderation(publication_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);return{owner,target,kind,token,form};
  }
  async function buy(f,{captured=true,terms=true}={}){
   const id=randomUUID(),provider=randomUUID(),targetType=f.kind==='fair'?'fair_application':'ad_marquee',tariffId=f.kind==='fair'?'fair-participation':'ad-marquee',amount=f.kind==='fair'?'1000.00':'299.00',durationDays=f.kind==='fair'?null:7;
   const intent={id,ownerId:f.owner,targetType,targetId:f.target,targetRevision:'1',tariffId,amount,durationDays,shopId:'service-fixture',isTest:true,requestBody:JSON.stringify({amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:id,targetId:f.target,targetType,tariffId}})};
   await db.transaction(async tx=>{await tx.query('select id from app.users where id=$1 for update',[f.owner]);await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).persistInTransaction(tx,intent);await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[id,f.owner,randomUUID(),targetType,f.target]);if(terms)await tx.query('insert into app.service_payment_terms(intent_id) values($1)',[id]);await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,provider]);});
   if(captured){await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await admin.query(`insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',${stamp('clock_timestamp()')})`,[id,provider]);}return{...f,id,provider,intent};
  }
  const fulfill=p=>admin.query(`insert into app.payment_fulfillments(intent_id) values($1) returning ${stamp('published_at')} published,${stamp('expires_at')} expires`,[p.id]);
  const window=async p=>(await admin.query('select status,is_paid,published_at::text,expires_at::text from app.service_publications where id=$1',[p.target])).rows[0];
  await suite.test('server calendar includes the whole Moscow event day and crosses year/leap-month correctly',async()=>{
   for(const [now,event] of [['2026-11-29T20:59:59Z','2026-11-29'],['2026-11-29T21:00:00Z','2026-12-27'],['2024-02-01T00:00:00Z','2024-02-25'],['2026-12-31T23:00:00Z','2027-01-31']]){
    const result=(await admin.query('select event_date::text date,ends_at::text ends from app.fair_event_at($1)',[now])).rows[0];assert.equal(result.date,event);
   }
  });
  await suite.test('fair purchase preserves its exact event cutoff, assigns its start once, and rejects forged dates',async()=>{
   const p=await buy(await fixture('fair')),terms=(await admin.query('select fair_date::text date,fair_ends_at::text ends from app.service_payment_terms where intent_id=$1',[p.id])).rows[0];
   const receipt=(await fulfill(p)).rows[0];assert.equal((await window(p)).status,'published');assert.equal(Date.parse(receipt.expires),Date.parse(terms.ends));assert.ok(Date.parse(receipt.published)<Date.parse(receipt.expires));
   await assert.rejects(fulfill(p),e=>e.code==='23505');await assert.rejects(admin.query('update app.service_payment_terms set fair_ends_at=fair_ends_at+interval \'1 day\' where intent_id=$1',[p.id]),e=>e.code==='23514');
   const fresh=await buy(await fixture('fair'),{terms:false});await assert.rejects(admin.query('insert into app.service_payment_terms(intent_id,fair_date,fair_ends_at) values($1,current_date,clock_timestamp()+interval \'30 days\')',[fresh.id]),e=>e.code==='23514');
  });
  await suite.test('capture, server terms, phone and current moderation are all required before service activation',async()=>{
   for(const failure of ['no-capture','no-terms','phone','moderation','blocked']){
    const p=await buy(await fixture(),{captured:failure!=='no-capture',terms:failure!=='no-terms'});
    if(failure==='phone')await admin.query('delete from app.telegram_phone_bindings where user_id=$1',[p.owner]);
    if(failure==='moderation')await admin.query('delete from app.service_moderation where publication_id=$1',[p.target]);
    if(failure==='blocked')await admin.query('update app.users set is_blocked=true where id=$1',[p.owner]);
    await assert.rejects(fulfill(p),e=>e.code==='PSV01');assert.deepEqual(await window(p),{status:'draft',is_paid:false,published_at:null,expires_at:null});
   }
  });
  await suite.test('active or uncertain service checkout freezes form and photos before capture, while expired unrelated drafts remain editable',async()=>{
   const p=await buy(await fixture(),{captured:false});await assert.rejects(admin.query("update app.service_publications set form=jsonb_set(form,'{title}','\"Изменённая реклама\"'),revision=revision+1 where id=$1",[p.target]),e=>e.code==='PSF01');
   await assert.rejects(admin.query('delete from app.service_publications where id=$1',[p.target]),e=>e.code==='PSF01');
   const media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',40,20,12,$2) returning id",[p.owner,'e'.repeat(64)])).rows[0].id;
   await assert.rejects(admin.query('insert into app.service_publication_photos(publication_id,media_id,position) values($1,$2,0)',[p.target,media]),e=>e.code==='PSF01');
   const free=await fixture();assert.equal((await admin.query("update app.service_publications set form=jsonb_set(form,'{title}','\"Свободная реклама\"'),revision=revision+1 where id=$1",[free.target])).rowCount,1);
  });
  await suite.test('five slots hold the sixth and FIFO prevents a later capture taking a newly freed slot',async()=>{
   const all=[];for(let i=0;i<7;i++)all.push(await buy(await fixture()));
   for(const p of all.slice(0,5))await fulfill(p);
   const a=all[5],b=all[6];await assert.rejects(fulfill(a),e=>e.code==='PSQ01');
   await admin.query("update app.service_publications set status='archived' where id=$1",[all[0].target]);
   await assert.rejects(fulfill(b),e=>e.code==='PSQ01');await fulfill(a);assert.equal((await window(a)).status,'published');await assert.rejects(fulfill(b),e=>e.code==='PSQ01');
   const held=await admin.connect();await held.query('begin');await held.query('select pg_advisory_xact_lock(170219,57)');
   await admin.query("update app.service_publications set status='archived' where id=$1",[all[1].target]);
   const pending=fulfill(b);await new Promise(r=>setTimeout(r,60));await held.query('commit');held.release();
   const receipt=(await pending).rows[0];assert.equal(Date.parse(receipt.expires)-Date.parse(receipt.published),7*86400000);
   assert.equal((await admin.query("select count(*)::int n from app.service_publications where kind='marquee' and status='published' and is_paid and expires_at>clock_timestamp()")).rows[0].n,5);
  });
  await suite.test('parallel activations cannot exceed five slots and replay recovers the same receipt after a lost ACK',async()=>{
   await admin.query("update app.service_publications set status='archived' where kind='marquee' and status='published'");
   const services=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(db,{shopId:'service-fixture',isTest:true}),all=[];
   for(let i=0;i<6;i++)all.push(await buy(await fixture()));for(const p of all.slice(0,4))await services.fulfill(p.id);
   const [first,second]=await Promise.all([services.fulfill(all[4].id),services.fulfill(all[5].id)]);assert.equal(first.state,'fulfilled');assert.equal(second.state,'queued');
   assert.equal((await admin.query("select count(*)::int n from app.service_publications where kind='marquee' and status='published' and is_paid and expires_at>clock_timestamp()")).rows[0].n,5);
   await admin.query("update app.service_publications set status='archived' where id=$1",[all[0].target]);
   const unknown=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)({transaction:async work=>{await db.transaction(work);throw Error('Lost COMMIT acknowledgement');}},{shopId:'service-fixture',isTest:true});
   await assert.rejects(unknown.fulfill(all[5].id));assert.equal((await services.fulfill(all[5].id)).state,'fulfilled');assert.equal((await admin.query('select count(*)::int n from app.payment_fulfillments where intent_id=$1',[all[5].id])).rows[0].n,1);
   await assert.rejects(admin.query("update app.service_publications set form=jsonb_set(form,'{title}','\"Подмена оплаченного текста\"'),revision=revision+1 where id=$1",[all[5].target]),e=>e.code==='PSF01');
  });
  await suite.test('session checkout saves the exact quote once and recovers the original intent after a lost COMMIT acknowledgement',async()=>{
   const {PostgresServiceCheckoutStore}=load('postgres-service-checkout'),merchant={shopId:'service-fixture',isTest:true,siteOrigin:'https://fixture.example.invalid',receiptVatCode:1};
   for(const kind of ['fair','marquee']){
    const f=await fixture(kind),store=new PostgresServiceCheckoutStore(db,merchant,kind),preview=await store.preview(f.token,f.owner,f.target,'1');
    assert.equal(preview.activePayment,null);assert.equal(preview.tariff.durationDays,kind==='fair'?null:7);assert.equal(preview.fairEvent===null,kind!=='fair');
    const input={publicationId:f.target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount,expectedDurationDays:preview.tariff.durationDays,expectedFairDate:preview.fairEvent?.date??null};
    const unknown=new PostgresServiceCheckoutStore({transaction:async work=>{await db.transaction(work);throw Error('Lost COMMIT acknowledgement');}},merchant,kind);
    await assert.rejects(unknown.prepare(f.token,f.owner,input));const saved=await store.readIntent(f.token,f.owner,input.creationKey);assert.ok(saved);assert.deepEqual(await store.prepare(f.token,f.owner,input),saved);
    const snapshot=await store.readOrder(f.token,f.owner,saved.id);assert.equal(snapshot.order.id,saved.id);assert.equal(snapshot.fulfillment,null);assert.deepEqual(snapshot.order.fairEvent,preview.fairEvent);
    assert.equal((await store.authorizeDispatch(f.token,f.owner,saved.id,true)).id,saved.id);
    await assert.rejects(store.prepare(f.token,f.owner,{...input,expectedAmount:'9000.00'}),{name:'ServiceCheckoutConflictError'});
    const stranger=await fixture(kind);await assert.rejects(store.readOrder(stranger.token,stranger.owner,saved.id),load('postgres-service-publications').ServicePublicationAccessError);
    const sql=(await admin.query('select count(*)::int n from app.payment_orders where target_id=$1',[f.target])).rows[0].n;assert.equal(sql,1);
   }
  });
  await suite.test('real restricted login can prepare and simulate service payment, without publication or refund write grants',async()=>{
   await admin.query('grant usage on schema app to blizhniy_runtime;grant select on app.users,app.sessions,app.cities,app.specialist_categories,app.tariffs,app.service_publications,app.service_publication_photos,app.service_moderation,app.media_objects,app.auth_rate_limits to blizhniy_runtime;grant update(id) on app.users to blizhniy_runtime;grant update(last_seen_at) on app.sessions to blizhniy_runtime;grant insert(key_hash,window_start,attempts),update(attempts) on app.auth_rate_limits to blizhniy_runtime');
   for(const name of ['listing-checkout.sql','listing-checkout-dispatch.sql','telegram-phone.sql','service-checkout.sql'])await admin.query(await readFile(new URL('../database/permissions/'+name,import.meta.url),'utf8'));
   await admin.query('grant update(form,city_id,profession_id,revision,updated_at) on app.service_publications to blizhniy_runtime;grant update(state,decided_at,decided_by,decision_note) on app.service_moderation to blizhniy_runtime');await admin.query('alter role blizhniy_runtime login password '+pg.escapeLiteral(password));
   const limited=new(load('postgres').PostgresDatabase)(new pg.Pool({...config,user:'blizhniy_runtime',max:2})),origin='https://xn----9sbphbgks4a4a.xn--p1ai';
   try{
    const {localPrimaryPaymentHandler}=await import('../scripts/local-primary-payment.mjs');
    const context={state:{origin:local.BLIZHNIY_LOCAL_PRIMARY_ORIGIN,rateSecret:'a'.repeat(64)},ownerDb:db,runtimeDb:limited,load};
    for(const kind of ['fair','marquee']){
     const f=await fixture(kind),request=(path,body,method='POST',headers={})=>new Request(origin+path,{method,headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-real-ip':'192.0.2.5','x-blizhniy-request':'1',cookie:'__Host-blizhniy_session='+f.token,...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
     const path='/api/account/'+kind+'-checkout',bad=await localPrimaryPaymentHandler(request(path,{action:'preview',expectedOwnerId:f.owner,publicationId:f.target,expectedRevision:'1'},'POST',{origin:'https://foreign.invalid'}),context);assert.equal(bad.status,403);
     const previewResponse=await localPrimaryPaymentHandler(request(path,{action:'preview',expectedOwnerId:f.owner,publicationId:f.target,expectedRevision:'1'}),context);assert.equal(previewResponse.status,200);const preview=await previewResponse.json();
     const response=await localPrimaryPaymentHandler(request(path,{expectedOwnerId:f.owner,publicationId:f.target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount,expectedDurationDays:preview.tariff.durationDays,expectedFairDate:preview.fairEvent?.date??null},'PUT'),context);assert.equal(response.status,200);const order=await response.json();
     assert.equal((await localPrimaryPaymentHandler(request(path,{action:'dispatch',expectedOwnerId:f.owner,paymentId:order.id}),context)).status,200);
     const simulator=new Request(origin+'/__local/payment?intent='+order.id+'&type='+kind,{method:'POST',headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin',cookie:'__Host-blizhniy_session='+f.token,'content-type':'application/x-www-form-urlencoded'},body:'action=succeed'});
     assert.equal((await localPrimaryPaymentHandler(simulator,context)).status,200);const read=await localPrimaryPaymentHandler(request(path,{action:'order',expectedOwnerId:f.owner,paymentId:order.id}),context);assert.equal(read.status,200);const paid=await read.json();assert.equal(paid.order.status,'succeeded');
     if(kind==='marquee'){
      assert.equal(paid.fulfillment,null);assert.deepEqual(await window({target:f.target}),{status:'draft',is_paid:false,published_at:null,expires_at:null});
      await admin.query("update app.service_publications set status='archived' where id=(select id from app.service_publications where kind='marquee' and status='published' order by published_at,id limit 1)");
      const {startLocalServicePublicationQueue}=await import('../scripts/local-service-publication-queue.mjs'),worker=startLocalServicePublicationQueue({dbPort:config.port,database:config.database,ownerPassword:password});
      try{const deadline=Date.now()+5000;while((await window({target:f.target})).status!=='published'){assert.ok(Date.now()<deadline,'Owned queue publishes after a slot is free');await new Promise(r=>setTimeout(r,20));}}finally{await worker.close();}
      assert.equal((await new(load('postgres-service-checkout').PostgresServiceCheckoutStore)(limited,{shopId:'local-fixture-shop',isTest:true,siteOrigin:origin,receiptVatCode:1},kind).readOrder(f.token,f.owner,order.id)).fulfillment!==null,true);
     }
     const rights=(await admin.query("select has_column_privilege('blizhniy_runtime','app.service_publications','is_paid','UPDATE') paid,has_table_privilege('blizhniy_runtime','app.payment_fulfillments','INSERT') receipt,has_table_privilege('blizhniy_runtime','app.payment_refund_effects','INSERT') refund")).rows[0];assert.deepEqual(rights,{paid:false,receipt:false,refund:false});
    }
   }finally{await limited.close();}
  });
  await suite.test('full administrator refunds cover published fair, live advertising and queued advertising exactly once',async()=>{
   const merchant={shopId:'service-fixture',isTest:true,secretKey:'test_synthetic_only'},operator=await fixture();await admin.query("update app.users set role='admin' where id=$1",[operator.owner]);
   const approvals=new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(db,merchant),services=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(db,merchant);
   for(const [kind,publish] of [['fair',true],['marquee',true],['marquee',false]]){
    if(kind==='marquee'&&publish)await admin.query("update app.service_publications set status='archived' where kind='marquee' and status='published'");
    const p=await buy(await fixture(kind));if(publish)assert.equal((await services.fulfill(p.id)).state,'fulfilled');
    const input={id:randomUUID(),paymentIntentId:p.id,reason:'Синтетический полный возврат платы за услугу.'},approval=await approvals.approve(operator.token,operator.owner,input),refundId=randomUUID();let posts=0;
    const capturedAt=(await admin.query('select captured_at value from app.payment_verifications where intent_id=$1',[p.id])).rows[0].value;
    const refund={id:refundId,payment_id:p.provider,amount:{value:p.intent.amount,currency:'RUB'},status:'succeeded',created_at:new Date().toISOString(),metadata:{localRefundId:approval.id,localPaymentId:p.id}};
    const fetcher=async(value,init)=>{
     const url=String(value);if(init.method==='POST'){assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+approval.id);posts++;return Response.json(refund);}
     assert.equal(init.method,'GET');if(url==='https://api.yookassa.ru/v3/payments/'+p.provider)return Response.json({id:p.provider,amount:{value:p.intent.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:capturedAt,recipient:{account_id:merchant.shopId},metadata:JSON.parse(p.intent.requestBody).metadata});
     if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+p.provider+'&limit=100')return Response.json({type:'list',items:[]});assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+refundId);return Response.json(refund);
    };
    const processor=load('primary-approved-placement-refund').createApprovedPlacementRefundProcessor(db,merchant,fetcher),result=await processor.process(approval.id);assert.equal(result.state,'applied');assert.equal(result.effect.effect,publish?'revoked':'unfulfilled');assert.equal(posts,1);
    assert.equal((await window(p)).is_paid,false);assert.equal((await window(p)).status,publish?'archived':'draft');assert.equal((await processor.process(approval.id)).state,'applied');assert.equal(posts,1);
    assert.deepEqual(await approvals.approve(operator.token,operator.owner,input),approval);
    assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
    const notices=(await admin.query('select body,action_href from app.notifications where event_key=$1',['placement_refund:'+p.id])).rows;assert.equal(notices.length,1);assert.ok(notices[0].body.includes(input.reason));assert.equal(notices[0].action_href,kind==='fair'?'/cabinet/fair-applications':'/cabinet/oplata');
    if(!publish)assert.equal((await services.fulfill(p.id)).state,'not_ready');
   }
  });
  await suite.test('terminal canceled refund releases the advertising queue fence without changing the original purchase',async()=>{
   const merchant={shopId:'service-fixture',isTest:true,secretKey:'test_synthetic_only'},operator=await fixture();await admin.query("update app.users set role='admin' where id=$1",[operator.owner]);
   const p=await buy(await fixture()),approval=await new(load('postgres-refund-approvals').PostgresRefundApprovalStore)(db,merchant).approve(operator.token,operator.owner,{id:randomUUID(),paymentIntentId:p.id,reason:'Синтетический отменённый возврат.'}),refundId=randomUUID();
   await new(load('postgres-placement-refund-reservations').PostgresPlacementRefundReservationStore)(db,merchant).reserve(p.id,approval.id);
   const requests=new(load('postgres-refund-requests').PostgresRefundRequestStore)(db,merchant);await requests.prepare(approval.id);await requests.openWindow(approval.id);
   const capturedAt=(await admin.query('select captured_at value from app.payment_verifications where intent_id=$1',[p.id])).rows[0].value;
   const reader=new(load('postgres-refund-journal').PostgresRefundJournalStore)(db,merchant,async url=>String(url).includes('/payments/')?Response.json({id:p.provider,amount:{value:p.intent.amount,currency:'RUB'},paid:true,status:'succeeded',test:true,recipient:{account_id:merchant.shopId},captured_at:capturedAt,metadata:JSON.parse(p.intent.requestBody).metadata}):Response.json({id:refundId,payment_id:p.provider,amount:{value:p.intent.amount,currency:'RUB'},status:'canceled',created_at:new Date().toISOString(),metadata:{localRefundId:approval.id,localPaymentId:p.id}}));
   await reader.reconcile(approval.id,refundId);await admin.query("update app.service_publications set status='archived' where kind='marquee' and status='published'");
   const services=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(db,merchant);
   // Older valid waits retain priority; discovery skips canceled/blocked entries before its limit.
   for(const id of await services.discover(100))await services.fulfill(id);
   assert.equal((await services.fulfill(p.id)).state,'fulfilled');assert.equal((await admin.query('select status from app.payment_orders where id=$1',[p.id])).rows[0].status,'succeeded');assert.equal((await admin.query('select count(*)::int n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,0);
  });
  await suite.test('service preparation can be canceled before dispatch, but an anchor or unknown send cannot be released',async()=>{
   for(const kind of ['fair','marquee']){
    const f=await fixture(kind),store=new(load('postgres-service-checkout').PostgresServiceCheckoutStore)(db,{shopId:'local-fixture-shop',isTest:true,siteOrigin:'https://fixture.example.invalid',receiptVatCode:1},kind),quote=await store.preview(f.token,f.owner,f.target,'1'),input={publicationId:f.target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays,expectedFairDate:quote.fairEvent?.date??null};
    const order=await store.prepare(f.token,f.owner,input),cancellation=new(load('postgres-checkout-cancellation').PostgresCheckoutCancellation)(db),targetType=kind==='fair'?'fair_application':'ad_marquee';
    const result=await cancellation.cancel(f.token,f.owner,{paymentId:order.id,targetType});assert.equal(result.state,'cancelled');assert.deepEqual(await cancellation.cancel(f.token,f.owner,{paymentId:order.id,targetType}),result);assert.equal((await store.readOrder(f.token,f.owner,order.id)).order.status,'failed');
    const replacement=await store.prepare(f.token,f.owner,{...input,creationKey:randomUUID()});assert.notEqual(replacement.id,order.id);const binding=await store.authorizeDispatch(f.token,f.owner,replacement.id);await new(load('postgres-payment-intents').PostgresPaymentIntentStore)(db).authorize(binding);
    await assert.rejects(cancellation.cancel(f.token,f.owner,{paymentId:replacement.id,targetType}),{code:'CHECKOUT_STARTED'});assert.equal((await store.readOrder(f.token,f.owner,replacement.id)).order.status,'created');assert.equal((await admin.query('select count(*)::int n from app.service_payment_terms where intent_id=any($1::uuid[])',[[order.id,replacement.id]])).rows[0].n,2);
   }
  });
  await suite.test('late fair capture never rolls to another event and owner readback explains the ended event',async()=>{
   const p=await buy(await fixture('fair'));
   await admin.query('alter table app.service_payment_terms disable trigger service_payment_terms_guard');
   try{await admin.query("update app.service_payment_terms set (fair_date,fair_ends_at)=(select event_date,ends_at from app.fair_event_at(clock_timestamp()-interval '2 months')) where intent_id=$1",[p.id]);}finally{await admin.query('alter table app.service_payment_terms enable trigger service_payment_terms_guard');}
   const before=(await admin.query('select fair_date::text date,fair_ends_at::text ends from app.service_payment_terms where intent_id=$1',[p.id])).rows[0],services=new(load('postgres-service-payment-fulfillment').PostgresServicePaymentFulfillmentStore)(db,{shopId:'service-fixture',isTest:true});
   assert.equal((await services.fulfill(p.id)).state,'blocked');assert.deepEqual(await window(p),{status:'draft',is_paid:false,published_at:null,expires_at:null});
   const read=await new(load('postgres-service-checkout').PostgresServiceCheckoutStore)(db,{shopId:'service-fixture',isTest:true,siteOrigin:'https://fixture.example.invalid',receiptVatCode:1},'fair').readOrder(p.token,p.owner,p.id);assert.equal(read.eventEnded,true);assert.equal(read.order.fairEvent.date,before.date);assert.equal(Date.parse(read.order.fairEvent.endsAt),Date.parse(before.ends));assert.equal(read.fulfillment,null);assert.equal(read.order.status,'succeeded');
  });
  await suite.test('candidate rollback refuses to erase nonempty terms or original financial history',async()=>{
   await assert.rejects(admin.query(await readFile(new URL('../database/migrations/0057-service-payment-terms.down.sql',import.meta.url),'utf8')),e=>e.code==='23514');await admin.query('rollback');
   assert.ok((await admin.query('select count(*)::int n from app.service_payment_terms')).rows[0].n>0);
  });
 }finally{
  for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}globalThis.fetch=previousFetch;if(db)await db.close();if(admin)await admin.end();
  if(container){const m=JSON.parse(await docker(['inspect',container]))[0];assert.equal(m.Config.Labels[label],name);assert.equal(m.Id,container);await docker(['rm','--force',container]);}
 }
});
