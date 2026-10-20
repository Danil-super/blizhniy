import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {createPrimaryTestPaymentProbe} from '../src/lib/primary-test-payment-probe.ts';
import {listingCheckoutModule} from './listing-checkout-module.mjs';

export async function testPrimaryTestPaymentProbe(suite,admin,config){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');
 const db=new PostgresDatabase(new pg.Pool({...config,max:2}));
 const merchant={shopId:'123456',isTest:true,secretKey:'test_synthetic_only',siteOrigin:'https://site.example.invalid'};
 const owner=randomUUID(),listingId=randomUUID(),creationKey=randomUUID(),token=randomBytes(32).toString('hex');
 try{
  await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[owner,`checkout-${owner}@example.com`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
  await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at) select $1,id,auth_version,'app',clock_timestamp()+interval '1 hour' from app.users where id=$2",[hashSessionToken(token),owner]);
  await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
   select $1,$2,'sell',c.id,city.id,'Технический TEST','Закрытая проверка провайдера','+79990000000'
   from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[listingId,owner]);
  await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[listingId]);
  const store=new listingCheckoutModule.PostgresListingCheckoutStore(db,{...merchant,receiptVatCode:1});
  const preview=await store.preview(token,owner,listingId,'1');
  const order=await store.prepare(token,owner,{listingId,expectedRevision:'1',creationKey,expectedTariffId:preview.tariff.id,expectedAmount:preview.tariff.amount,expectedDurationDays:preview.tariff.durationDays});
  const fixture={orderId:order.id,ownerId:owner,listingId,creationKey},providerId=randomUUID(),calls=[];
  let succeeded=false;
  const capturedAt=new Date().toISOString();
  const probe=createPrimaryTestPaymentProbe(db,merchant,async(_url,init)=>{
   calls.push(init.method);
   return Response.json({id:providerId,status:succeeded?'succeeded':'pending',paid:succeeded,test:true,recipient:{account_id:merchant.shopId},amount:{value:order.amount,currency:'RUB'},metadata:{localPaymentId:order.id,targetId:listingId,targetType:'listing',tariffId:order.tariffId},...(succeeded?{captured_at:capturedAt}:{confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}})});
  });
  await suite.test('operator probe refuses an ordinary active account before any provider I/O',async()=>{
   await assert.rejects(probe.dispatch(fixture));assert.deepEqual(calls,[]);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_dispatch_anchors where intent_id=$1',[order.id])).rows[0].n,0);
  });
  await admin.query('update app.users set is_blocked=true where id=$1',[owner]);
  await admin.query('delete from app.sessions where user_id=$1',[owner]);
  const before=(await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[listingId])).rows[0];
  await suite.test('actual PostgreSQL closed-fixture probe creates one link and GET verification, replay never sends a new POST',async()=>{
   const first=await probe.dispatch(fixture);assert.equal(first.status,'pending');assert.equal(first.providerPaymentId,providerId);
   assert.deepEqual(await probe.dispatch(fixture),first);assert.deepEqual(calls,['POST','GET','GET','GET']);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_provider_links where intent_id=$1',[order.id])).rows[0].n,1);
  });
  await suite.test('authoritative TEST success is accounted without a fulfillment, queue job or public listing; replay is GET-only',async()=>{
   succeeded=true;
   assert.deepEqual(await probe.reconcile(fixture),{status:'succeeded',orderStatus:'succeeded'});
   assert.deepEqual(await probe.reconcile(fixture),{status:'succeeded',orderStatus:'succeeded'});
   assert.deepEqual(calls,['POST','GET','GET','GET','GET','GET']);
   assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[listingId])).rows[0],before);
   for(const table of ['payment_fulfillments','payment_reconciliation_jobs'])assert.equal((await admin.query('select count(*)::int as n from app.'+table+' where intent_id=$1',[order.id])).rows[0].n,0);
   assert.equal((await admin.query('select count(*)::int as n from app.sessions where user_id=$1',[owner])).rows[0].n,0);
   assert.equal((await admin.query('select is_blocked from app.users where id=$1',[owner])).rows[0].is_blocked,true);
  });
 }finally{await db.close();}
}
