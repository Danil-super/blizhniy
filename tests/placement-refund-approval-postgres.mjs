// Disposable synthetic PG18. No dotenv, persistent stand or real provider calls.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-refund-approval-'+randomBytes(8).toString('hex'),label='blizhniy.refund-approval',password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('full TEST placement refund: durable authenticated administrator approval',{timeout:120000},async suite=>{
 const migration=await readFile(new URL('../database/migrations/0042-placement-refund-approvals.sql',import.meta.url),'utf8');
 const {PostgresDatabase}=load('postgres'),{hashSessionToken}=load('identity'),{PostgresPaymentIntentStore}=load('postgres-payment-intents');
 const {PostgresRefundApprovalStore}=load('postgres-refund-approvals');
 const merchant={shopId:'refund-approval-fixture',isTest:true,secretKey:'test_synthetic_only'};
 let container,admin,db,ownerDb;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Image,image);assert.equal(metadata.Config.Labels[label],name);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const end=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<end);}await new Promise(r=>setTimeout(r,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  admin=new pg.Pool({...config,max:5});assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const names=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|4[01])-[a-z-]+\.sql$/.test(n)).sort();assert.equal(names.length,41);
  for(const n of names)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  await admin.query(migration);
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых')");
  await admin.query(`create role refund_approval_operator login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to refund_approval_operator;grant usage on schema app to refund_approval_operator;
   grant select on app.users,app.sessions,app.payment_checkout_intents,app.payment_orders,app.payment_provider_links,app.payment_verifications,app.payment_refund_approvals to refund_approval_operator;
   grant update(id) on app.users,app.payment_checkout_intents,app.payment_orders to refund_approval_operator;grant update(last_seen_at) on app.sessions to refund_approval_operator;
   grant insert(id,payment_intent_id,reason) on app.payment_refund_approvals to refund_approval_operator`);
  db=new PostgresDatabase(new pg.Pool({...config,user:'refund_approval_operator',password,max:5}));ownerDb=new PostgresDatabase(new pg.Pool({...config,max:5}));
  const store=new PostgresRefundApprovalStore(db,merchant),users=[];
  for(const role of ['admin','admin','user']){
   const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});
   await admin.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',[id,id+'@approval.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  }
  const [operator,other,ordinary]=users;
  async function purchase({receipt=false,succeeded=true,capturedAt:capturedOverride=null}={}){
   const targetId=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at) select $1,'sell',c.id,city.id,'Синтетическая публикация','Синтетическое описание для проверки возврата.','+79990000000',clock_timestamp()-interval '2 minutes' from app.categories c cross join app.cities city returning id",[ordinary.id])).rows[0].id;
   const id=randomUUID(),providerPaymentId=randomUUID(),binding={id,ownerId:ordinary.id,targetType:'listing',targetId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:merchant.shopId,isTest:true};
   const metadata={localPaymentId:id,targetId,targetType:'listing',tariffId:binding.tariffId};
   const requestBody=JSON.stringify({amount:{value:'199.00',currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://fixture.example.invalid/return'},metadata,...(receipt?{receipt:{customer:{email:'receipt@example.invalid'},internet:true,items:[{description:'Размещение',quantity:1,amount:{value:'199.00',currency:'RUB'},vat_code:1,payment_mode:'full_payment',payment_subject:'service'}]}}:{})});
   await ownerDb.transaction(async tx=>{
    await new PostgresPaymentIntentStore(ownerDb).persistInTransaction(tx,{...binding,requestBody});
    await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',[id,ordinary.id,randomUUID(),'listing',targetId]);
    await tx.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[id]);await tx.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[id,providerPaymentId]);
   });
   const capturedAt=capturedOverride??new Date(Date.now()-60000).toISOString();if(succeeded){await admin.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerPaymentId,capturedAt]);}
   return{...binding,requestBody,providerPaymentId,capturedAt,metadata};
  }
  const proposal=item=>({id:randomUUID(),paymentIntentId:item.id,reason:'Ошибочное размещение по обращению владельца.'});
  await suite.test('only a current administrator may approve a full captured TEST placement; original fiscal mode is derived',async()=>{
   for(const receipt of [false,true]){
    const item=await purchase({receipt}),input=proposal(item);
    await assert.rejects(store.approve(ordinary.token,ordinary.id,input),{name:'RefundApprovalAccessError'});
    await assert.rejects(store.approve(operator.token,ordinary.id,input),{name:'RefundApprovalAccessError'});
    const saved=await store.approve(operator.token,operator.id,input);
    assert.equal(saved.id,input.id);assert.equal(saved.paymentIntentId,item.id);assert.equal(saved.approvedBy,operator.id);assert.equal(saved.amount,item.amount);assert.equal(saved.fiscalMode,receipt?'provider-automatic-full':'test-without-receipt');
    assert.deepEqual(await store.approve(operator.token,operator.id,input),saved);
    await assert.rejects(store.approve(other.token,other.id,input),{name:'RefundApprovalConflictError'});
    await assert.rejects(store.approve(operator.token,operator.id,{...input,reason:'Другая причина.'}),{name:'RefundApprovalConflictError'});
    await assert.rejects(store.approve(operator.token,operator.id,{...input,id:randomUUID()}),{name:'RefundApprovalConflictError'});
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_reservations where payment_intent_id=$1',[item.id])).rows[0].n,0);
   }
  });
  await suite.test('unconfirmed purchase, wrong merchant, blocked admin and mismatched session never record approval',async()=>{
   const item=await purchase({succeeded:false});await assert.rejects(store.approve(operator.token,operator.id,proposal(item)));
   const captured=await purchase();await assert.rejects(new PostgresRefundApprovalStore(db,{...merchant,shopId:'different'}).approve(operator.token,operator.id,proposal(captured)));
   await admin.query('update app.users set is_blocked=true where id=$1',[operator.id]);try{await assert.rejects(store.approve(operator.token,operator.id,proposal(captured)),{name:'RefundApprovalAccessError'});}finally{await admin.query('update app.users set is_blocked=false where id=$1',[operator.id]);}
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where payment_intent_id=any($1::uuid[])',[[item.id,captured.id]])).rows[0].n,0);
  });
  await suite.test('approval cannot mutate payment truth, history or its actor and timestamps',async()=>{
   for(const sql of ["update app.payment_orders set status='refunded' where false","update app.payment_checkout_intents set amount=0 where false","delete from app.payment_refund_approvals where false","update app.payment_refund_approvals set reason='changed' where false","insert into app.payment_refund_reservations default values","insert into app.payment_refund_approvals(id,payment_intent_id,reason,approved_by) values(gen_random_uuid(),gen_random_uuid(),'bad',gen_random_uuid())"]){await assert.rejects(db.query(sql),{code:'42501'});}
  });
  await suite.test('lost approval COMMIT acknowledgement is recovered by the same case and never creates a reservation',async()=>{
   const item=await purchase(),input=proposal(item);let commits=0;
   const uncertain=new PostgresRefundApprovalStore({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost acknowledgement');}},merchant);
   await assert.rejects(uncertain.approve(operator.token,operator.id,input));assert.equal(commits,1);
   const saved=await store.readForAdmin(operator.token,operator.id,input.id);assert.equal(saved.reason,input.reason);assert.deepEqual(await store.approve(operator.token,operator.id,input),saved);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_reservations where payment_intent_id=$1',[item.id])).rows[0].n,0);
  });
  await suite.test('independent SQL guard refuses missing or nonadministrator session context',async()=>{
   const item=await purchase(),input=proposal(item);
   await assert.rejects(db.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]),{code:'42501'});
   await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(ordinary.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}),{code:'42501'});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
  });
  await suite.test('payer row is acquired NOWAIT, preventing cross-account authorization deadlock',async()=>{
   const item=await purchase(),input=proposal(item),locker=await admin.connect();
   try{await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[ordinary.id]);
    await assert.rejects(store.approve(operator.token,operator.id,input),{name:'RefundApprovalBusyError'});
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
   }finally{await locker.query('rollback');locker.release();}
   assert.equal((await store.approve(operator.token,operator.id,input)).id,input.id);
  });
  await suite.test('SQL approval guard rechecks administrator session after a real financial row-lock wait',async()=>{
   const item=await purchase(),input=proposal(item),token=randomBytes(32).toString('hex'),locker=await admin.connect();
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '700 milliseconds')",[hashSessionToken(token),operator.id]);
   try{
    await locker.query('begin');await locker.query('select id from app.payment_checkout_intents where id=$1 for update',[item.id]);
    const outcome=db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(token)]);return tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}).then(value=>({value}),error=>({error}));
    const deadline=Date.now()+2500;let waiting=false;while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='refund_approval_operator' and wait_event_type='Lock' and query like 'insert into app.payment_refund_approvals%') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,15));}
    assert.equal(waiting,true);await locker.query('select pg_sleep(0.8)');await locker.query('commit');const result=await outcome;assert.equal(result.error?.code,'42501');
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
   }finally{await locker.query('rollback');locker.release();}
  });
  await suite.test('a coherent checksum does not admit a malformed original receipt through either store or direct SQL',async()=>{
   const item=await purchase({receipt:true}),input=proposal(item),body=JSON.parse(item.requestBody);body.receipt=null;
   await admin.query('alter table app.payment_checkout_intents disable trigger user');
   try{await admin.query("update app.payment_checkout_intents set request_body=$2,request_sha256=encode(sha256(convert_to($2,'UTF8')),'hex') where id=$1",[item.id,JSON.stringify(body)]);}
   finally{await admin.query('alter table app.payment_checkout_intents enable trigger user');}
   await assert.rejects(store.approve(operator.token,operator.id,input));
   await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(operator.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}),{code:'23514'});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
  });
  await suite.test('direct SQL rejects Unicode-only whitespace, bidi controls and reasons above the UTF16 field budget',async()=>{
   for(const reason of ['\u00a0','\u2003','\ufeff','Причина\u202e','😀'.repeat(251)]){
    const item=await purchase(),id=randomUUID();
    await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(operator.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[id,item.id,reason]);}),{code:'23514'});
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[id])).rows[0].n,0);
   }
  });
  await suite.test('a coherent historical source with a non-HTTPS return URL cannot create a direct SQL approval',async()=>{
   const item=await purchase(),input=proposal(item),body=JSON.parse(item.requestBody);body.confirmation.return_url='javascript:invalid';
   await admin.query('alter table app.payment_checkout_intents disable trigger user');
   try{await admin.query("update app.payment_checkout_intents set request_body=$2,request_sha256=encode(sha256(convert_to($2,'UTF8')),'hex') where id=$1",[item.id,JSON.stringify(body)]);}
   finally{await admin.query('alter table app.payment_checkout_intents enable trigger user');}
   await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(operator.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}),{code:'23514'});
  });
  await suite.test('an original capture outside provider clock tolerance is rejected by store and independent SQL',async()=>{
   const item=await purchase({capturedAt:new Date(Date.now()+6*60000).toISOString()}),input=proposal(item);
   await assert.rejects(store.approve(operator.token,operator.id,input));
   await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(operator.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}),{code:'23514'});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_approvals where id=$1',[input.id])).rows[0].n,0);
  });
  await suite.test('independent SQL matches UTF16 limits on original URL, descriptions and receipt email',async()=>{
   const mutations=[body=>{body.confirmation.return_url='https://fixture.example.invalid/'+'😀'.repeat(1020);},body=>{body.description='😀'.repeat(65);},body=>{body.receipt.items[0].description='😀'.repeat(65);},body=>{body.receipt.customer.email='😀'.repeat(125)+'@fixture.invalid';}];
   for(const mutate of mutations){
    const item=await purchase({receipt:true}),input=proposal(item),body=JSON.parse(item.requestBody);mutate(body);
    await admin.query('alter table app.payment_checkout_intents disable trigger user');
    try{await admin.query("update app.payment_checkout_intents set request_body=$2,request_sha256=encode(sha256(convert_to($2,'UTF8')),'hex') where id=$1",[item.id,JSON.stringify(body)]);}
    finally{await admin.query('alter table app.payment_checkout_intents enable trigger user');}
    await assert.rejects(store.approve(operator.token,operator.id,input));
    await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('blizhniy.refund_approval_session',$1,true)",[hashSessionToken(operator.token)]);await tx.query('insert into app.payment_refund_approvals(id,payment_intent_id,reason) values($1,$2,$3)',[input.id,item.id,input.reason]);}),{code:'23514'});
   }
  });
  await suite.test('approved full refund composes original preparation, mocked provider, GET journal and once-only placement effect',async()=>{
   const {createApprovedPlacementRefundProcessor}=load('primary-approved-placement-refund');
   const {PostgresListingPaymentFulfillmentStore}=load('postgres-listing-payment-fulfillment');
   for(const receipt of [false,true]){
    const item=await purchase({receipt});const fulfillment=await new PostgresListingPaymentFulfillmentStore(ownerDb,merchant,{postmoderation:true}).fulfill(item.id);assert.equal(fulfillment.state,'fulfilled');
    const input=proposal(item),approval=await store.approve(operator.token,operator.id,input),providerRefundId=randomUUID(),calls=[];
    const refund={id:providerRefundId,payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',created_at:new Date().toISOString(),metadata:{localRefundId:approval.id,localPaymentId:item.id}};
    const fetcher=async(value,init)=>{
     const url=String(value);calls.push({url,method:init.method});assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
     if(init.method==='POST'){
      assert.equal(url,'https://api.yookassa.ru/v3/refunds');assert.equal(init.headers['Idempotence-Key'],'refund-'+approval.id);
      assert.deepEqual(JSON.parse(init.body),{payment_id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},metadata:{localRefundId:approval.id,localPaymentId:item.id}});return Response.json(refund);
     }
     assert.equal(init.method,'GET');
     if(url==='https://api.yookassa.ru/v3/payments/'+item.providerPaymentId)return Response.json({id:item.providerPaymentId,amount:{value:item.amount,currency:'RUB'},status:'succeeded',paid:true,test:true,refundable:true,captured_at:item.capturedAt,recipient:{account_id:merchant.shopId},metadata:item.metadata});
     if(url==='https://api.yookassa.ru/v3/refunds?payment_id='+item.providerPaymentId+'&limit=100')return Response.json({type:'list',items:[]});
     assert.equal(url,'https://api.yookassa.ru/v3/refunds/'+providerRefundId);return Response.json(refund);
    };
    const processor=createApprovedPlacementRefundProcessor(ownerDb,merchant,fetcher);
    const result=await processor.process(approval.id);assert.equal(result.state,'applied');assert.equal(result.effect.effect,'revoked');
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[item.id])).rows[0].status,'refunded');
    assert.equal((await admin.query('select status from app.listings where id=$1',[item.targetId])).rows[0].status,'archived');
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.deepEqual(await store.approve(operator.token,operator.id,input),approval);
    const again=await processor.process(approval.id);assert.equal(again.state,'applied');assert.equal(calls.filter(c=>c.method==='POST').length,1);
    await admin.query('alter table app.payment_refund_dispatch_anchors disable trigger user');
    try{await admin.query("update app.payment_refund_dispatch_anchors set authorized_at=clock_timestamp()-interval '25 hours' where operation_id=$1",[approval.id]);}
    finally{await admin.query('alter table app.payment_refund_dispatch_anchors enable trigger user');}
    const beforeRecovery=calls.length;assert.equal((await processor.process(approval.id)).state,'applied');assert.ok(calls.length>beforeRecovery);assert.ok(calls.slice(beforeRecovery).every(c=>c.method==='GET'));assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_refund_effects where operation_id=$1',[approval.id])).rows[0].n,1);
   }
  });
  await suite.test('a legacy reservation under another operation key blocks admission to dispatch; no provider call is made',async()=>{
   const {createApprovedPlacementRefundProcessor}=load('primary-approved-placement-refund'),{PostgresPlacementRefundReservationStore}=load('postgres-placement-refund-reservations');
   const item=await purchase(),legacy=randomUUID();await new PostgresPlacementRefundReservationStore(ownerDb,merchant).reserve(item.id,legacy);
   const approval=await store.approve(operator.token,operator.id,proposal(item));let calls=0;
   const processor=createApprovedPlacementRefundProcessor(ownerDb,merchant,async()=>{calls++;throw Error('Provider must not run');});
   await assert.rejects(processor.process(approval.id),{name:'RefundApprovalAccessError'});assert.equal(calls,0);
   await assert.rejects(processor.process(randomUUID()),{name:'RefundApprovalAccessError'});assert.equal(calls,0);
   assert.equal((await admin.query('select id from app.payment_refund_reservations where payment_intent_id=$1',[item.id])).rows[0].id,legacy);
  });
 }finally{
  await Promise.allSettled([db?.close(),ownerDb?.close(),admin?.end()]);
  if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',container]);}
 }
});
