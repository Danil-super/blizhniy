import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomBytes,randomUUID} from 'node:crypto';import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';import {hashSessionToken} from '../src/lib/identity.ts';
import {listingCheckoutModule} from './listing-checkout-module.mjs';
import {createAccountTestListingPayment} from '../src/lib/account-test-listing-payment.ts';
import {createAccountTestPaymentVerifier} from '../src/lib/account-test-payment-verifier.ts';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';

export async function testAccountTestPayment(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');
 const db=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password,max:2}));
 const owner=randomUUID(),other=randomUUID(),tokens=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
 const merchant={ownerId:owner,shopId:'123456',isTest:true,secretKey:'test_synthetic_only'},origin='https://site.example.invalid';
 const store=new listingCheckoutModule.PostgresListingCheckoutStore(db,{...merchant,siteOrigin:origin,receiptVatCode:1});
 const calls=[];let afterPost=async()=>{};
 const payments=createAccountTestListingPayment(db,store,merchant,async(_url,init)=>{
  calls.push(init.method);if(init.method==='POST')await afterPost();
  const body=init.method==='POST'?JSON.parse(init.body):currentBody;
  currentBody=body;
  return Response.json({id:currentProvider,status:'pending',paid:false,test:true,recipient:{account_id:merchant.shopId},amount:body.amount,metadata:body.metadata,confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
 });
 let currentBody,currentProvider=randomUUID();
 const handler=createListingCheckoutHandler({origin},()=>({store,payments,limiter:{allowProduction:async()=>true}}),()=>{});
 const request=(action,paymentId,token=tokens[0],expectedOwnerId=owner)=>new Request(origin+'/api/account/listing-checkout',{method:'POST',headers:{host:'site.example.invalid',origin,'x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:'__Host-blizhniy_session='+token},body:JSON.stringify({expectedOwnerId,action,paymentId})});
 async function make(){
  const id=randomUUID();await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
   select $1,$2,'sell',c.id,city.id,'TEST размещение','Только локальная проверка','+79990000000' from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[id,owner]);
  await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[id]);
  const quote=await store.preview(tokens[0],owner,id,'1');
  const order=await store.prepare(tokens[0],owner,{listingId:id,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:quote.tariff.id,expectedAmount:quote.tariff.amount,expectedDurationDays:quote.tariff.durationDays});return{id,order};
 }
 try{
  for(const [index,user] of [owner,other].entries()){
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[user,`account-${user}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at) select $1,id,auth_version,'app',clock_timestamp()+interval '1 hour' from app.users where id=$2",[hashSessionToken(tokens[index]),user]);
  }
  const first=await make();
  await suite.test('TEST HTTP cannot dispatch under the old40-column role; no provider request or link is manufactured',async()=>{
   assert.equal((await handler(request('dispatch',first.order.id))).status,503);assert.deepEqual(calls,[]);
  });
  const up=readFileSync(new URL('../database/permissions/listing-checkout-dispatch.sql',import.meta.url),'utf8'),down=readFileSync(new URL('../database/permissions/listing-checkout-dispatch-revoke.sql',import.meta.url),'utf8');
  await admin.query(up);
  await suite.test('approved dispatch adds exactly8 column privileges, with no mutable financial or publication authority',async()=>{
   const extra=(await db.query(`select c.relname||'.'||a.attname||':'||p.privilege as key from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid cross join (values('SELECT'),('INSERT'),('UPDATE')) p(privilege)
    where n.nspname='app' and c.relname in ('payment_dispatch_anchors','payment_provider_links') and a.attnum>0 and not a.attisdropped and has_column_privilege(c.oid,a.attnum,p.privilege)
    union all select 'payment_checkout_intents.id:UPDATE' where has_column_privilege('app.payment_checkout_intents','id','UPDATE')`)).rows.map(row=>row.key).sort();
   assert.deepEqual(extra,['payment_checkout_intents.id:UPDATE','payment_dispatch_anchors.authorized_at:SELECT','payment_dispatch_anchors.intent_id:INSERT','payment_dispatch_anchors.intent_id:SELECT','payment_provider_links.intent_id:INSERT','payment_provider_links.intent_id:SELECT','payment_provider_links.provider_payment_id:INSERT','payment_provider_links.provider_payment_id:SELECT']);
   await assert.rejects(db.query('update app.payment_checkout_intents set id=id where id=$1',[first.order.id]),{code:'23514'});
   for(const sql of ["update app.payment_orders set status='succeeded' where false","update app.listings set is_paid=true where false",'update app.payment_dispatch_anchors set authorized_at=clock_timestamp() where false','delete from app.payment_provider_links where false','select * from app.payment_verifications limit 0','select * from app.payment_reconciliation_jobs limit 0'])await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('allowlist, live session and exact owner are required before any network call',async()=>{
   assert.equal((await handler(request('dispatch',first.order.id,tokens[1],other))).status,409);
   assert.equal((await handler(request('dispatch',first.order.id,tokens[1],owner))).status,401);
   assert.equal((await handler(request('dispatch',randomUUID()))).status,404);assert.deepEqual(calls,[]);
  });
  await suite.test('owner dispatch returns only a TEST hosted URL; edits after a known link permit GET recovery but never another POST',async()=>{
   const response=await handler(request('dispatch',first.order.id));assert.equal(response.status,200);assert.deepEqual(await response.json(),{confirmationUrl:'https://yoomoney.ru/checkout',isTest:true});assert.deepEqual(calls,['POST']);
   await admin.query('update app.listings set title=title||$2,revision=revision+1 where id=$1',[first.id,' изменено']);
   const replay=await handler(request('dispatch',first.order.id));assert.equal(replay.status,200);assert.deepEqual(calls,['POST','GET']);
   assert.equal((await admin.query('select is_paid from app.listings where id=$1',[first.id])).rows[0].is_paid,false);
  });
  await suite.test('an edited revision cannot start a first charge; a session revoked in flight cannot expose the provider URL',async()=>{
   const edited=await make();await admin.query('update app.listings set title=title||$2,revision=revision+1 where id=$1',[edited.id,' изменено']);
   const before=calls.length;assert.equal((await handler(request('dispatch',edited.order.id))).status,409);assert.equal(calls.length,before);
   const revoked=await make();currentProvider=randomUUID();afterPost=async()=>{await admin.query('delete from app.sessions where token_hash=$1',[hashSessionToken(tokens[0])]);};
   const result=await handler(request('dispatch',revoked.order.id));assert.equal(result.status,401);assert.deepEqual(await result.json(),{error:{code:'UNAUTHENTICATED'}});
   assert.equal((await admin.query('select count(*)::int as n from app.payment_provider_links where intent_id=$1',[revoked.order.id])).rows[0].n,1);
  });
  await suite.test('dedicated account verifier records TEST success under its actual role and never publishes, fulfills or enqueues',async()=>{
   const password=randomUUID();await admin.query(`alter role blizhniy_payment_reconciler login password '${password}'`);
   const workerDb=new PostgresDatabase(new pg.Pool({...config,user:'blizhniy_payment_reconciler',password,max:2}));
   try{
    const original=(await admin.query('select i.id,i.request_body,p.provider_payment_id from app.payment_checkout_intents i join app.payment_provider_links p on p.intent_id=i.id where i.owner_id=$1',[owner])).rows;
    const capturedAt=new Date().toISOString(),remote=[];
    const worker=createAccountTestPaymentVerifier(workerDb,merchant,async(url,init)=>{
     assert.equal(init.method,'GET');remote.push(url);const row=original.find(item=>url.endsWith('/'+item.provider_payment_id));assert.ok(row);
     const body=JSON.parse(row.request_body);return Response.json({id:row.provider_payment_id,status:'succeeded',paid:true,test:true,captured_at:capturedAt,recipient:{account_id:merchant.shopId},amount:body.amount,metadata:body.metadata});
    });
    assert.deepEqual(await worker.tick(),{state:'completed'});assert.equal(remote.length,2);
    assert.deepEqual(await worker.tick(),{state:'idle'});assert.equal(remote.length,2);
    assert.equal((await admin.query("select count(*)::int as n from app.payment_orders where owner_id=$1 and status='succeeded'",[owner])).rows[0].n,2);
    assert.equal((await admin.query('select count(*)::int as n from app.listings where author_id=$1 and (is_paid or published_at is not null or expires_at is not null)',[owner])).rows[0].n,0);
    for(const table of ['payment_fulfillments','payment_reconciliation_jobs'])assert.equal((await admin.query('select count(*)::int as n from app.'+table+' f join app.payment_checkout_intents i on i.id=f.intent_id where i.owner_id=$1',[owner])).rows[0].n,0);
   }finally{await workerDb.close();}
  });
  await suite.test('dispatch rollback removes only the eight additions, preserving immutable payment history',async()=>{
   const before=(await admin.query('select intent_id,provider_payment_id from app.payment_provider_links order by intent_id')).rows;
   await admin.query(down);await assert.rejects(db.query('select * from app.payment_provider_links limit 0'),{code:'42501'});
   assert.deepEqual((await admin.query('select intent_id,provider_payment_id from app.payment_provider_links order by intent_id')).rows,before);
  });
 }finally{await db.close();}
}
