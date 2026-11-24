// Owned disposable PostgreSQL only; synthetic identities and fake provider HTTP.
import assert from 'node:assert/strict';import {test} from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,readdir} from 'node:fs/promises';import {randomBytes,randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import pg from 'pg';
import {testUnpaidDraftRemoval} from './unpaid-draft-removal-integration.mjs';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule,run=promisify(execFile);
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',name='blizhniy-checkout-cancel-'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('local checkout cancellation serializes with dispatch and preserves immutable history',{timeout:120000},async suite=>{
 let container,admin,db,ownerDb;try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label','blizhniy.checkout-cancel='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Image,image);assert.equal(meta.Config.Labels['blizhniy.checkout-cancel'],name);
  const binding=meta.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');const until=Date.now()+20000;
  for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<until);}await new Promise(resolve=>setTimeout(resolve,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};admin=new pg.Pool({...config,max:6});assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const files=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|4[0-7])-[a-z-]+\.sql$/.test(n)).sort();assert.equal(files.length,47);for(const file of files)await admin.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  await admin.query(`create role checkout_cancel_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to checkout_cancel_runtime;grant usage on schema app to checkout_cancel_runtime;
   grant select on app.users,app.sessions,app.payment_checkout_intents,app.payment_orders,app.payment_checkout_cancellations to checkout_cancel_runtime;
   grant update(id) on app.users to checkout_cancel_runtime;grant update(last_seen_at) on app.sessions to checkout_cancel_runtime;
   grant insert(payment_id) on app.payment_checkout_cancellations to checkout_cancel_runtime`);
  const {PostgresPaymentIntentStore}=load('postgres-payment-intents');const {PostgresDatabase}=load('postgres');db=new PostgresDatabase(new pg.Pool({...config,user:'checkout_cancel_runtime',max:5}));ownerDb=new PostgresDatabase(new pg.Pool({...config,max:5}));
  const {hashSessionToken}=load('identity');
  async function actor(){const id=randomUUID(),token=randomBytes(32).toString('hex'),hash=hashSessionToken(token);
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@cancel.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hash,id]);return{id,token,hash};}
  const owner=await actor(),other=await actor(),intents=new PostgresPaymentIntentStore(ownerDb);
 async function purchase({actor=owner,targetType='listing',targetId=randomUUID(),shopId='local-fixture-shop',isTest=true}={}){
   const binding={id:randomUUID(),ownerId:actor.id,targetType,targetId,targetRevision:'1',tariffId:'local-checkout',amount:'199.00',durationDays:targetType==='application'?null:30,shopId,isTest};
   const requestBody=JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType,tariffId:binding.tariffId}});
   await ownerDb.transaction(async tx=>{await intents.persistInTransaction(tx,{...binding,requestBody});await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[binding.id,actor.id,randomUUID(),targetType,binding.targetId]);});return binding;
  }
  const cancel=(actor,binding)=>db.transaction(async tx=>{await tx.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[actor.hash]);await tx.query('insert into app.payment_checkout_cancellations(payment_id) values($1) on conflict(payment_id) do nothing',[binding.id]);return(await tx.query('select owner_id,target_type,cancelled_at::text from app.payment_checkout_cancellations where payment_id=$1',[binding.id])).rows[0];});
  const status=async id=>(await admin.query('select status from app.payment_orders where id=$1',[id])).rows[0].status;
  const {PostgresCheckoutCancellation,CheckoutCancellationError}=load('postgres-checkout-cancellation'),store=new PostgresCheckoutCancellation(db);
  await suite.test('cancellation preserves original intent, releases only undispatched preparation and is exactly replayable',async()=>{
   for(const targetType of ['listing','vacancy','workRequest','application']){const binding=await purchase({targetType}),before=(await admin.query('select * from app.payment_checkout_intents where id=$1',[binding.id])).rows[0];
    const first=await cancel(owner,binding);assert.equal(await status(binding.id),'failed');assert.equal(first.owner_id,owner.id);assert.equal(first.target_type,targetType);
    assert.deepEqual(await cancel(owner,binding),first);assert.deepEqual((await admin.query('select * from app.payment_checkout_intents where id=$1',[binding.id])).rows[0],before);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_checkout_cancellations where payment_id=$1',[binding.id])).rows[0].n,1);
   }
  });
  await suite.test('a stale dispatcher binding cannot create an anchor or make a provider POST after cancellation',async()=>{
   const binding=await purchase();await cancel(owner,binding);let calls=0;
   const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(ownerDb,{shopId:'local-fixture-shop',isTest:true,secretKey:'test_fixture_only'},async()=>{calls++;throw Error('Provider must not be called');});
   await assert.rejects(dispatcher.dispatch(binding),{code:'PCA02'});assert.equal(calls,0);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rows[0].n,0);
  });
  await suite.test('a changed tariff rejects dispatch without committing an anchor and the owner can still cancel',async()=>{
   const binding=await purchase(),input={paymentId:binding.id,targetType:binding.targetType};
   await admin.query("insert into app.tariffs(id,action,name,price,duration_days,active) values($1,'listing_publication','Тестовый тариф',199,30,true)",[binding.tariffId]);
   await admin.query('update app.tariffs set price=249.51 where id=$1',[binding.tariffId]);
   let calls=0;
   const {withAppSessionTransaction}=load('app-session-transaction');
   const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(ownerDb,
    {shopId:binding.shopId,isTest:true,secretKey:'test_fixture_only'},async()=>{calls++;throw Error('Provider must not be called');});
   const refuse=Error('Current tariff differs');
   await assert.rejects(dispatcher.dispatch(binding,work=>withAppSessionTransaction(ownerDb,owner.token,async tx=>{
    const permitted=await work(tx);
    const price=(await tx.query('select price::text from app.tariffs where id=$1',[binding.tariffId])).rows[0].price;
    if(price!==binding.amount)throw refuse;
    return permitted;
   })),error=>error===refuse);
   assert.equal(calls,0);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rows[0].n,0);
   assert.equal(await status(binding.id),'created');
   assert.deepEqual(await store.cancel(owner.token,owner.id,input),{...input,state:'cancelled'});
   assert.equal((await admin.query('select amount::text from app.payment_checkout_intents where id=$1',[binding.id])).rows[0].amount,'199.00');
  });
  await suite.test('refusing a later attempt keeps the anchor when the first POST may have reached the provider',async()=>{
   const binding=await purchase(),input={paymentId:binding.id,targetType:binding.targetType};
   const refuse=Error('Current admission has changed');
   const {withAppSessionTransaction}=load('app-session-transaction');
   let calls=0;
   const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(ownerDb,
    {shopId:binding.shopId,isTest:true,secretKey:'test_fixture_only'},async(_url,init)=>{
     assert.equal(init.method,'POST');
     assert.equal(init.headers['Idempotence-Key'],binding.id);
     calls++;
     return Response.json({},{status:503});
    });
   await assert.rejects(dispatcher.dispatch(binding,work=>withAppSessionTransaction(ownerDb,owner.token,async tx=>{
    const permitted=await work(tx);
    if(calls>0)throw refuse;
    return permitted;
   })),error=>error===refuse);
   assert.equal(calls,1);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_dispatch_anchors where intent_id=$1',[binding.id])).rows[0].n,1);
   await assert.rejects(store.cancel(owner.token,owner.id,input),{code:'CHECKOUT_STARTED'});
   assert.equal(await status(binding.id),'created');
  });
  await suite.test('the actual owner store binds owner/type, recovers lost COMMIT acknowledgement and refuses expired authority',async()=>{
   const binding=await purchase(),input={paymentId:binding.id,targetType:binding.targetType};assert.equal(await store.read(owner.token,owner.id,input),null);
   await assert.rejects(store.cancel(other.token,other.id,input),error=>error.code==='CHECKOUT_NOT_FOUND');
   await assert.rejects(store.cancel(owner.token,other.id,input),error=>error.name==='AppSessionAccessError');
   await assert.rejects(store.cancel(owner.token,owner.id,{...input,targetType:'vacancy'}),error=>error.code==='CHECKOUT_NOT_FOUND');
   let lost=true;const unreliable=new PostgresCheckoutCancellation({transaction:async work=>{const result=await db.transaction(work);if(lost){lost=false;throw Error('Synthetic lost COMMIT acknowledgement');}return result;}});
   await assert.rejects(unreliable.cancel(owner.token,owner.id,input),/Synthetic lost COMMIT/);
   const expected={...input,state:'cancelled'};assert.deepEqual(await store.read(owner.token,owner.id,input),expected);assert.deepEqual(await store.cancel(owner.token,owner.id,input),expected);
   const expired=await actor(),expiredBinding=await purchase({actor:expired});await admin.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[expired.hash]);
   await assert.rejects(store.cancel(expired.token,expired.id,{paymentId:expiredBinding.id,targetType:'listing'}),error=>error.name==='AppSessionAccessError');assert.equal(await status(expiredBinding.id),'created');
  });
  await suite.test('the SQL boundary refuses foreign owner, merchant, LIVE and unsupported service independently of TypeScript',async()=>{
   const own=await purchase();await assert.rejects(cancel(other,own),{code:'PCA01'});
   for(const options of [{shopId:'other-shop'},{isTest:false},{targetType:'specialist'},{targetType:'fair_application'},{targetType:'ad_marquee'}]){
    const binding=await purchase(options);await assert.rejects(cancel(owner,binding),{code:'PCA01'});assert.equal(await status(binding.id),'created');
   }
   await assert.rejects(db.query('insert into app.payment_checkout_cancellations(payment_id) values($1)',[own.id]),{code:'PCA03'});
  });
  await suite.test('any committed anchor including an unknown POST outcome prevents cancellation',async()=>{
   const binding=await purchase();assert.equal((await intents.authorize(binding)).decision,'post');
   await assert.rejects(cancel(owner,binding),{code:'PCA02'});assert.equal(await status(binding.id),'created');
   assert.equal((await admin.query('select count(*)::int as n from app.payment_checkout_cancellations where payment_id=$1',[binding.id])).rows[0].n,0);
   for(const next of ['pending','succeeded','failed','refunded']){const b=await purchase();if(next==='refunded')await admin.query("update app.payment_orders set status='succeeded' where id=$1",[b.id]);await admin.query('update app.payment_orders set status=$2 where id=$1',[b.id,next]);await assert.rejects(cancel(owner,b),{code:'PCA02'});assert.equal(await status(b.id),next);}
  });
  await suite.test('rollback after cancellation effect preserves the active order and permits ordinary dispatch',async()=>{
   const binding=await purchase(),broken=new PostgresCheckoutCancellation({transaction:work=>db.transaction(async tx=>{await work(tx);throw Error('Synthetic failure before commit');})});
   await assert.rejects(broken.cancel(owner.token,owner.id,{paymentId:binding.id,targetType:'listing'}),/Synthetic failure/);
   assert.equal(await status(binding.id),'created');assert.equal(await store.read(owner.token,owner.id,{paymentId:binding.id,targetType:'listing'}),null);
   const provider=randomUUID(),calls=[];const dispatcher=load('primary-payment-dispatch').createPrimaryPaymentDispatcher(ownerDb,{shopId:'local-fixture-shop',isTest:true,secretKey:'test_fixture_only'},async(url,init)=>{calls.push([url,init.method,init.headers['Idempotence-Key']]);return Response.json({id:provider,status:'pending',paid:false,test:true,recipient:{account_id:binding.shopId},amount:{value:binding.amount,currency:'RUB'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});});
   assert.equal((await dispatcher.dispatch(binding)).providerPaymentId,provider);assert.deepEqual(calls,[['https://api.yookassa.ru/v3/payments','POST',binding.id]]);
  });
  await suite.test('cancellation winning the intent lock is visible to a dispatcher waiting on an older snapshot',async()=>{
   const binding=await purchase(),locker=await admin.connect();let running,pid;let announce;const started=new Promise(resolve=>announce=resolve);
   const waitingDb={transaction:work=>ownerDb.transaction(async tx=>{pid=(await tx.query('select pg_backend_pid() as pid')).rows[0].pid;announce();return work(tx);})};
   try{await locker.query('begin');await locker.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[owner.hash]);await locker.query('insert into app.payment_checkout_cancellations(payment_id) values($1)',[binding.id]);
    running=new PostgresPaymentIntentStore(waitingDb).authorize(binding);running.catch(()=>{});await started;const deadline=Date.now()+3000;
    for(;;){if((await admin.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)break;assert.ok(Date.now()<deadline,'Dispatch did not reach intent lock barrier');await new Promise(resolve=>setTimeout(resolve,10));}
    await locker.query('commit');await assert.rejects(running,{code:'PCA02'});assert.equal(await status(binding.id),'failed');
   }finally{await locker.query('rollback');await running?.catch(()=>{});locker.release();}
  });
  await suite.test('dispatch winning the intent lock makes cancellation fail busy, then refuse without changing its order',async()=>{
   const binding=await purchase(),locker=await admin.connect(),input={paymentId:binding.id,targetType:'listing'};
   try{await locker.query('begin');await locker.query('select id from app.payment_checkout_intents where id=$1 for update',[binding.id]);await locker.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[binding.id]);
    await assert.rejects(store.cancel(owner.token,owner.id,input),error=>error instanceof CheckoutCancellationError&&error.code==='CHECKOUT_BUSY');await locker.query('commit');
    await assert.rejects(store.cancel(owner.token,owner.id,input),error=>error.code==='CHECKOUT_STARTED');assert.equal(await status(binding.id),'created');assert.equal(await store.read(owner.token,owner.id,input),null);
   }finally{await locker.query('rollback');locker.release();}
  });
  await suite.test('expired authority after a user-row wait is rechecked and cannot change the order',async()=>{
   const actor1=await actor(),binding=await purchase({actor:actor1}),locker=await admin.connect();let running,pid;let announce;const started=new Promise(resolve=>announce=resolve);
   const waiting=new PostgresCheckoutCancellation({transaction:work=>db.transaction(async tx=>{pid=(await tx.query('select pg_backend_pid() as pid')).rows[0].pid;announce();return work(tx);})});
   try{await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[actor1.id]);running=waiting.cancel(actor1.token,actor1.id,{paymentId:binding.id,targetType:'listing'});running.catch(()=>{});await started;
    const deadline=Date.now()+3000;for(;;){if((await admin.query("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)break;assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
    await locker.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[actor1.hash]);await locker.query('commit');await assert.rejects(running,error=>error.name==='AppSessionAccessError');assert.equal(await status(binding.id),'created');
   }finally{await locker.query('rollback');await running?.catch(()=>{});locker.release();}
  });
  await suite.test('cancellation history and financial authority cannot be rewritten or forged by the runtime',async()=>{
   const binding=await purchase();await cancel(owner,binding);
   for(const sql of ['update app.payment_orders set status=\'failed\' where false','delete from app.payment_checkout_cancellations where payment_id=$1','update app.payment_checkout_cancellations set cancelled_at=clock_timestamp() where payment_id=$1','truncate app.payment_checkout_cancellations','alter table app.payment_dispatch_anchors disable trigger all'])await assert.rejects(db.query(sql,sql.includes('$1')?[binding.id]:[]),{code:'42501'});
   await assert.rejects(admin.query('delete from app.payment_checkout_cancellations where payment_id=$1',[binding.id]),{code:'42501'});
   await assert.rejects(admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[binding.id]),{code:'PCA02'});
   assert.equal((await admin.query("select has_function_privilege('public','app.apply_checkout_cancellation()','execute') as allowed")).rows[0].allowed,false);
  });
  await suite.test('repeatable read cannot hide either a cancellation or dispatch anchor',async()=>{
   const binding=await purchase(),client=await admin.connect();
   try{await client.query('begin isolation level repeatable read');await client.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[owner.hash]);
    await assert.rejects(client.query('insert into app.payment_checkout_cancellations(payment_id) values($1)',[binding.id]),{code:'PCA04'});
    await client.query('rollback');await client.query('begin isolation level repeatable read');await assert.rejects(client.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[binding.id]),{code:'PCA04'});
   }finally{await client.query('rollback');client.release();}
   assert.equal(await status(binding.id),'created');
  });
  await suite.test('the sparse manual schema accepts the additive journal without refund migrations',async()=>{
   await admin.query('create database checkout_cancel_sparse');const pool=new pg.Pool({...config,database:'checkout_cancel_sparse'}),sparse=new PostgresDatabase(pool);
   try{const names=files.filter(file=>Number(file.slice(0,4))<=35||[41,44,46,47].includes(Number(file.slice(0,4))));assert.equal(names.length,39);
    for(const file of names)await pool.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
    assert.equal((await pool.query("select to_regclass('app.payment_refund_effects') as name")).rows[0].name,null);
    const identity=randomUUID(),hash=randomBytes(32).toString('hex'),payment=randomUUID(),target=randomUUID();
    await pool.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[identity,'sparse@cancel.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
    await pool.query("insert into app.sessions(token_hash,user_id,scope,auth_version) values($1,$2,'app',0)",[hash,identity]);
    const body=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata:{localPaymentId:payment,targetId:target,targetType:'listing',tariffId:'local-checkout'}});
    await sparse.transaction(async tx=>{await new PostgresPaymentIntentStore(sparse).persistInTransaction(tx,{id:payment,ownerId:identity,targetType:'listing',targetId:target,targetRevision:'1',tariffId:'local-checkout',amount:'199.00',durationDays:30,shopId:'local-fixture-shop',isTest:true,requestBody:body});await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,1)",[payment,identity,randomUUID(),target]);
     await tx.query("select set_config('blizhniy.checkout_cancel_session',$1,true)",[hash]);await tx.query('insert into app.payment_checkout_cancellations(payment_id) values($1)',[payment]);});
    assert.equal((await pool.query('select status from app.payment_orders where id=$1',[payment])).rows[0].status,'failed');
    await assert.rejects(new PostgresPaymentIntentStore(sparse).authorize({id:payment,ownerId:identity,targetType:'listing',targetId:target,targetRevision:'1',tariffId:'local-checkout',amount:'199.00',durationDays:30,shopId:'local-fixture-shop',isTest:true}),{code:'PCA02'});
   }finally{await sparse.close();}
  });
  await testUnpaidDraftRemoval(suite,{admin,config,owner,other,purchase,intents,cancel,load});
 }finally{await db?.close();await ownerDb?.close();await admin?.end();if(container){const meta=JSON.parse(await docker(['inspect',container]))[0];assert.equal(meta.Id,container);assert.equal(meta.Config.Labels['blizhniy.checkout-cancel'],name);await docker(['rm','--force','--volumes',container]);}}
});
