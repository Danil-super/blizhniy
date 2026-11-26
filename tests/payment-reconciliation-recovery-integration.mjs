import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {reconciliationAlertFixture} from './payment-reconciliation-alert-integration.mjs';

export async function testPaymentReconciliationRecovery(suite,{admin,config,ownerDb,actor,purchase,intents,load}){
 await suite.test('an exhausted TEST order can receive one audited recovery and fulfill without a second POST',async t=>{
  const payer=await actor(),operator=await actor();
  await admin.query("update app.users set role='admin' where id=$1",[operator.id]);
  const region=(await admin.query("insert into app.regions(slug,name) values('recovery-region','Тестовый регион') returning id")).rows[0].id;
  const city=(await admin.query("insert into app.cities(region_id,slug,name) values($1,'recovery-city','Тестовый город') returning id",[region])).rows[0].id;
  const category=(await admin.query("insert into app.categories(slug,name) values('recovery-category','Тестовая категория') returning id")).rows[0].id;
  const targetId=(await admin.query(`insert into app.listings(author_id,category_id,city_id,listing_type,title,description,contact_phone)
   values($1,$2,$3,'sell','Синтетическое объявление','Синтетическое описание для проверки очереди платежей.','+79990000000') returning id`,
   [payer.id,category,city])).rows[0].id;
  await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[targetId]);
  const order=await purchase({actor:payer,targetId,tariffId:'listing-publication'});
  const providerId=randomUUID();
  await intents.authorize(order);await intents.bindProvider(order,providerId);
  const scope={isTest:true,shopId:order.shopId};
  const queue=new(load('postgres-payment-reconciliation').PostgresPaymentReconciliationQueue)(ownerDb,scope);
  const methods=[];
  let capturedAt;
  const fetcher=async(path,init)=>{
   assert.equal(String(path),'https://api.yookassa.ru/v3/payments/'+providerId);
   methods.push(init.method);
   return Response.json({id:providerId,status:capturedAt?'succeeded':'pending',paid:!!capturedAt,test:true,
    amount:{value:order.amount,currency:'RUB'},recipient:{account_id:order.shopId},
    metadata:{localPaymentId:order.id,targetId,targetType:'listing',tariffId:order.tariffId},...(capturedAt?{captured_at:capturedAt}:{})});
  };
  const {createPaymentReconciliationWorker}=load('payment-reconciliation-worker');
  const merchant={...scope,secretKey:'test_synthetic_only'};
  const worker=createPaymentReconciliationWorker(ownerDb,merchant,fetcher);
  await queue.enqueue(providerId);
  for(let attempt=1;attempt<=12;attempt++){
   assert.deepEqual(await worker.tick(),attempt<12?{state:'deferred',code:'provider_pending'}:{state:'blocked',code:'attempts_exhausted'});
   if(attempt<12)await admin.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where intent_id=$1",[order.id]);
  }
  assert.deepEqual(methods,Array(12).fill('GET'));
  await assert.rejects(admin.query("update app.payment_reconciliation_jobs set state='queued',attempts=9 where intent_id=$1",[order.id]),{code:'23514'});
  await admin.query(await readFile(new URL('../database/candidates/0072-payment-reconciliation-recovery.sql',import.meta.url),'utf8'));
  const alert=await reconciliationAlertFixture(t,{admin,config,load,shop:order.shopId});
  assert.deepEqual(await alert.run(),{result:'reconciliation-blocked',delivery:'accepted'});
  assert.deepEqual(await alert.run(),{result:'reconciliation-blocked',delivery:'accepted'});
  assert.equal(alert.messages.length,1);
  assert.equal(alert.messages[0].to,'RCPT TO:<'+alert.recipient+'>');
  assert.match(alert.messages[0].raw,/Message-ID:\s+<[0-9a-f-]+@xn----9sbphbgks4a4a.xn--p1ai>/i);
  assert.equal(alert.messages[0].raw.includes(order.id),false);
  assert.equal(alert.messages[0].raw.includes(providerId),false);
  const login='blizhniy_reconciliation_operator',password=randomBytes(24).toString('hex');
  await admin.query(`create role ${login} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   grant connect on database blizhniy_test to ${login}`);
  await admin.query(await readFile(new URL('../database/permissions/payment-reconciliation-recovery.sql',import.meta.url),'utf8'));
  const db=new pg.Pool({...config,user:login,password,max:4});
  try{
   const peer=await actor();
   await admin.query("update app.users set role='admin' where id=$1",[peer.id]);
   const input=[operator.hash,operator.id,randomUUID(),order.id,order.shopId,'Подтверждена возможность поздней сверки TEST-платежа.'];
   const sql='select app.recover_payment_reconciliation($1,$2,$3,$4,$5,$6,$7) as result';
   const recover=async(write,parameters=input)=>(await db.query(sql,[...parameters,write])).rows[0].result;
   await assert.rejects(db.query("update app.payment_reconciliation_jobs set attempts=0 where intent_id=$1",[order.id]),{code:'42501'});
   await assert.rejects(db.query('select * from app.payment_reconciliation_recoveries'),{code:'42501'});
   for(const args of [[payer.hash,payer.id,...input.slice(2)],[payer.hash,...input.slice(1)],[operator.hash,peer.id,...input.slice(2)]]){
    await assert.rejects(recover(true,args),{code:'42501'});
   }
   await assert.rejects(recover(true,[...input.slice(0,4),'another-test-shop',input[5]]),{code:'PRQ01'});
   const command=async(actor,parameters,action,patch={})=>{
    const child=spawn(process.execPath,['--experimental-strip-types','--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','scripts/payment-reconciliation-recovery.mjs'],{
     env:{PATH:process.env.PATH,NODE_ENV:'test',BLIZHNIY_RECONCILIATION_RECOVERY:'test-v1',BLIZHNIY_PAYMENT_MODE:'test',
      BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
      BLIZHNIY_DB_USER:login,BLIZHNIY_DB_PASSWORD:password,BLIZHNIY_DB_SSL_MODE:'disable',BLIZHNIY_PAYMENT_SHOP_ID:parameters[4],...patch},
    });
    const result=new Promise((resolve,reject)=>{
     let stdout='',stderr='';
     child.stdout.on('data',value=>{stdout+=value;});child.stderr.on('data',value=>{stderr+=value;});
     child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
    });
    child.stdin.end(JSON.stringify({action,sessionToken:actor.token,expectedAdminId:parameters[1],
     ...(action==='status'?{}:{requestId:parameters[2],intentId:parameters[3],reason:parameters[5]})}));
    return result;
   };
   assert.equal(await recover(false),null);
   assert.deepEqual(await command(operator,input,'read'),{code:0,stdout:'{"state":"not_found"}\n',stderr:''});
   const diagnostic=await command(operator,input,'status');
   assert.equal(diagnostic.code,0);assert.equal(diagnostic.stderr,'');
   const before=JSON.parse(diagnostic.stdout);
   assert.equal(before.blocked,1);
   assert.equal(before.oldestQueueAgeSeconds,null);
   const [item]=before.recentBlocked;
   assert.deepEqual({...item,queueAgeSeconds:0},{intentId:order.id,attempts:12,code:'attempts_exhausted',alreadyRecovered:false,queueAgeSeconds:0});
   assert.ok(item.queueAgeSeconds>=0);
   assert.equal((await command(payer,[payer.hash,payer.id,...input.slice(2)],'status')).stderr,'{"code":"ADMIN_REQUIRED"}\n');
   const competing=[peer.hash,peer.id,randomUUID(),...input.slice(3)];
   const outcomes=await Promise.allSettled([recover(true),recover(true,competing)]);
   assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
   const winner=outcomes[0].status==='fulfilled'?input:competing;
   const loser=winner===input?competing:input;
   const record=await recover(false,winner);
   assert.equal(record.requestId,winner[2]);assert.equal(record.intentId,order.id);assert.equal(record.state,'scheduled');
   assert.deepEqual(await recover(true,winner),record);
   const owner=winner===input?operator:peer;
   const fromCli=await command(owner,winner,'read');
   assert.equal(fromCli.code,0);assert.equal(fromCli.stderr,'');assert.deepEqual(JSON.parse(fromCli.stdout),record);
   assert.deepEqual(await command(owner,winner,'schedule',{BLIZHNIY_PAYMENT_MODE:'live'}),{code:1,stdout:'',stderr:'{"code":"RECOVERY_UNCONFIRMED"}\n'});
   await assert.rejects(recover(true,[...winner.slice(0,5),'Другая причина для уже записанного решения.']),{code:'PRQ02'});
   await assert.rejects(recover(true,loser),{code:'PRQ02'});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_reconciliation_recoveries where intent_id=$1',[order.id])).rows[0].n,1);
   await assert.rejects(admin.query("update app.payment_reconciliation_jobs set attempts=0 where intent_id=$1",[order.id]),{code:'23514'});

   // Simulate a stop after the fulfillment transaction commits but before the claim receipt.
   capturedAt=new Date().toISOString();
   let missedFinish=0;
   const interrupted={transaction:(work,options)=>ownerDb.transaction(tx=>work({
    query:(statement,values)=>{
     if(statement.includes("state=case when $5='retry'")){missedFinish++;throw Error('Synthetic stop before finishing the lease');}
     return tx.query(statement,values);
    },
   }),options)};
   await assert.rejects(createPaymentReconciliationWorker(interrupted,merchant,fetcher).tick(),/before finishing the lease/);
   assert.equal(missedFinish,1);
   const stale=(await admin.query('select claim_id as "claimId",attempts from app.payment_reconciliation_jobs where intent_id=$1',[order.id])).rows[0];
   const receipt=(await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=$1',[order.id])).rows[0]?.value;
   assert.ok(receipt);
   assert.deepEqual(await worker.tick(),{state:'idle'});
   await admin.query("update app.payment_reconciliation_jobs set lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[order.id]);
   assert.equal(await queue.finish({...stale,intentId:order.id},'completed'),false);
   assert.deepEqual(await worker.tick(),{state:'completed'});
   assert.deepEqual(await worker.tick(),{state:'idle'});
   assert.deepEqual(methods,Array(14).fill('GET'));
   assert.deepEqual((await admin.query('select to_jsonb(f) as value from app.payment_fulfillments f where intent_id=$1',[order.id])).rows,[{value:receipt}]);
   assert.deepEqual(await alert.run(),{result:'healthy',delivery:'healthy'});
   assert.equal(alert.messages.length,1);
   assert.deepEqual(await recover(false,winner),record);
   await admin.query('update app.users set auth_version=auth_version+1 where id=$1',[winner[1]]);
   await assert.rejects(recover(false,winner),{code:'42501'});

   await t.test('recovery rejects closed or blocked targets, LIVE and reserved refunds, and has only three retries',async()=>{
    async function blockOrder(kind,shopId='recovery-'+kind){
     const actorForOrder=await actor();
     const targetId=(await admin.query(`insert into app.listings(author_id,category_id,city_id,listing_type,title,description,contact_phone,status)
      values($1,$2,$3,'sell','Синтетическое объявление','Синтетическое описание для проверки очереди платежей.','+79990000000',$4)
      returning id`,[actorForOrder.id,category,city,kind==='closed'?'archived':'draft'])).rows[0].id;
     const original=await purchase({actor:actorForOrder,targetId,isTest:kind!=='live',shopId});
     const providerId=randomUUID(),queue=new(load('postgres-payment-reconciliation').PostgresPaymentReconciliationQueue)(ownerDb,original);
     await intents.authorize(original);await intents.bindProvider(original,providerId);
     await queue.enqueue(providerId);
     const claim=await queue.claim();
     assert.equal(claim.intentId,original.id);
     if(kind==='content')assert.equal(await queue.finish(claim,'blocked','publication_blocked'),true);
     else{
      await admin.query("update app.payment_reconciliation_jobs set attempts=12,lease_until=clock_timestamp()-interval '1 second' where intent_id=$1",[original.id]);
      assert.deepEqual(await queue.claim(),{exhausted:true});
     }
     if(kind==='blocked')await admin.query('update app.users set is_blocked=true where id=$1',[actorForOrder.id]);
     if(kind==='refund'){
      await admin.query("update app.payment_orders set status='succeeded' where id=$1",[original.id]);
      await admin.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",
       [original.id,providerId,new Date().toISOString()]);
      await admin.query('insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount) values($1,$2,$3,$4,true,$5)',
       [randomUUID(),original.id,providerId,original.shopId,original.amount]);
     }
     return{original,queue};
    }
    const activeAdmin=loser===input?operator:peer;
    for(const kind of ['closed','blocked','live','refund','content']){
     const {original}=await blockOrder(kind);
     await assert.rejects(recover(true,[...loser.slice(0,2),randomUUID(),original.id,original.shopId,loser[5]]),
      {code:kind==='content'?'PRQ02':'PRQ01'});
     assert.equal((await admin.query('select state from app.payment_reconciliation_jobs where intent_id=$1',[original.id])).rows[0].state,'blocked');
     assert.equal((await admin.query('select count(*)::int as n from app.payment_reconciliation_recoveries where intent_id=$1',[original.id])).rows[0].n,0);
    }
    await blockOrder('live',order.shopId);
    assert.deepEqual(await alert.run(),{result:'healthy',delivery:'healthy'});
    await blockOrder('content',order.shopId);
    assert.deepEqual(await alert.run(),{result:'reconciliation-blocked',delivery:'accepted'});
    assert.deepEqual(await alert.run(),{result:'reconciliation-blocked',delivery:'accepted'});
    assert.equal(alert.messages.length,2);
    const messageIds=alert.messages.map(message=>message.raw.match(/Message-ID:\s+(<[^>]+>)/i)?.[1]);
    assert.ok(messageIds.every(Boolean));assert.notEqual(messageIds[0],messageIds[1]);
    const {original,queue}=await blockOrder('budget');
    const bounded=[...loser.slice(0,2),randomUUID(),original.id,original.shopId,loser[5]];
    const scheduled=await command(activeAdmin,bounded,'schedule');
    assert.equal(scheduled.code,0);assert.deepEqual(await recover(false,bounded),JSON.parse(scheduled.stdout));
    const claimForPhone=await queue.claim();
    assert.equal(claimForPhone.attempts,10);
    const settings=(await admin.query('select available,required from app.phone_verification_policy where singleton')).rows[0];
    await admin.query('update app.phone_verification_policy set available=true,required=true where singleton');
    try{
     assert.equal(await queue.finish(claimForPhone,'waiting_phone','phone_required'),true);
     assert.deepEqual((await admin.query('select state,attempts from app.payment_reconciliation_jobs where intent_id=$1',[original.id])).rows[0],
      {state:'waiting_phone',attempts:10});
     assert.equal(await queue.claim(),null);
     const phone='+79990000018';
     await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[original.ownerId,{name:'Синтетический пользователь',phone}]);
     await admin.query('insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)',
      [original.ownerId,phone,'recovery-phone-budget']);
    }finally{
     await admin.query('update app.phone_verification_policy set available=$1,required=$2 where singleton',[settings.available,settings.required]);
    }
    for(let attempt=11;attempt<=12;attempt++){
     const claim=await queue.claim();
     assert.equal(claim.attempts,attempt);
     assert.equal(await queue.finish(claim,'retry','provider_pending'),true);
     if(attempt<12)await admin.query("update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where intent_id=$1",[original.id]);
    }
    assert.equal(await queue.claim(),null);
    const status=await command(activeAdmin,bounded,'status');
    assert.equal(status.code,0);assert.equal(JSON.parse(status.stdout).recentBlocked[0].alreadyRecovered,true);
    await assert.rejects(recover(true,[...bounded.slice(0,2),randomUUID(),...bounded.slice(3)]),{code:'PRQ02'});
   });

  }finally{await db.end();}
 });
}
