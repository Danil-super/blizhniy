import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import * as intents from '../src/lib/postgres-payment-intents.ts';
import * as period from '../src/lib/payment-publication-period.ts';
import {formModule} from './listing-form-module.mjs';
import {bookingDetails} from './listing-publication-check-module.mjs';

export async function testListingPaymentFulfillment(suite,admin,config){
 assert.equal(config.host,'127.0.0.1');
 const target=`${config.host}:${config.database}`,options={includePaymentFulfillment:true};
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const down=readFileSync(new URL('../database/migrations/0022-listing-payment-fulfillment.down.sql',import.meta.url),'utf8');
 await suite.test('paid fulfillment upgrade is opt-in, preserves every previous hash, grants nothing and supports an empty down',async()=>{
  assert.equal(before.length,21);assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
  assert.deepEqual(getBootstrapPlan(options).slice(0,21).map(({name,sha256})=>({name,sha256})),before);
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,0);
  assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_fulfillments','SELECT,INSERT,UPDATE,DELETE') as allowed")).rows[0].allowed,false);
  await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0022-listing-payment-fulfillment.sql'");
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
  assert.equal((await bootstrapPostgres(admin,target,options)).applied,1);
 });
 const {PostgresListingPaymentFulfillmentStore}=formModule('postgres-listing-payment-fulfillment',{
  './postgres-listing-form':formModule('postgres-listing-form'),'./postgres-payment-intents.ts':intents,'./payment-publication-period.ts':period,
 });
 const worker='payment_fulfillment_fixture',password=randomUUID();
 await admin.query(`create role ${worker} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
  grant connect on database blizhniy_test to ${worker};grant usage on schema app to ${worker};
  grant select on app.payment_checkout_intents,app.payment_provider_links,app.payment_orders,app.payment_verifications,app.payment_fulfillments to ${worker};
  grant update(id) on app.payment_checkout_intents to ${worker};grant update(id) on app.payment_orders to ${worker};
  grant select(id,is_blocked,email_verified_at),update(id) on app.users to ${worker};
  grant select on app.listings,app.listing_photos,app.media_objects,app.categories,app.cities,app.tariffs,app.listing_moderation to ${worker};
  grant update(id) on app.categories,app.cities,app.media_objects,app.listing_moderation to ${worker};
  grant update(status,is_paid,published_at,expires_at,updated_at) on app.listings to ${worker};
  grant insert(intent_id,published_at,expires_at) on app.payment_fulfillments to ${worker}`);
 const db=new PostgresDatabase(new pg.Pool({...config,user:worker,password,max:4}));
 const merchant={shopId:'fixture-shop',isTest:true};
 const store=new PostgresListingPaymentFulfillmentStore(db,merchant);
 const journal=new intents.PostgresPaymentIntentStore({transaction:async work=>{
  await admin.query('begin');try{const result=await work(admin);await admin.query('commit');return result;}
  catch(error){await admin.query('rollback');throw error;}
 }});
 const capture=(await admin.query(`select to_char((clock_timestamp()-interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'.123456789Z' as value`)).rows[0].value;
 const make=async({status='succeeded',capturedAt=capture,revision='1'}={})=>{
  const ownerId=randomUUID(),targetId=randomUUID(),id=randomUUID(),providerPaymentId=randomUUID();
  await admin.query(`insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())`,
   [ownerId,`fulfillment-${ownerId}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
  await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone,created_at)
   select $1,$2,'sell',c.id,city.id,'Синтетическая публикация','Проверка исполнения платежа','+79990000000',clock_timestamp()-interval '2 hours'
   from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[targetId,ownerId]);
  await admin.query('update app.listings set revision=$2::bigint where id=$1',[targetId,revision]);
  await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,$2::bigint,'approved',clock_timestamp())",[targetId,revision]);
  const b={id,ownerId,targetType:'listing',targetId,targetRevision:revision,tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:'fixture-shop',isTest:true};
  await admin.query('begin');try{
   await journal.persistInTransaction(admin,{...b,requestBody:JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},metadata:{localPaymentId:id,targetId,targetType:'listing',tariffId:b.tariffId}})});
   await admin.query("insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,$5::bigint)",[id,ownerId,randomUUID(),targetId,revision]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}
  await journal.authorize(b);await journal.bindProvider(b,providerPaymentId);
  await admin.query('insert into app.payment_verifications(intent_id,provider_payment_id,status,captured_at) values($1,$2,$3,$4)',[id,providerPaymentId,status,capturedAt]);
  await admin.query('update app.payment_orders set status=$2 where id=$1',[id,status==='succeeded'?'succeeded':'pending']);
  return b;
 };
 const listing=async b=>(await admin.query(`select status,is_paid,revision::text,to_char(published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as published_at,
  to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as expires_at,updated_at::text from app.listings where id=$1`,[b.targetId])).rows[0];
 const marker=async b=>(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[b.id])).rows;
 try{
  await suite.test('one captured payment publishes only its original approved version with original duration despite tariff drift',async()=>{
   const b=await make();
   const projection=formModule('public-listings',{'./booking-details':bookingDetails});
   const {PostgresPublicListingStore}=formModule('postgres-public-listings',{'./public-listings':projection,'./listing-public-eligibility':formModule('listing-public-eligibility')});
   const publicReader=new PostgresPublicListingStore(admin);
   assert.equal(await publicReader.read(b.targetId),undefined);
   const tariff=(await admin.query("select id,price,duration_days,active from app.tariffs where action='listing_publication'")).rows[0];
   await admin.query('update app.tariffs set price=999,duration_days=90,active=false where id=$1',[tariff.id]);
   try{
    const result=await store.fulfill(b.id);assert.equal(result.state,'fulfilled');assert.deepEqual(result.period,period.paymentPublicationPeriod(capture,30));
    const row=await listing(b);assert.equal(row.status,'published');assert.equal(row.is_paid,true);assert.equal(row.revision,'1');
    assert.equal(row.published_at,result.period.publishedAt);assert.equal(row.expires_at,result.period.expiresAt);assert.equal((await marker(b)).length,1);
    assert.equal((await admin.query('select captured_at from app.payment_verifications where intent_id=$1',[b.id])).rows[0].captured_at,capture);
    assert.equal((await publicReader.read(b.targetId)).kind,'prodam');
   }finally{await admin.query('update app.tariffs set price=$2,duration_days=$3,active=$4 where id=$1',[tariff.id,tariff.price,tariff.duration_days,tariff.active]);}
  });
  await suite.test('bigint revision binding stays exact; invalid form or foreign/unready photos leave captured money pending fulfillment',async()=>{
   const large=await make({revision:'9007199254740993'});assert.equal((await store.fulfill(large.id)).state,'fulfilled');
   assert.equal((await listing(large)).revision,large.targetRevision);
   for(const patch of ["title='x'","description=''",'city_id=null',`booking='{"mode":"stay"}'::jsonb`]){
    const b=await make();await admin.query(`update app.listings set ${patch} where id=$1`,[b.targetId]);
    assert.equal((await store.fulfill(b.id)).state,'blocked');assert.equal((await listing(b)).is_paid,false);assert.equal((await marker(b)).length,0);
   }
   for(const foreign of [false,true]){
    const b=await make();
    const media=(await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
     values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id`,[foreign?large.ownerId:b.ownerId,'d'.repeat(64)])).rows[0].id;
    if(foreign)await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);
    await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[b.targetId,media]);
    await assert.rejects(store.fulfill(b.id));assert.equal((await listing(b)).is_paid,false);assert.equal((await marker(b)).length,0);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[b.id])).rows[0].status,'succeeded');
   }
  });
  await suite.test('account, target, approval, category, city and attached ready photo stay locked until atomic publication commits',async()=>{
   const b=await make();
   const photo=(await admin.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256)
    values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id`,[b.ownerId,'e'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[photo]);
   await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[b.targetId,photo]);
   let enter,release;const started=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
   const delayed=new PostgresListingPaymentFulfillmentStore({transaction:work=>db.transaction(tx=>work({query:async(sql,args)=>{
    if(sql.startsWith('update app.listings set')){enter();await gate;}return tx.query(sql,args);
   }}))},merchant);
   const pending=delayed.fulfill(b.id);
   try{
    await Promise.race([started,pending.then(()=>{throw Error('Publication missed barrier');})]);
    const refs=(await admin.query('select category_id,city_id from app.listings where id=$1',[b.targetId])).rows[0];
    for(const [table,column,id] of [['users','id',b.ownerId],['listings','id',b.targetId],['listing_moderation','listing_id',b.targetId],['categories','id',refs.category_id],['cities','id',refs.city_id],['media_objects','id',photo]]){
     await admin.query('begin');try{await assert.rejects(admin.query(`select ${column} from app.${table} where ${column}=$1 for update nowait`,[id]),{code:'55P03'});}finally{await admin.query('rollback');}
    }
   }finally{release();await pending;}
   assert.equal((await listing(b)).status,'published');assert.equal((await marker(b)).length,1);
  });
  await suite.test('concurrent workers, repeated execution and a lost COMMIT never publish twice or move publication times',async()=>{
   const b=await make();const results=await Promise.all([store.fulfill(b.id),store.fulfill(b.id)]);assert.deepEqual(results[0],results[1]);
   const before=await listing(b),receipt=await marker(b);assert.equal(receipt.length,1);
   // A later lifecycle change must not let a payment replay resurrect an archived listing.
   await admin.query("update app.listings set status='archived' where id=$1",[b.targetId]);
   assert.deepEqual(await store.fulfill(b.id),results[0]);assert.deepEqual(await marker(b),receipt);
   assert.deepEqual(await listing(b),{...before,status:'archived'});
   await admin.query("update app.payment_orders set status='refunded' where id=$1",[b.id]);
   assert.deepEqual(await store.fulfill(b.id),results[0]);assert.deepEqual(await marker(b),receipt);assert.deepEqual(await listing(b),{...before,status:'archived'});
   const second=await make();let transactions=0;
   const lost=new PostgresListingPaymentFulfillmentStore({transaction:async work=>{transactions++;await db.transaction(work);throw Error('Synthetic lost COMMIT');}},merchant);
   await assert.rejects(lost.fulfill(second.id),/Synthetic lost COMMIT/);assert.equal(transactions,1);
   const committed=await listing(second);assert.equal(committed.status,'published');assert.equal((await marker(second)).length,1);
   assert.equal((await store.fulfill(second.id)).state,'fulfilled');assert.deepEqual(await listing(second),committed);
  });
  await suite.test('a worker cannot fulfill an order from a different merchant or TEST/LIVE mode',async()=>{
   const b=await make(),before=await listing(b);
   for(const scope of [{shopId:'other-shop',isTest:true},{shopId:merchant.shopId,isTest:false}]){
    await assert.rejects(new PostgresListingPaymentFulfillmentStore(db,scope).fulfill(b.id),period.PaymentPublicationError);
    assert.deepEqual(await listing(b),before);assert.equal((await marker(b)).length,0);
   }
   for(const scope of [null,{shopId:'bad?shop',isTest:true},{shopId:merchant.shopId,isTest:'true'}])
    assert.throws(()=>new PostgresListingPaymentFulfillmentStore(db,scope),period.PaymentPublicationError);
  });
  await suite.test('authorization alone, missing capture and refunded financial state do not publish or fake a failed charge',async()=>{
   for(const options of [{status:'waiting_for_capture',capturedAt:null},{capturedAt:null},{}]){
    const b=await make(options);if(Object.keys(options).length===0)await admin.query("update app.payment_orders set status='refunded' where id=$1",[b.id]);
    const before=await listing(b);assert.notEqual((await store.fulfill(b.id)).state,'fulfilled');assert.deepEqual(await listing(b),before);assert.equal((await marker(b)).length,0);
    const state=(await admin.query('select status from app.payment_orders where id=$1',[b.id])).rows[0].status;
    assert.equal(state,Object.keys(options).length===0?'refunded':options.status==='waiting_for_capture'?'pending':'succeeded');
   }
  });
  await suite.test('changed revision or owner, withdrawn approval, blocked account and inactive category cannot spend the old approval',async()=>{
   for(const patch of ['revision=revision+1',"author_id=(select id from app.users where id<>$2 limit 1)","status='archived'"]){
    const b=await make();await admin.query(`update app.listings set ${patch} where id=$1 and author_id=$2`,[b.targetId,b.ownerId]);
    const before=await listing(b);assert.equal((await store.fulfill(b.id)).state,'blocked');assert.deepEqual(await listing(b),before);assert.equal((await marker(b)).length,0);
   }
   for(const kind of ['approval','blocked','unverified','category']){
    const b=await make();
    if(kind==='approval')await admin.query("update app.listing_moderation set state='rejected',decision_note='Синтетическая отмена' where listing_id=$1",[b.targetId]);
    if(kind==='blocked')await admin.query('update app.users set is_blocked=true where id=$1',[b.ownerId]);
    if(kind==='unverified')await admin.query('update app.users set email_verified_at=null where id=$1',[b.ownerId]);
    if(kind==='category')await admin.query('update app.categories set active=false where id=(select category_id from app.listings where id=$1)',[b.targetId]);
    try{assert.equal((await store.fulfill(b.id)).state,'blocked');assert.equal((await listing(b)).status,'draft');assert.equal((await marker(b)).length,0);}
    finally{if(kind==='category')await admin.query('update app.categories set active=true where id=(select category_id from app.listings where id=$1)',[b.targetId]);}
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[b.id])).rows[0].status,'succeeded');
   }
  });
  await suite.test('expired capture never grants a fresh period and future capture cannot publish early',async()=>{
   const expired=await make({capturedAt:'2000-01-01T00:00:00.123456789Z'});
   const future=(await admin.query(`select to_char((clock_timestamp()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
   for(const b of [expired,await make({capturedAt:future})]){
    assert.equal((await store.fulfill(b.id)).state,'blocked');assert.equal((await listing(b)).is_paid,false);assert.equal((await marker(b)).length,0);
   }
   const backwards=await make();await admin.query('update app.listings set created_at=clock_timestamp() where id=$1',[backwards.targetId]);
   assert.equal((await store.fulfill(backwards.id)).state,'blocked');assert.equal((await listing(backwards)).is_paid,false);assert.equal((await marker(backwards)).length,0);
  });
  await suite.test('receipt failure rolls publication back and receipt history cannot be updated, deleted or rolled back nonempty',async()=>{
   const b=await make();const before=await listing(b);
   const denied=new PostgresListingPaymentFulfillmentStore({transaction:work=>db.transaction(tx=>work({query:async(sql,args)=>{
    if(sql.startsWith('insert into app.payment_fulfillments'))throw Error('Synthetic receipt failure');return tx.query(sql,args);
   }}))},merchant);
   await assert.rejects(denied.fulfill(b.id),/Synthetic receipt failure/);assert.deepEqual(await listing(b),before);assert.equal((await marker(b)).length,0);
   await store.fulfill(b.id);
   for(const sql of ['update app.payment_fulfillments set expires_at=expires_at where intent_id=$1','delete from app.payment_fulfillments where intent_id=$1'])await assert.rejects(admin.query(sql,[b.id]),{code:'23514'});
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty payment fulfillments/);}finally{await admin.query('rollback');}
   assert.equal((await marker(b)).length,1);
   for(const sql of ["update app.payment_orders set status='succeeded' where false",'select email,password_hash from app.users','delete from app.payment_fulfillments where false'])await assert.rejects(db.query(sql),{code:'42501'});
  });
 }finally{await db.close();}
}
