// Explicit synthetic financial cases, called only by the isolated phone DB suite.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
export async function testPhonePayments(suite,owner,config,load,account,store,stage){
 const db=new PostgresDatabase(new pg.Pool({...config,max:4}));
 const {PostgresPaymentIntentStore}=load('postgres-payment-intents');
 const {PostgresListingPaymentFulfillmentStore}=load('postgres-listing-payment-fulfillment');
 const {PostgresPaymentReconciliationQueue}=load('postgres-payment-reconciliation');
 const journal=new PostgresPaymentIntentStore(db),merchant={shopId:'phone-fixture',isTest:true};
 const fulfillment=new PostgresListingPaymentFulfillmentStore(db,merchant,{postmoderation:true}),queue=new PostgresPaymentReconciliationQueue(db,merchant);
 const confirm=async()=>{const a=await stage(account,'+79991234572','publish-verified'),r=await store.review(account.token,account.id,a.id);await store.confirm(account.token,account.id,a.id,r.profileRevision,true);await owner.query('delete from app.telegram_phone_attempts');};
 const make=async()=>{
  const id=randomUUID(),providerId=randomUUID();
  const target=(await owner.query(`insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at)
   select $1,'sell',c.id,city.id,'Synthetic paid phone placement','Synthetic description','+79991234572',clock_timestamp()-interval '42 days'
   from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id`,[account.id])).rows[0].id;
  const binding={id,ownerId:account.id,targetType:'listing',targetId:target,targetRevision:'1',tariffId:'listing-publication',amount:'199.99',durationDays:30,...merchant};
  await db.transaction(async tx=>{await journal.persistInTransaction(tx,{...binding,requestBody:JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://example.invalid/return'},metadata:{localPaymentId:id,targetId:target,targetType:'listing',tariffId:binding.tariffId}})});await tx.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,1)",[id,account.id,randomUUID(),target]);});
  await journal.authorize(binding);await journal.bindProvider(binding,providerId);
  const captured=(await owner.query(`select to_char((clock_timestamp()-interval '40 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
  await owner.query("insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,'succeeded',$3)",[id,providerId,captured]);
  await owner.query("update app.payment_orders set status='succeeded' where id=$1",[id]);await owner.query('insert into app.payment_reconciliation_jobs(intent_id) values($1)',[id]);return binding;
 };
 const job=async id=>(await owner.query('select state,last_code,attempts from app.payment_reconciliation_jobs where intent_id=$1',[id])).rows[0];
 try{
  await suite.test('new placement payment cannot bypass phone prerequisite through direct SQL',async()=>{await store.unlink(account.token,account.id);await assert.rejects(make(),{code:'P7601'});await confirm();});
  await suite.test('expired capture waits durably, wakes on confirmation, gets full term and immutable replay window',async()=>{
   const payment=await make();await store.unlink(account.token,account.id);const claim=await queue.claim();assert.equal(claim.intentId,payment.id);
   await assert.rejects(fulfillment.fulfill(payment.id),{code:'P7601'});assert.equal(await queue.finish(claim,'waiting_phone','phone_required'),true);
   assert.deepEqual(await job(payment.id),{state:'waiting_phone',last_code:'phone_required',attempts:0});assert.equal(await queue.claim(),null);
   await confirm();assert.equal((await job(payment.id)).state,'queued');const next=await queue.claim();
   const before=Date.now(),result=await fulfillment.fulfill(payment.id);assert.equal(result.state,'fulfilled');assert.ok(Date.parse(result.period.publishedAt)>=before-1000);
   assert.equal(Date.parse(result.period.expiresAt)-Date.parse(result.period.publishedAt),30*86400000);
   const row=(await owner.query('select published_at,expires_at from app.listings where id=$1',[payment.targetId])).rows[0];assert.equal(row.published_at.toISOString(),new Date(result.period.publishedAt).toISOString());assert.equal(row.expires_at.toISOString(),new Date(result.period.expiresAt).toISOString());
   assert.deepEqual((await fulfillment.fulfill(payment.id)).period,result.period);await queue.finish(next,'completed');
   await owner.query("update app.listings set status='archived' where id=$1",[payment.targetId]);await owner.query("update app.listings set status='published' where id=$1",[payment.targetId]);
   assert.equal((await owner.query('select published_at from app.listings where id=$1',[payment.targetId])).rows[0].published_at.toISOString(),row.published_at.toISOString());
   await assert.rejects(owner.query("update app.payment_reconciliation_jobs set state='queued' where intent_id=$1",[payment.id]),{code:'23514'});
  });
  await suite.test('confirmation before wait acknowledgement cannot lose the wakeup',async()=>{
   const payment=await make(),claim=await queue.claim();await store.unlink(account.token,account.id);await assert.rejects(fulfillment.fulfill(payment.id),{code:'P7601'});await confirm();
   await queue.finish(claim,'waiting_phone','phone_required');assert.equal((await job(payment.id)).state,'queued');const next=await queue.claim();assert.equal((await fulfillment.fulfill(payment.id)).state,'fulfilled');await queue.finish(next,'completed');
  });
  await suite.test('policy deactivation wakes pending placements and preserves the paid duration',async()=>{
   const payment=await make(),claim=await queue.claim();await store.unlink(account.token,account.id);await queue.finish(claim,'waiting_phone','phone_required');
   await owner.query('update app.phone_verification_policy set required=false');assert.equal((await job(payment.id)).state,'queued');const retry=await queue.claim();await queue.finish(retry,'retry','processing_unavailable');
   assert.equal((await job(payment.id)).last_code,'phone_required');await owner.query('update app.payment_reconciliation_jobs set next_attempt_at=clock_timestamp() where intent_id=$1',[payment.id]);
   const next=await queue.claim();const result=await fulfillment.fulfill(payment.id);assert.equal(result.state,'fulfilled');assert.ok(Date.parse(result.period.expiresAt)>Date.now()+29*86400000);await queue.finish(next,'completed');await confirm();await owner.query('update app.phone_verification_policy set required=true');
  });
  await suite.test('refund while awaiting phone never publishes even after confirmation',async()=>{
   const payment=await make(),claim=await queue.claim();await store.unlink(account.token,account.id);await queue.finish(claim,'waiting_phone','phone_required');
   await owner.query("update app.payment_orders set status='refunded' where id=$1",[payment.id]);await confirm();const next=await queue.claim();assert.notEqual((await fulfillment.fulfill(payment.id)).state,'fulfilled');assert.equal((await owner.query('select status from app.listings where id=$1',[payment.targetId])).rows[0].status,'draft');await queue.finish(next,'completed');
  });
 }finally{await db.close();}
}
