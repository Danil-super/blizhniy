import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';
import {createPrimaryPaymentDispatcher} from '../src/lib/primary-payment-dispatch.ts';
import {PostgresPaymentVerificationStore} from '../src/lib/postgres-payment-verification.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import * as intentModule from '../src/lib/postgres-payment-intents.ts';
import * as periodModule from '../src/lib/payment-publication-period.ts';
import {formModule} from './listing-form-module.mjs';
import {listingCheckoutModule} from './listing-checkout-module.mjs';
import {bookingDetails} from './listing-publication-check-module.mjs';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';

export async function testPrimaryPaymentDispatch(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');
 const journalBefore=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 assert.equal(journalBefore.length,22);
 const worker='payment_dispatch_fixture',password=randomUUID();
 await admin.query(`create role ${worker} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password '${password}';
  grant connect on database blizhniy_test to ${worker};grant usage on schema app to ${worker};
  grant select on app.payment_checkout_intents,app.payment_dispatch_anchors,app.payment_provider_links to ${worker};
  grant update(id) on app.payment_checkout_intents to ${worker};
  grant insert(intent_id) on app.payment_dispatch_anchors to ${worker};
  grant insert(intent_id,provider_payment_id) on app.payment_provider_links to ${worker}`);
 const db=new PostgresDatabase(new pg.Pool({...config,user:worker,password,max:4}));
 const intents=new PostgresPaymentIntentStore(db),merchant={shopId:'fixture-shop',isTest:true,secretKey:'test_synthetic_fixture_only'};
 const make=async()=>{
  const b={id:randomUUID(),ownerId:randomUUID(),targetType:'listing',targetId:randomUUID(),targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:merchant.shopId,isTest:true};
  const requestBody=` ${JSON.stringify({amount:{value:b.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/original-return'},receipt:{customer:{email:'synthetic-payer@example.invalid'},internet:true,items:[{description:'Исходный чек',quantity:1,amount:{value:b.amount,currency:'RUB'},vat_code:1,payment_mode:'full_payment',payment_subject:'service'}]},metadata:{localPaymentId:b.id,targetId:b.targetId,targetType:b.targetType,tariffId:b.tariffId}})}\n`;
  await admin.query('begin');try{
   await intents.persistInTransaction(admin,{...b,requestBody});
   await admin.query('insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,$4,$5,$6::bigint)',[b.id,b.ownerId,randomUUID(),b.targetType,b.targetId,b.targetRevision]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}
  return{binding:b,requestBody,providerId:randomUUID()};
 };
 const response=(f,status='pending')=>({id:f.providerId,status,paid:status==='succeeded',test:true,amount:{value:f.binding.amount,currency:'RUB'},recipient:{account_id:merchant.shopId},metadata:{localPaymentId:f.binding.id,targetId:f.binding.targetId,targetType:f.binding.targetType,tariffId:f.binding.tariffId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/fixture-checkout'}});
 const link=async f=>(await admin.query('select provider_payment_id from app.payment_provider_links where intent_id=$1',[f.binding.id])).rows;
 try{
  await suite.test('actual PostgreSQL dispatch commits original receipt and first anchor before remote I/O and links only a validated provider response',async()=>{
   const f=await make();let calls=0;
   const dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(url,init)=>{
    calls++;assert.equal(url,'https://api.yookassa.ru/v3/payments');assert.equal(init.method,'POST');assert.equal(init.body,f.requestBody);assert.equal(init.headers['Idempotence-Key'],f.binding.id);
    assert.equal((await admin.query('select intent_id from app.payment_dispatch_anchors where intent_id=$1',[f.binding.id])).rowCount,1);
    await admin.query('begin');try{await admin.query('select id from app.payment_checkout_intents where id=$1 for update nowait',[f.binding.id]);}finally{await admin.query('rollback');}
    assert.equal((await link(f)).length,0);return Response.json(response(f));
   });
   assert.deepEqual(await dispatcher.dispatch(f.binding),{providerPaymentId:f.providerId,confirmationUrl:'https://yoomoney.ru/fixture-checkout'});assert.equal(calls,1);
   assert.deepEqual(await link(f),[{provider_payment_id:f.providerId}]);
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[f.binding.id])).rows[0].status,'created');
   for(const sql of ['select * from app.users limit 0',"update app.payment_orders set status='succeeded' where false",'insert into app.payment_verifications(intent_id,provider_payment_id,status) select gen_random_uuid(),gen_random_uuid(),\'succeeded\' where false',"update app.listings set is_paid=true where false"])
    await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('lost remote response and process restart adopt the same synthetic provider operation and immutable anchor',async()=>{
   const f=await make(),calls=[],remote=new Map();let fail=true;
   const fetcher=async(_url,init)=>{
    calls.push({method:init.method,key:init.headers['Idempotence-Key'],body:init.body});
    if(init.method==='GET')return Response.json(response(f));
    const key=init.headers['Idempotence-Key'];
    if(remote.has(key))assert.equal(remote.get(key),init.body);else remote.set(key,init.body);
    if(fail)throw Error('Synthetic lost response');return Response.json(response(f));
   };
   await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,fetcher).dispatch(f.binding));assert.equal(calls.length,3);assert.equal(remote.size,1);assert.equal((await link(f)).length,0);
   const anchor=(await admin.query('select authorized_at::text as value from app.payment_dispatch_anchors where intent_id=$1',[f.binding.id])).rows[0].value;
   fail=false;assert.equal((await createPrimaryPaymentDispatcher(db,merchant,fetcher).dispatch(f.binding)).providerPaymentId,f.providerId);
   assert.equal((await admin.query('select authorized_at::text as value from app.payment_dispatch_anchors where intent_id=$1',[f.binding.id])).rows[0].value,anchor);
   assert.equal(remote.size,1);for(const call of calls)assert.deepEqual(call,{method:'POST',key:f.binding.id,body:f.requestBody});
   await createPrimaryPaymentDispatcher(db,merchant,fetcher).dispatch(f.binding);assert.equal(calls.at(-1).method,'GET');assert.equal(remote.size,1);
  });
  await suite.test('parallel dispatchers share one immutable key/body and adopt the same validated provider identity',async()=>{
   const f=await make(),requests=[],remote=new Map();
   const fetcher=async(_url,init)=>{
    requests.push(init.method);if(init.method==='POST'){
     const key=init.headers['Idempotence-Key'];if(remote.has(key))assert.equal(remote.get(key),init.body);else remote.set(key,init.body);
    }
    return Response.json(response(f));
   };
   const dispatcher=createPrimaryPaymentDispatcher(db,merchant,fetcher),results=await Promise.all([dispatcher.dispatch(f.binding),dispatcher.dispatch(f.binding)]);
   assert.deepEqual(results[0],results[1]);assert.equal(remote.size,1);assert.equal((await link(f)).length,1);assert.equal(requests.length,2);
  });
  await suite.test('unknown binding COMMIT remains readable and cannot trigger an internal new POST',async()=>{
   const f=await make();let transactions=0;const methods=[];
   const dispatcher=createPrimaryPaymentDispatcher({transaction:async work=>{
    const result=await db.transaction(work);if(++transactions===3)throw Error('Synthetic lost binding COMMIT');return result;
   }},merchant,async(_url,init)=>{methods.push(init.method);return Response.json(response(f));});
   await assert.rejects(dispatcher.dispatch(f.binding),/Synthetic lost binding COMMIT/);assert.deepEqual(methods,['POST']);assert.equal((await link(f)).length,1);
   await dispatcher.dispatch(f.binding);assert.deepEqual(methods,['POST','GET']);
  });
  await suite.test('expired original authorization refuses unknown-ID POST but still permits known-ID GET, including a changed merchant refusal before network',async()=>{
   const f=await make();await intents.authorize(f.binding);
   // Only SQL-owner changes the exact disposable fixture's clock anchor; production has no override.
   await admin.query('begin');try{
    await admin.query('alter table app.payment_dispatch_anchors disable trigger user');
    await admin.query("update app.payment_dispatch_anchors set authorized_at=clock_timestamp()-interval '24 hours' where intent_id=$1",[f.binding.id]);
    await admin.query('alter table app.payment_dispatch_anchors enable trigger user');await admin.query('commit');
   }catch(error){await admin.query('rollback');throw error;}
   const methods=[],dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{methods.push(init.method);return Response.json(response(f));});
   await assert.rejects(dispatcher.dispatch(f.binding));assert.deepEqual(methods,[]);
   await intents.bindProvider(f.binding,f.providerId);await dispatcher.dispatch(f.binding);assert.deepEqual(methods,['GET']);
   await assert.rejects(createPrimaryPaymentDispatcher(db,{...merchant,shopId:'other'},async()=>{throw Error('Unexpected network');}).dispatch(f.binding));
   assert.deepEqual(methods,['GET']);
  });
  await suite.test('bad binding/hostile replies never link, change order status, mutate the original body or issue a new key',async()=>{
   for(const patch of [{amount:{value:'200.00',currency:'RUB'}},{recipient:{account_id:'other'}},{metadata:{}},{confirmation:{type:'redirect',confirmation_url:'https://evil.example.invalid'}}]){
    const f=await make();let calls=0;
    await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json({...response(f),...patch});}).dispatch(f.binding));
    assert.equal(calls,1);assert.equal((await link(f)).length,0);
    assert.equal((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[f.binding.id])).rows[0].request_body,f.requestBody);
    assert.equal((await admin.query('select status from app.payment_orders where id=$1',[f.binding.id])).rows[0].status,'created');
   }
   assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,journalBefore);
  });
  await suite.test('local ordinary-listing pipeline composes live-session checkout, dispatch, authoritative GET, once-only fulfillment and public read',async()=>{
   // Composition proof only: previous fixtures separately enforce restricted verification/fulfillment roles.
   const ownerDb=new PostgresDatabase(new pg.Pool({...config,max:4}));
   try{
    const owner=randomUUID(),target=randomUUID(),token=randomBytes(32).toString('hex'),email=`pipeline-${owner}@example.invalid`;
    await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
     [owner,email,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
    await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at) select $1,id,auth_version,'app',clock_timestamp()+interval '7 hours' from app.users where id=$2",[hashSessionToken(token),owner]);
    await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
     select $1,$2,'sell',c.id,city.id,'Синтетическая сквозная публикация','Локальная проверка без настоящего магазина','+79990000000'
     from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[target,owner]);
    await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[target]);
    const offer=(await admin.query("select id,price::text as amount,duration_days as duration from app.tariffs where action='listing_publication'")).rows[0];
    const checkout=new listingCheckoutModule.PostgresListingCheckoutStore(ownerDb,{...merchant,siteOrigin:'https://site.example.invalid',receiptVatCode:1});
    const http=createListingCheckoutHandler({origin:'https://site.example.invalid'},()=>({store:checkout,limiter:{allowProduction:async()=>true}}),()=>{});
    const accountRequest=(body,method='POST')=>new Request('https://site.example.invalid/api/account/listing-checkout',{method,headers:{host:'site.example.invalid',origin:'https://site.example.invalid','x-blizhniy-request':'1','x-real-ip':'192.0.2.4','content-type':'application/json',cookie:`__Host-blizhniy_session=${token}`},body:JSON.stringify({expectedOwnerId:owner,...body})});
    const preparation={listingId:target,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:offer.id,expectedAmount:offer.amount,expectedDurationDays:offer.duration};
    const prepared=await http(accountRequest(preparation,'PUT'));assert.equal(prepared.status,200);const order=await prepared.json();
    const replay=await http(accountRequest(preparation,'PUT'));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),order);
    const recovered=await http(accountRequest({action:'intent',creationKey:preparation.creationKey}));assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),order);
    assert.deepEqual(await checkout.readOrder(token,owner,order.id),{order,fulfillment:null});
    const runtimeDb=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password,max:2}));
    try{
     const scoped=new listingCheckoutModule.PostgresListingCheckoutStore(runtimeDb,{...merchant,siteOrigin:'https://site.example.invalid',receiptVatCode:1});
     await assert.rejects(scoped.readOrder(token,owner,order.id),{code:'42501'});
     // Disposable DB only: three read columns, never receipt/finance/publication writes.
     await admin.query('grant select(intent_id,published_at,expires_at) on app.payment_fulfillments to blizhniy_runtime');
     assert.deepEqual(await scoped.readOrder(token,owner,order.id),{order,fulfillment:null});
     for(const sql of ['select fulfilled_at from app.payment_fulfillments limit 0','insert into app.payment_fulfillments(intent_id,published_at,expires_at) select gen_random_uuid(),clock_timestamp(),clock_timestamp() where false',"update app.payment_orders set status='succeeded' where false"])
      await assert.rejects(runtimeDb.query(sql),{code:'42501'});
    }finally{await runtimeDb.close();}
    assert.equal(await checkout.readOrder(token,owner,randomUUID()),null);
    assert.equal(await new listingCheckoutModule.PostgresListingCheckoutStore(ownerDb,{...merchant,shopId:'wrong-shop',siteOrigin:'https://site.example.invalid',receiptVatCode:1}).readOrder(token,owner,order.id),null);
    assert.equal(await new listingCheckoutModule.PostgresListingCheckoutStore(ownerDb,{...merchant,isTest:false,siteOrigin:'https://site.example.invalid',receiptVatCode:1}).readOrder(token,owner,order.id),null);
    const foreignOwner=randomUUID(),foreignToken=randomBytes(32).toString('hex');
    await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
     [foreignOwner,`foreign-checkout-${foreignOwner}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
    await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at) select $1,id,auth_version,'app',clock_timestamp()+interval '7 hours' from app.users where id=$2",[hashSessionToken(foreignToken),foreignOwner]);
    assert.equal(await checkout.readOrder(foreignToken,foreignOwner,order.id),null);
    await assert.rejects(checkout.readOrder(token,randomUUID(),order.id));
    const statusRequest=()=>accountRequest({action:'order',paymentId:order.id});
    const initial=await http(statusRequest());assert.equal(initial.status,200);assert.deepEqual(await initial.json(),{order,fulfillment:null});
    const b={id:order.id,ownerId:owner,targetType:'listing',targetId:target,targetRevision:order.targetRevision,tariffId:order.tariffId,amount:order.amount,durationDays:order.durationDays,shopId:merchant.shopId,isTest:true};
    const original=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[order.id])).rows[0].request_body;
    assert.equal(JSON.parse(original).receipt.customer.email,email);
    const f={binding:b,providerId:randomUUID()},methods=[];
    const captured=(await admin.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`)).rows[0].value;
    const fetcher=async(url,init)=>{
     methods.push(init.method);
     if(init.method==='POST'){
      assert.equal(init.body,original);assert.equal(init.headers['Idempotence-Key'],order.id);return Response.json(response(f));
     }
     assert.equal(url,`https://api.yookassa.ru/v3/payments/${f.providerId}`);return Response.json({...response(f,'succeeded'),captured_at:captured});
    };
    const {PostgresListingPaymentFulfillmentStore}=formModule('postgres-listing-payment-fulfillment',{
     './postgres-listing-form':formModule('postgres-listing-form'),'./postgres-payment-intents.ts':intentModule,'./payment-publication-period.ts':periodModule,
    });
    const fulfill=new PostgresListingPaymentFulfillmentStore(ownerDb,merchant),dispatcher=createPrimaryPaymentDispatcher(db,merchant,fetcher);
    await dispatcher.dispatch(b);
    assert.equal((await fulfill.fulfill(order.id)).state,'not_ready');
    assert.equal((await admin.query('select status from app.listings where id=$1',[target])).rows[0].status,'draft');
    const verifier=new PostgresPaymentVerificationStore(ownerDb,merchant,fetcher);
    assert.equal((await verifier.reconcile(order.id)).orderStatus,'succeeded');
    const result=await fulfill.fulfill(order.id);assert.equal(result.state,'fulfilled');
    const visible=await checkout.readOrder(token,owner,order.id);assert.equal(visible.order.status,'succeeded');
    assert.deepEqual(visible.fulfillment,{publishedAt:result.period.publishedAt,expiresAt:result.period.expiresAt});
    const complete=await http(statusRequest());assert.equal(complete.status,200);assert.deepEqual(await complete.json(),visible);
    const projection=formModule('public-listings',{'./booking-details':bookingDetails});
    const {PostgresPublicListingStore}=formModule('postgres-public-listings',{'./public-listings':projection,'./listing-public-eligibility':formModule('listing-public-eligibility')});
    assert.equal((await new PostgresPublicListingStore(admin).read(target)).id,target);
    const receipt=(await admin.query('select * from app.payment_fulfillments where intent_id=$1',[order.id])).rows;
    await dispatcher.dispatch(b);await verifier.reconcile(order.id);assert.deepEqual(await fulfill.fulfill(order.id),result);
    assert.deepEqual((await admin.query('select * from app.payment_fulfillments where intent_id=$1',[order.id])).rows,receipt);
    assert.deepEqual(methods,['POST','GET','GET','GET']);
    await admin.query('delete from app.sessions where token_hash=$1',[hashSessionToken(token)]);
    const revoked=await http(statusRequest());assert.equal(revoked.status,401);assert.deepEqual(await revoked.json(),{error:{code:'UNAUTHENTICATED'}});
   }finally{await ownerDb.close();}
  });
 }finally{await db.close();}
}
