import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function testAdminPaymentJournal(suite, { admin, config, load, full }) {
 await suite.test(full ? 'the full financial schema projects verified payment stages' : 'the hosted schema reads through the restricted role with optional components absent', async () => {
  await admin.query(await readFile(new URL('../database/candidates/0074-admin-payment-journal.sql', import.meta.url), 'utf8'));
  await admin.query(await readFile(new URL('../database/permissions/admin-payment-journal.sql', import.meta.url), 'utf8'));
  const password = randomBytes(24).toString('hex');
  await admin.query(`alter role blizhniy_runtime login password ${pg.escapeLiteral(password)};
    grant connect on database blizhniy_test to blizhniy_runtime;
    grant usage on schema app to blizhniy_runtime;
    grant select(id,role,is_blocked,email_verified_at,auth_version),update(auth_version) on app.users to blizhniy_runtime;
    grant select(token_hash,user_id,auth_version,scope,expires_at,last_seen_at),update(last_seen_at) on app.sessions to blizhniy_runtime`);
  const { PostgresDatabase } = load('postgres');
  const runtime = new PostgresDatabase(new pg.Pool({ ...config, user:'blizhniy_runtime', password, max:3 }));
  const { hashSessionToken } = load('identity');
  const { createAdminPaymentJournalHandler } = load('admin-payment-journal-http');
  const { readAdminPaymentJournal } = load('postgres-admin-payment-journal');
  const scope = 'admin-journal-fixture', origin = 'https://journal.example.invalid', amount = '199.30';
  async function actor(role) {
   const id=randomUUID(), token=randomBytes(32).toString('hex'), hash=hashSessionToken(token);
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at,role) values($1,$2,$3,clock_timestamp(),$4)',
    [id,id+'@journal.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128),role]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hash,id]);
   return { id, token, hash };
  }
  try {
   const operator=await actor('admin'), peer=await actor('admin'), payer=await actor('user');
   async function draft({ isTest=true, shop=scope, kind='listing' }={}) {
    const id=randomUUID(), targetId=randomUUID();
    const body={amount:{value:amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://journal.example.invalid/return'},
     metadata:{localPaymentId:id,targetId,targetType:kind,tariffId:'audit-fixture'}};
    await admin.query(`insert into app.payment_checkout_intents(id,owner_id,target_type,target_id,target_revision,tariff_id,
     amount,duration_days,merchant_shop_id,is_test,request_body,created_at)
     values($1,$2,$3,$4,1,'audit-fixture',$5,$6,$7,$8,$9,'2026-10-01T01:02:03.123456Z')`,
     [id,payer.id,kind,targetId,amount,kind==='application'?null:30,shop,isTest,JSON.stringify(body)]);
    await admin.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,1)',
     [id,payer.id,randomUUID(),kind,targetId]);
    return { id,targetId };
   }
   const data = [];
   for(let i=0;i<51;i++) data.push(await draft());
   const isolated=[await draft({isTest:false}),await draft({shop:'another-shop'})];
   const application=await draft({kind:'application'});
   const payment=data[0];
   await admin.query('insert into app.payment_dispatch_anchors(intent_id) values($1)',[payment.id]);
   const events=[];
   const handler=createAdminPaymentJournalHandler({origin},() => ({ limiter:{allowProduction:async()=>true},
    read:(token,query)=>readAdminPaymentJournal(runtime,scope,token,query) }),event=>events.push(event));
   const defaults={expectedAdminId:operator.id,kind:null,status:null,after:null};
   const request=(body=defaults, user=operator, method='POST')=>new Request(origin+'/api/admin/payment-journal',{
    method,headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.15',
     ...(user?{cookie:'__Host-blizhniy_session='+user.token}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)}),
   });
   const read=async(body=defaults)=>{
    const res=await handler(request(body));
    assert.equal(res.status,200,JSON.stringify(events.at(-1)));assert.equal(res.headers.get('cache-control'),'no-store');
    return res.json();
   };
   assert.equal((await handler(request(defaults,null))).status,401);
   for(const [principal,claimed] of [[payer,payer.id],[peer,operator.id],[operator,peer.id]]){
    const denied=await handler(request({...defaults,expectedAdminId:claimed},principal));
    assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:{code:'ADMIN_REQUIRED'}});
   }
   assert.equal((await handler(request(defaults,operator,'PUT'))).status,405);
   assert.equal((await handler(request({...defaults,shop:'another-shop'}))).status,422);
   await assert.rejects(runtime.query('select request_body from app.payment_checkout_intents'),{code:'42501'});
   await assert.rejects(runtime.query('select app_payment_admin.outcomes($1,$2,$3)',[payment.id,scope,'listing']),{code:'42501'});
   const direct='select * from app_payment_admin.list_orders($1,$2,$3,null,null,null,null)';
   await assert.rejects(runtime.query(direct,[payer.hash,payer.id,scope]),{code:'42501'});
   await assert.rejects(runtime.transaction(async tx=>{
    await tx.query('set transaction isolation level repeatable read');
    return tx.query(direct,[operator.hash,operator.id,scope]);
   }),{code:'42501'});

   const first=await read(), second=await read({...defaults,after:first.nextAfter});
   assert.equal(first.items.length,50);assert.equal(second.items.length,2);assert.equal(second.nextAfter,null);
   const expected=[...data,application].map(row=>row.id).sort().reverse();
   assert.deepEqual([...first.items,...second.items].map(row=>row.id),expected);
   assert.ok(isolated.every(row=>!expected.includes(row.id)));
   const found=[...first.items,...second.items].find(row=>row.id===payment.id);
   assert.equal(found.amount,amount);assert.equal(found.providerStatus,'unknown');assert.equal(found.orderStatus,'created');
   assert.equal(found.refund,full?'none':'unavailable');
   const applicationPage=await read({...defaults,kind:'application',status:'created'});
   assert.equal(applicationPage.items[0].id,application.id);
   assert.equal(applicationPage.items[0].compensation,full?'none':'unavailable');
   assert.equal(applicationPage.items[0].fulfillment,'not_recorded');
   assert.equal(JSON.stringify(first).includes(payer.id),false);

   const providerId=randomUUID(), worker=await admin.connect();
   try{
    await worker.query('begin');
    await worker.query('insert into app.payment_provider_links(intent_id,provider_payment_id) values($1,$2)',[payment.id,providerId]);
    await worker.query('insert into app.payment_reconciliation_jobs(intent_id) values($1) on conflict do nothing',[payment.id]);
    await worker.query("update app.payment_reconciliation_jobs set state='blocked',last_code='publication_blocked' where intent_id=$1",[payment.id]);
    await worker.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",
     [payment.id,providerId,'2026-10-01T01:04:03.123456Z']);
    await worker.query("update app.payment_orders set status='succeeded' where id=$1",[payment.id]);
    assert.deepEqual((await read({...defaults,status:'succeeded'})).items,[]);
    const during=await read({...defaults,kind:'listing',status:'created'});
    const committed=during.items.find(row=>row.id===payment.id) ??
     (await read({...defaults,kind:'listing',status:'created',after:during.nextAfter})).items.find(row=>row.id===payment.id);
    assert.deepEqual(committed,found);
    await worker.query('commit');
   }finally{await worker.query('rollback');worker.release();}
   const succeeded=(await read({...defaults,status:'succeeded'})).items[0];
   assert.equal(succeeded.id,payment.id);assert.equal(succeeded.providerStatus,'succeeded');assert.equal(succeeded.fulfillment,'not_recorded');
   assert.equal(succeeded.reconciliation,'blocked');assert.equal(succeeded.reconciliationCode,'publication_blocked');
   await admin.query(`insert into app.payment_fulfillments(intent_id,published_at,expires_at)
    values($1,'2026-10-01T01:04:03Z','2026-10-31T01:04:03Z')`,[payment.id]);
   const fulfilled=(await read({...defaults,status:'succeeded'})).items[0];
   assert.equal(fulfilled.fulfillment,'fulfilled');assert.ok(fulfilled.fulfilledAt);
   if(full){
    await admin.query(`insert into app.payment_refund_reservations(id,payment_intent_id,provider_payment_id,merchant_shop_id,is_test,amount)
     values($1,$2,$3,$4,true,$5)`,[randomUUID(),payment.id,providerId,scope,amount]);
    assert.equal((await read({...defaults,status:'succeeded'})).items[0].refund,'reserved');
   }
   const before=(await read({...defaults,status:'succeeded'})).items;
   assert.deepEqual((await read({...defaults,status:'succeeded'})).items,before);
   assert.equal((await admin.query('select count(*)::int as count from app.payment_checkout_intents where merchant_shop_id=$1',[scope])).rows[0].count,53);
   await admin.query("update app.users set auth_version=auth_version+1 where id=$1",[operator.id]);
   assert.equal((await handler(request())).status,403);
   await assert.rejects(runtime.query(direct,[operator.hash,operator.id,scope]),{code:'42501'});
  } finally { await runtime.close(); }
 });
}
