import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';
import {PostgresPaymentReconciliationQueue} from '../src/lib/postgres-payment-reconciliation.ts';
import * as verification from '../src/lib/postgres-payment-verification.ts';
import * as intentModule from '../src/lib/postgres-payment-intents.ts';import * as period from '../src/lib/payment-publication-period.ts';
import {createPrimaryPaymentWebhook} from '../src/lib/primary-payment-webhook.ts';import {formModule} from './listing-form-module.mjs';
import {runPaymentReconciliationService} from '../scripts/payment-reconciliation-service.mjs';

export async function testPaymentReconciliation(suite,admin,config){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`,options={includePaymentReconciliation:true};
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const down=readFileSync(new URL('../database/migrations/0023-payment-reconciliation.down.sql',import.meta.url),'utf8');
 await suite.test('reconciliation queue applies only explicitly, preserves22 prior hashes, grants nothing and has an empty-only down',async()=>{
  assert.equal(before.length,22);assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
  assert.deepEqual(getBootstrapPlan(options).slice(0,22).map(({name,sha256})=>({name,sha256})),before);
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,0);
  assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_reconciliation_jobs','SELECT,INSERT,UPDATE,DELETE') as allowed")).rows[0].allowed,false);
  await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0023-payment-reconciliation.sql'");
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
 });
 const merchant={shopId:'reconciliation-fixture',isTest:true},db=new PostgresDatabase(new pg.Pool({...config,max:4}));
 const queue=new PostgresPaymentReconciliationQueue(db,merchant),intents=new PostgresPaymentIntentStore(db);
 const make=async(patch={})=>{
  const b={id:randomUUID(),ownerId:randomUUID(),targetType:'listing',targetId:randomUUID(),targetRevision:'1',tariffId:'listing-publication',amount:'199.99',durationDays:30,...merchant,...patch};
  const requestBody=JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId}});
  await db.transaction(async tx=>{await intents.persistInTransaction(tx,{...b,requestBody});await tx.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6)',[b.id,b.ownerId,randomUUID(),b.targetType,b.targetId,b.targetRevision]);});
  await intents.authorize(b);const providerId=randomUUID();await intents.bindProvider(b,providerId);return{b,providerId};
 };
 const row=async id=>(await admin.query('select to_jsonb(q) as value from app.payment_reconciliation_jobs q where intent_id=$1',[id])).rows[0]?.value;
 try{
  await suite.test('isolated ingress can only enqueue known IDs, claimant can only lease queue rows, neither can write finance or read payer receipts',async()=>{
   const producerRole='payment_reconciliation_ingress_fixture',workerRole='payment_reconciliation_claim_fixture',password=randomUUID();
   await admin.query(`create role ${producerRole} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    create role ${workerRole} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
    grant connect on database blizhniy_test to ${producerRole},${workerRole};grant usage on schema app to ${producerRole},${workerRole};
    grant select(id,merchant_shop_id,is_test,target_type) on app.payment_checkout_intents to ${producerRole},${workerRole};
    grant select(intent_id,provider_payment_id) on app.payment_provider_links to ${producerRole};
    grant select(intent_id),insert(intent_id) on app.payment_reconciliation_jobs to ${producerRole};
    grant select,update(state,attempts,claim_id,lease_until,next_attempt_at,last_code) on app.payment_reconciliation_jobs to ${workerRole}`);
   const ingressDb=new PostgresDatabase(new pg.Pool({...config,user:producerRole,password,max:2})),workerDb=new PostgresDatabase(new pg.Pool({...config,user:workerRole,password,max:2}));
   try{
    const f=await make(),ingress=new PostgresPaymentReconciliationQueue(ingressDb,merchant),claimant=new PostgresPaymentReconciliationQueue(workerDb,merchant);
    assert.equal(await ingress.enqueue(f.providerId),true);assert.equal(await ingress.enqueue(f.providerId),true);await assert.rejects(ingress.claim(),{code:'42501'});
    await assert.rejects(ingressDb.query('select state from app.payment_reconciliation_jobs limit 0'),{code:'42501'});
    const claim=await claimant.claim();assert.equal(claim.intentId,f.b.id);assert.equal(await claimant.finish(claim,'completed'),true);
    for(const conn of [ingressDb,workerDb])for(const sql of ['select request_body from app.payment_checkout_intents limit 0',"update app.payment_orders set status='succeeded' where false",'select * from app.users limit 0',"update app.listings set is_paid=true where false",'delete from app.payment_reconciliation_jobs where false'])await assert.rejects(conn.query(sql),{code:'42501'});
   }finally{await ingressDb.close();await workerDb.close();}
  });
  await suite.test('unknown/wrong-merchant/mode IDs cannot enqueue; duplicates persist one job without changing receipt or financial status',async()=>{
   assert.equal(await queue.enqueue(randomUUID()),false);
   const nonListing=await make({targetType:'vacancy'});assert.equal(await queue.enqueue(nonListing.providerId),false);
   const f=await make();assert.equal(await new PostgresPaymentReconciliationQueue(db,{...merchant,shopId:'wrong'}).enqueue(f.providerId),false);
   assert.equal(await new PostgresPaymentReconciliationQueue(db,{...merchant,isTest:false}).enqueue(f.providerId),false);
   const original=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[f.b.id])).rows[0].request_body;
   assert.deepEqual(await Promise.all([queue.enqueue(f.providerId),queue.enqueue(f.providerId)]),[true,true]);
   assert.equal((await row(f.b.id)).state,'queued');assert.equal((await row(f.b.id)).attempts,0);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_reconciliation_jobs where intent_id=$1',[f.b.id])).rows[0].n,1);
   assert.equal((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[f.b.id])).rows[0].request_body,original);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[f.b.id])).rows[0].status,'created');
   const claim=await queue.claim();assert.equal(claim.intentId,f.b.id);assert.equal(await queue.finish(claim,'completed'),true);
   const completed=await row(f.b.id);assert.equal(await queue.enqueue(f.providerId),true);assert.deepEqual(await row(f.b.id),completed);assert.equal((await row(f.b.id)).state,'completed');assert.equal(await queue.claim(),null);
  });
  await suite.test('parallel workers claim different jobs, retry uses SQL time/backoff, expired owners cannot acknowledge a reclaimed lease',async()=>{
   const a=await make(),b=await make();await queue.enqueue(a.providerId);await queue.enqueue(b.providerId);
   const claims=await Promise.all([queue.claim(),queue.claim()]);assert.equal(new Set(claims.map(value=>value.intentId)).size,2);assert.equal(await queue.claim(),null);
   const [first,second]=claims,firstFixture=[a,b].find(value=>value.b.id===first.intentId),leased=await row(first.intentId);
   await queue.enqueue(firstFixture.providerId);assert.deepEqual(await row(first.intentId),leased);
   assert.equal(await queue.owns(first),true);assert.equal(await queue.finish(first,'retry','provider_pending'),true);
   const retry=await row(first.intentId);assert.equal(retry.state,'queued');assert.equal(retry.attempts,1);
   await queue.enqueue(firstFixture.providerId);assert.deepEqual(await row(first.intentId),retry);
   assert.equal((await admin.query("select next_attempt_at>clock_timestamp()+interval '20 seconds' as delayed from app.payment_reconciliation_jobs where intent_id=$1",[first.intentId])).rows[0].delayed,true);
   assert.equal(await queue.claim(),null);await admin.query("update app.payment_reconciliation_jobs set lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[second.intentId]);
   assert.equal(await queue.owns(second),false);const replacement=await queue.claim();assert.equal(replacement.intentId,second.intentId);assert.notEqual(replacement.claimId,second.claimId);
   assert.equal(await queue.finish(second,'completed'),false);assert.equal(await queue.finish(replacement,'completed'),true);
   await admin.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where intent_id=$1",[first.intentId]);
   const next=await queue.claim();assert.equal(next.intentId,first.intentId);assert.equal(await queue.finish(next,'blocked','publication_blocked'),true);
   const blocked=await row(first.intentId);await queue.enqueue(firstFixture.providerId);assert.deepEqual(await row(first.intentId),blocked);
  });
  await suite.test('unknown claim COMMIT waits for the lease, and crashed final attempts become durable blocked work rather than disappear',async()=>{
   const f=await make();await queue.enqueue(f.providerId);let commits=0;
   const uncertain=new PostgresPaymentReconciliationQueue({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost claim COMMIT');}},merchant);
   await assert.rejects(uncertain.claim(),/Synthetic lost claim/);assert.equal(commits,1);assert.equal(await queue.claim(),null);
   await admin.query("update app.payment_reconciliation_jobs set attempts=12,lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[f.b.id]);
   assert.deepEqual(await queue.claim(),{exhausted:true});assert.equal((await row(f.b.id)).state,'blocked');assert.equal((await row(f.b.id)).last_code,'attempts_exhausted');assert.equal(await queue.claim(),null);
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty/);}finally{await admin.query('rollback');}
  });
  const fulfilled=formModule('postgres-listing-payment-fulfillment',{'./postgres-listing-form':formModule('postgres-listing-form'),'./postgres-payment-intents.ts':intentModule,'./payment-publication-period.ts':period});
  const {createPaymentReconciliationWorker}=formModule('payment-reconciliation-worker',{'./postgres-payment-reconciliation.ts':{PostgresPaymentReconciliationQueue},'./postgres-payment-verification.ts':verification,'./postgres-listing-payment-fulfillment':fulfilled});
  const publication=async()=>{
   const owner=randomUUID(),id=randomUUID();await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`reconciliation-${owner}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
   await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
    select $1,$2,'sell',c.id,city.id,'Синтетическая очередь оплаты','Локальное исполнение webhook','+79990000000'
    from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[id,owner]);
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[id]);return make({ownerId:owner,targetId:id});
  };
  const response=(f,status,capturedAt)=>({id:f.providerId,status,paid:status==='succeeded',test:true,amount:{value:f.b.amount,currency:'RUB'},recipient:{account_id:merchant.shopId},metadata:{localPaymentId:f.b.id,targetId:f.b.targetId,targetType:'listing',tariffId:f.b.tariffId},...(capturedAt?{captured_at:capturedAt}:{})});
  const notification=(f,queue)=>createPrimaryPaymentWebhook({origin:'https://site.example.invalid'},()=>queue,()=>{})(new Request('https://site.example.invalid/api/payments/yookassa/primary-webhook',{method:'POST',headers:{host:'site.example.invalid','x-real-ip':'185.71.76.1','content-type':'application/json'},body:JSON.stringify({type:'notification',event:'payment.succeeded',object:{id:f.providerId,status:'succeeded',metadata:{localPaymentId:randomUUID()},amount:{value:'0.01'}}})}));
  const due=async f=>admin.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where intent_id=$1",[f.b.id]);
  await suite.test('unknown webhook enqueue COMMIT returns503 while the original committed job remains recoverable without duplicate work',async()=>{
   const f=await make();let commits=0;const uncertain=new PostgresPaymentReconciliationQueue({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost enqueue COMMIT');}},merchant);
   assert.equal((await notification(f,uncertain)).status,503);assert.equal(commits,1);const original=await row(f.b.id);assert.equal(original.state,'queued');
   assert.equal((await notification(f,queue)).status,200);assert.deepEqual(await row(f.b.id),original);
   assert.equal(await queue.finish(await queue.claim(),'completed'),true);
  });
  await suite.test('HTTP hint is not financial truth; durable retry polls original GET until capture, then applies one publication and acknowledges once',async()=>{
   const f=await publication();const notices=await Promise.all([notification(f,queue),notification(f,queue)]);assert.deepEqual(notices.map(value=>value.status),[200,200]);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[f.b.id])).rows[0].status,'created');
   let status='pending',capturedAt=null;const methods=[];
   const worker=createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},async(url,init)=>{methods.push(init.method);assert.equal(url,`https://api.yookassa.ru/v3/payments/${f.providerId}`);assert.equal(init.method,'GET');return Response.json(response(f,status,capturedAt));});
   assert.deepEqual(await worker.tick(),{state:'deferred',code:'provider_pending'});assert.equal((await row(f.b.id)).state,'queued');
   await due(f);status='succeeded';assert.deepEqual(await worker.tick(),{state:'deferred',code:'capture_required'});
   assert.equal((await admin.query('select is_paid from app.listings where id=$1',[f.b.targetId])).rows[0].is_paid,false);
   capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   await due(f);assert.deepEqual(await worker.tick(),{state:'completed'});assert.equal((await row(f.b.id)).state,'completed');
   const receipt=(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows;
   assert.equal(receipt.length,1);assert.equal((await admin.query('select is_paid,status from app.listings where id=$1',[f.b.targetId])).rows[0].status,'published');
   assert.equal((await notification(f,queue)).status,200);assert.deepEqual(await worker.tick(),{state:'idle'});assert.deepEqual(methods,['GET','GET','GET']);
   assert.deepEqual((await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows,receipt);
  });
  await suite.test('lost financial/fulfillment COMMIT remains durable, retries only the original GET and cannot publish twice',async()=>{
   for(const stage of ['verification','fulfillment']){
    const f=await publication();await notification(f,queue);let lose=true;const methods=[];
    const uncertain={transaction:work=>db.transaction(async tx=>{let touched=false;const result=await work({query:async(sql,args)=>{const reply=await tx.query(sql,args);if(sql.startsWith(stage==='verification'?'insert into app.payment_verifications':'insert into app.payment_fulfillments'))touched=true;return reply;}});return{result,touched};}).then(({result,touched})=>{if(lose&&touched){lose=false;throw Error('Synthetic lost financial COMMIT');}return result;})};
    const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
    const fetcher=async(_url,init)=>{methods.push(init.method);return Response.json(response(f,'succeeded',capturedAt));};
    assert.deepEqual(await createPaymentReconciliationWorker(uncertain,{...merchant,secretKey:'test_synthetic_reconciliation'},fetcher).tick(),{state:'deferred',code:'processing_unavailable'});
    assert.equal((await row(f.b.id)).state,'queued');const prior=(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows;
    if(stage==='fulfillment')assert.equal(prior.length,1);else assert.equal(prior.length,0);
    await due(f);assert.deepEqual(await createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},fetcher).tick(),{state:'completed'});
    const receipt=(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows;assert.equal(receipt.length,1);if(stage==='fulfillment')assert.deepEqual(receipt,prior);
    assert.deepEqual(methods,['GET','GET']);
   }
  });
  await suite.test('lease expiry during real GET preserves authoritative finance but prevents stale queue acknowledgement and new fulfillment',async()=>{
   const f=await publication();await notification(f,queue);let enter,release;
   const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
   const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   const waiting=createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},async(_url,init)=>{assert.equal(init.method,'GET');enter();await gate;return Response.json(response(f,'succeeded',capturedAt));}).tick();
   await entered;const original=await row(f.b.id);
   await admin.query("update app.payment_reconciliation_jobs set lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[f.b.id]);
   const replacement=await queue.claim();assert.equal(replacement.intentId,f.b.id);release();assert.deepEqual(await waiting,{state:'lost'});
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[f.b.id])).rows[0].status,'succeeded');
   assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows[0].n,0);
   assert.equal(await queue.finish({intentId:f.b.id,claimId:original.claim_id,attempts:original.attempts},'completed'),false);
   assert.equal(await queue.finish(replacement,'retry','capture_required'),true);await due(f);
   assert.deepEqual(await createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},async()=>Response.json(response(f,'succeeded',capturedAt))).tick(),{state:'completed'});
  });
  await suite.test('unknown completion COMMIT is not replayed and a restarted worker leaves the completed original job and receipt alone',async()=>{
   const f=await publication();await notification(f,queue);let finishes=0;const methods=[];
   const uncertain={transaction:work=>db.transaction(async tx=>{let finished=false;const result=await work({query:async(sql,args)=>{const reply=await tx.query(sql,args);if(sql.startsWith('update app.payment_reconciliation_jobs q set')&&args[4]==='completed')finished=true;return reply;}});return{result,finished};}).then(({result,finished})=>{if(finished){finishes++;throw Error('Synthetic lost completion COMMIT');}return result;})};
   const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   const fetcher=async(_url,init)=>{methods.push(init.method);return Response.json(response(f,'succeeded',capturedAt));};
   await assert.rejects(createPaymentReconciliationWorker(uncertain,{...merchant,secretKey:'test_synthetic_reconciliation'},fetcher).tick(),/Synthetic lost completion/);
   assert.equal(finishes,1);assert.equal((await row(f.b.id)).state,'completed');
   const receipt=(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows;assert.equal(receipt.length,1);
   assert.deepEqual(await createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},fetcher).tick(),{state:'idle'});assert.deepEqual(methods,['GET']);
   assert.deepEqual((await admin.query('select * from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows,receipt);
  });
  await suite.test('continuous service drains one actual payment on stop; restart handles only the remaining queue row and preserves the first receipt',async()=>{
   const first=await publication(),second=await publication();await notification(first,queue);await notification(second,queue);
   const fixtures=new Map([first,second].map(f=>[f.providerId,f]));
   const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   const methods=[],runs=[];
   for(let cycle=0;cycle<2;cycle++){
    const controller=new AbortController(),events=[];let closed=0,preflight=0;
    const serviceDb=new PostgresDatabase(new pg.Pool({...config,max:2}));
    const result=await runPaymentReconciliationService({mode:'run',signal:controller.signal,entryPoint:'service',
     createRuntime:async()=>({
      preflight:async()=>{preflight++;await serviceDb.transaction(tx=>tx.query('select intent_id,state,claim_id,lease_until from app.payment_reconciliation_jobs limit 0'),{readOnly:true});},
      worker:createPaymentReconciliationWorker(serviceDb,{...merchant,secretKey:'test_synthetic_reconciliation'},async(url,init)=>{
       assert.equal(init.method,'GET');const f=fixtures.get(url.split('/').at(-1));assert.ok(f);methods.push(f.b.id);
       // Stop while GET is in progress: the current real finance/publication transactions still drain.
       controller.abort();return Response.json(response(f,'succeeded',capturedAt));
      }),close:async()=>{closed++;await serviceDb.close();},
     }),report:async event=>events.push(event),wait:async()=>assert.fail('No next admission after stop'),
    });
    assert.equal(result,0);assert.equal(preflight,1);assert.equal(closed,1);assert.equal(events.at(-1).status,'stopped');
    assert.deepEqual(events.at(-1).outcomes,{completed:1});runs.push(events);
    const paid=(await admin.query('select intent_id from app.payment_fulfillments where intent_id=any($1::uuid[])',[ [first.b.id,second.b.id] ])).rows;
    assert.equal(paid.length,cycle+1);
   }
   assert.equal(new Set(methods).size,2);assert.equal(methods.length,2);assert.notEqual(runs[0][0].runId,runs[1][0].runId);
   for(const f of [first,second])assert.equal((await row(f.b.id)).state,'completed');
   const receipts=(await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=any($1::uuid[]) order by intent_id',[[first.b.id,second.b.id]])).rows;
   assert.equal(await queue.enqueue(first.providerId),true);assert.equal(await queue.enqueue(second.providerId),true);
   assert.deepEqual(await createPaymentReconciliationWorker(db,{...merchant,secretKey:'test_synthetic_reconciliation'},async()=>assert.fail('Completed queue must not call merchant')).tick(),{state:'idle'});
   assert.deepEqual((await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=any($1::uuid[]) order by intent_id',[[first.b.id,second.b.id]])).rows,receipts);
  });
  await suite.test('service stops on an unknown claim COMMIT; a new service cannot steal its live lease and recovers after expiry',async()=>{
   const f=await publication();await notification(f,queue);let lostCommits=0;const methods=[];
   const capturedAt=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   const run=async uncertain=>{
    const controller=new AbortController(),events=[];let closed=0;
    const serviceDb=new PostgresDatabase(new pg.Pool({...config,max:2}));
    const boundary=uncertain?{transaction:async work=>{await serviceDb.transaction(work);lostCommits++;throw Error('Synthetic lost service claim COMMIT');}}:serviceDb;
    const code=await runPaymentReconciliationService({mode:'run',signal:controller.signal,
     createRuntime:async()=>({preflight:async()=>{await serviceDb.query('select intent_id from app.payment_reconciliation_jobs limit 0');},
      worker:createPaymentReconciliationWorker(boundary,{...merchant,secretKey:'test_synthetic_reconciliation'},async(_url,init)=>{methods.push(init.method);return Response.json(response(f,'succeeded',capturedAt));}),
      close:async()=>{closed++;await serviceDb.close();},
     }),report:async event=>{events.push(event);if(event.status==='tick')controller.abort();},
     wait:async()=>assert.fail('Unknown claim does not retry inside process'),
    });
    assert.equal(closed,1);return{code,events};
   };
   const failed=await run(true);assert.equal(failed.code,1);assert.equal(failed.events.at(-1).failureStage,'delivery');
   assert.equal(lostCommits,1);assert.equal((await row(f.b.id)).state,'processing');assert.equal((await row(f.b.id)).attempts,1);assert.deepEqual(methods,[]);
   const waiting=await run(false);assert.equal(waiting.code,0);assert.deepEqual(waiting.events.at(-1).outcomes,{idle:1});assert.deepEqual(methods,[]);
   await admin.query("update app.payment_reconciliation_jobs set lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[f.b.id]);
   const recovered=await run(false);assert.equal(recovered.code,0);assert.deepEqual(recovered.events.at(-1).outcomes,{completed:1});
   assert.deepEqual(methods,['GET']);assert.equal((await row(f.b.id)).attempts,2);assert.equal((await row(f.b.id)).state,'completed');
   assert.equal((await admin.query('select count(*)::int as n from app.payment_fulfillments where intent_id=$1',[f.b.id])).rows[0].n,1);
  });
 }finally{await db.close();}
}
