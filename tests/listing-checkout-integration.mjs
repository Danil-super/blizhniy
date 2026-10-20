import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {bootstrapPostgres,getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {loadAdminModule} from './admin-module.mjs';
import {listingCheckoutModule} from './listing-checkout-module.mjs';
import {formModule} from './listing-form-module.mjs';
import {moderationModule} from './listing-moderation-module.mjs';
import {PostgresListingDraftStore,ListingDraftAccessError,ListingDraftConflictError} from './listing-draft-module.mjs';
import {ListingCheckoutInputError,ListingCheckoutConflictError,ListingCheckoutUnavailableError} from '../src/lib/listing-checkout-contract.ts';
const {PostgresListingCheckoutStore}=listingCheckoutModule;
const {AppSessionAccessError}=loadAdminModule('app-session-transaction');
export async function testListingCheckout(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const target=`${config.host}:${config.database}`;
 const before=(await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 const down=readFileSync(new URL('../database/migrations/0020-payment-orders.down.sql',import.meta.url),'utf8');
 await suite.test('checkout orders are an explicit additive upgrade with no runtime privileges and a tested empty down',async()=>{
  assert.equal(before.length,19);assert.equal((await bootstrapPostgres(admin,target,{includePaymentOrders:true})).applied,1);
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,getBootstrapPlan({includePaymentOrders:true}).map(({name,sha256})=>({name,sha256})));
  assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.payment_orders','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as allowed")).rows[0].allowed,false);
  await admin.query(down);await admin.query("delete from blizhniy_meta.migrations where name='0020-payment-orders.sql'");
  assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows,before);
  assert.equal((await bootstrapPostgres(admin,target,{includePaymentOrders:true})).applied,1);
  assert.equal((await bootstrapPostgres(admin,target,{includePaymentOrders:true})).applied,0);
 });
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,
  BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'});
 const checkoutConfig={shopId:'fixture-shop',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1};
 const store=new PostgresListingCheckoutStore(db,checkoutConfig),forms=new (formModule('postgres-listing-form').PostgresListingFormStore)(db);
 const moderation=new moderationModule.PostgresListingModerationStore(db);
 const users=(await admin.query(`insert into app.users(email,password_hash,role,email_verified_at)
  select x.email,$1,x.role,clock_timestamp() from jsonb_to_recordset($2::jsonb) x(email text,role text) returning id,role,email`,
  [`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,JSON.stringify(['owner','other','admin'].map(name=>({email:`checkout-${name}-${randomUUID()}@example.invalid`,role:name==='admin'?'admin':'user'})))])).rows;
 const [owner,other,moderator]=['owner','other','admin'].map(name=>users.find(row=>row.email.startsWith(`checkout-${name}-`)));
 const session=async(user,short=false,scope='app')=>{const token=randomBytes(32).toString('hex');await admin.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
  select $1,id,auth_version,$2,clock_timestamp()+$3::interval from app.users where id=$4`,[hashSessionToken(token),scope,short?'0.4 seconds':'7 hours',user.id]);return token;};
 let token=await session(owner);const otherToken=await session(other),adminToken=await session(moderator);
 const oldOffer=(await admin.query("select id,price::text,duration_days,active from app.tariffs where action='listing_publication'")).rows[0];
 const draft=async(approved=true)=>{
  const created=await new PostgresListingDraftStore(db).createEmpty(token,owner.id,randomUUID());
  const saved=await forms.update(token,owner.id,created.id,created.revision,{kind:'prodam',title:'Синтетическое размещение',description:'Проверка новой оплаты.',categorySlug:'otdyh',subcategoryName:'Турбазы',cityName:'Краснодар',contactPhone:'+79990000000',photoIds:[]});
  if(approved){const request=await moderation.submit(token,owner.id,saved.id,saved.revision);await moderation.decide(adminToken,request.id,'approved',null,moderator.id);}return saved;
 };
 const input=(saved,key=randomUUID())=>({listingId:saved.id,expectedRevision:saved.revision,creationKey:key,expectedTariffId:oldOffer.id,expectedAmount:'199.99',expectedDurationDays:30});
 const count=async()=>(await admin.query('select count(*)::int as n from app.payment_orders where owner_id=$1',[owner.id])).rows[0].n;
 let saved,prepared,originalInput;
 try{
  await suite.test('owned checkout fixture grants only order/intent preparation, never finance, dispatch or publication updates',async()=>{
   await assert.rejects(db.query('select * from app.payment_orders limit 0'),{code:'42501'});
   await admin.query(`grant select,insert(id,owner_id,creation_key,target_type,target_id,target_revision) on app.payment_orders to blizhniy_runtime;
    grant select,insert(id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body) on app.payment_checkout_intents to blizhniy_runtime`);
   for(const sql of ["update app.payment_orders set status='succeeded' where false",'delete from app.payment_orders where false',"update app.listings set is_paid=true where false",'select * from app.payment_dispatch_anchors limit 0','select * from app.payment_provider_links limit 0'])await assert.rejects(db.query(sql),{code:'42501'});
   await admin.query('update app.tariffs set price=199.99,duration_days=30,active=true where id=$1',[oldOffer.id]);
  });
  await suite.test('ordinary checkout requires a live owner session, current exact revision and actual moderator approval',async()=>{
   const pending=await draft(false),attempt=input(pending);
   await assert.rejects(store.prepare(token,owner.id,attempt),ListingCheckoutUnavailableError);
   const request=await moderation.submit(token,owner.id,pending.id,pending.revision);
   await assert.rejects(store.prepare(token,owner.id,attempt),ListingCheckoutUnavailableError);
   await moderation.decide(adminToken,request.id,'rejected','Исправьте описание',moderator.id);
   await assert.rejects(store.prepare(token,owner.id,attempt),ListingCheckoutUnavailableError);
   saved=await draft();
   await assert.rejects(store.prepare(otherToken,owner.id,input(saved)),AppSessionAccessError);
   for(const [credential,user] of [[otherToken,other],[adminToken,moderator]])await assert.rejects(store.prepare(credential,user.id,input(saved)),ListingDraftAccessError);
   await assert.rejects(store.prepare(token,owner.id,{...input(saved),expectedRevision:'1'}),ListingDraftConflictError);
   await assert.rejects(store.prepare(await session(owner,false,'data-subject'),owner.id,input(saved)),AppSessionAccessError);
   const revoked=await session(owner);await admin.query('delete from app.sessions where token_hash=$1',[hashSessionToken(revoked)]);
   await assert.rejects(store.prepare(revoked,owner.id,input(saved)),AppSessionAccessError);
   assert.equal(await count(),0);
  });
  await suite.test('server offer changes require fresh user consent; inactive tariffs/categories and zero-charge requests cannot create orders',async()=>{
   for(const patch of [{expectedAmount:'199.98'},{expectedDurationDays:31},{expectedTariffId:'different-tariff'}])await assert.rejects(store.prepare(token,owner.id,{...input(saved),...patch}),ListingCheckoutConflictError);
   for(const sql of ['price=0','active=false','duration_days=null']){
    await admin.query(`update app.tariffs set ${sql} where id=$1`,[oldOffer.id]);
    try{await assert.rejects(store.prepare(token,owner.id,input(saved)),ListingCheckoutUnavailableError);}finally{await admin.query('update app.tariffs set price=199.99,duration_days=30,active=true where id=$1',[oldOffer.id]);}
   }
   const category=(await admin.query('select category_id as id from app.listings where id=$1',[saved.id])).rows[0];
   await admin.query('update app.categories set active=false where id=$1',[category.id]);
   try{await assert.rejects(store.prepare(token,owner.id,input(saved)),ListingCheckoutUnavailableError);}finally{await admin.query('update app.categories set active=true where id=$1',[category.id]);}
   await assert.rejects(store.prepare(token,owner.id,{...input(saved),status:'succeeded'}),ListingCheckoutInputError);assert.equal(await count(),0);
  });
  await suite.test('prepare atomically freezes one order and original verified payer receipt while leaving target unpaid and unpublished',async()=>{
   originalInput=input(saved);const before=(await admin.query('select status,is_paid,published_at,expires_at,revision::text from app.listings where id=$1',[saved.id])).rows[0];
   const quote=await store.preview(token,owner.id,saved.id,saved.revision);assert.equal(quote.tariff.amount,'199.99');assert.equal(quote.activePayment,null);
   prepared=await store.prepare(token,owner.id,originalInput);assert.equal(prepared.status,'created');assert.equal(prepared.amount,'199.99');assert.equal(prepared.creationKey,originalInput.creationKey);assert.equal(prepared.targetRevision,saved.revision);
   const row=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[prepared.id])).rows[0];
   const body=JSON.parse(row.request_body);assert.equal(body.receipt.customer.email,owner.email);assert.equal(body.receipt.items[0].amount.value,'199.99');assert.equal(body.receipt.items[0].vat_code,1);assert.equal(body.metadata.localPaymentId,prepared.id);assert.equal(body.confirmation.return_url,`${checkoutConfig.siteOrigin}/oplata/${prepared.id}`);
   assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at,revision::text from app.listings where id=$1',[saved.id])).rows[0],before);
   for(const secret of [owner.email,'requestBody','receipt','sha256','shopId','ownerId'])assert.equal(JSON.stringify(prepared).includes(secret),false);
   assert.equal(await count(),1);assert.deepEqual(await store.readIntent(token,owner.id,originalInput.creationKey),prepared);assert.equal(await store.readIntent(otherToken,other.id,originalInput.creationKey),null);
  });
  await suite.test('same-key replay preserves the original bytes through tariff, email and receipt-config drift, but rejects changed intent payload',async()=>{
   const original=(await admin.query('select request_body from app.payment_checkout_intents where id=$1',[prepared.id])).rows[0].request_body;
   await admin.query('update app.tariffs set price=250,duration_days=45,active=false where id=$1',[oldOffer.id]);
   await admin.query('update app.users set email=$2 where id=$1',[owner.id,`changed-${randomUUID()}@example.invalid`]);
   token=await session(owner);
   try{
    const drift=new PostgresListingCheckoutStore(db,{...checkoutConfig,siteOrigin:'https://changed.example.invalid',receiptVatCode:99});
    assert.deepEqual(await drift.prepare(token,owner.id,originalInput),prepared);
    assert.equal((await admin.query('select request_body from app.payment_checkout_intents where id=$1',[prepared.id])).rows[0].request_body,original);
    for(const patch of [{expectedAmount:'250.00'},{expectedDurationDays:45},{expectedRevision:'3'},{listingId:randomUUID()}])await assert.rejects(drift.prepare(token,owner.id,{...originalInput,...patch}),ListingCheckoutConflictError);
   }finally{await admin.query('update app.users set email=$2 where id=$1',[owner.id,owner.email]);token=await session(owner);await admin.query('update app.tariffs set price=199.99,duration_days=30,active=true where id=$1',[oldOffer.id]);}
   assert.equal(await count(),1);
  });
  await suite.test('same-intent concurrency has one frozen order; competing new keys cannot create two active payments',async()=>{
   const first=await draft(),same=input(first),before=await count();
   const results=await Promise.all([store.prepare(token,owner.id,same),store.prepare(await session(owner),owner.id,same)]);
   assert.deepEqual(results[0],results[1]);assert.equal(await count(),before+1);
   const second=await draft(),outcomes=await Promise.allSettled([store.prepare(token,owner.id,input(second)),store.prepare(await session(owner),owner.id,input(second))]);
   assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected'&&row.reason instanceof ListingCheckoutConflictError).length,1);assert.equal(await count(),before+2);
   const active=(await store.preview(token,owner.id,second.id,second.revision)).activePayment;assert.ok(active);assert.equal(active.amount,'199.99');
  });
  await suite.test('unknown committed preparation is recovered by the original key without another order or request body',async()=>{
   const current=await draft(),request=input(current),before=await count();let attempts=0;
   const uncertain=new PostgresListingCheckoutStore({transaction:async work=>{attempts++;await db.transaction(work);throw new Error('Synthetic lost COMMIT reply');}},checkoutConfig);
   await assert.rejects(uncertain.prepare(token,owner.id,request),/Synthetic lost COMMIT/);assert.equal(attempts,1);assert.equal(await count(),before+1);
   const recovered=await store.readIntent(token,owner.id,request.creationKey);assert.ok(recovered);assert.equal(recovered.status,'created');assert.deepEqual(await store.prepare(token,owner.id,request),recovered);assert.equal(await count(),before+1);
  });
  await suite.test('failure between order and body, invalid config and session expiry roll back the whole new checkout',async()=>{
   const current=await draft(),before=await count();let reached=false;
   const fault=new PostgresListingCheckoutStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    const result=await tx.query(sql,values);if(sql.startsWith('insert into app.payment_checkout_intents')){reached=true;throw new Error('Synthetic interrupted preparation');}return result;
   }}))},checkoutConfig);
   await assert.rejects(fault.prepare(token,owner.id,input(current)),/Synthetic interrupted/);assert.equal(reached,true);assert.equal(await count(),before);
   for(const patch of [{receiptVatCode:0},{siteOrigin:'http://site.example.invalid'},{siteOrigin:'https://site.example.invalid/untrusted'}])await assert.rejects(new PostgresListingCheckoutStore(db,{...checkoutConfig,...patch}).prepare(token,owner.id,input(current)),ListingCheckoutUnavailableError);
   assert.equal(await count(),before);let inserted=false;
   const delayed=new PostgresListingCheckoutStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{
    const result=await tx.query(sql,values);if(sql.startsWith('insert into app.payment_checkout_intents')){inserted=true;await admin.query('select pg_sleep(0.6)');}return result;
   }}))},checkoutConfig);
   await assert.rejects(delayed.prepare(await session(owner,true),owner.id,input(current)),AppSessionAccessError);assert.equal(inserted,true);assert.equal(await count(),before);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_checkout_intents where target_id=$1',[current.id])).rows[0].n,0);
  });
  await suite.test('a saved UNKNOWN payment blocks another revision after edits and reapproval; foreign or pending photos and blocked owners are rejected',async()=>{
   const changed=await forms.update(token,owner.id,saved.id,saved.revision,{...saved.form,title:'Изменено после начала оплаты'});
   await assert.rejects(store.prepare(token,owner.id,input(changed)),ListingCheckoutUnavailableError);
   const request=await moderation.submit(token,owner.id,changed.id,changed.revision);await moderation.decide(adminToken,request.id,'approved',null,moderator.id);
   await assert.rejects(store.prepare(token,owner.id,input(changed)),ListingCheckoutConflictError);
   assert.deepEqual(await store.readIntent(token,owner.id,originalInput.creationKey),prepared);
   const current=await draft(),before=await count();
   for(const who of [owner,other]){
    const media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',2,2,12,$3) returning id",[who.id,randomUUID(),'b'.repeat(64)])).rows[0];
    if(who===other)await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media.id]);
    await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[current.id,media.id]);
    try{await assert.rejects(store.prepare(token,owner.id,input(current)),ListingDraftAccessError);}finally{await admin.query('delete from app.listing_photos where listing_id=$1 and media_id=$2',[current.id,media.id]);}
   }
   await admin.query('update app.users set is_blocked=true where id=$1',[owner.id]);
   try{await assert.rejects(store.prepare(token,owner.id,input(current)),AppSessionAccessError);}finally{await admin.query('update app.users set is_blocked=false where id=$1',[owner.id]);}
   assert.equal(await count(),before);
  });
  await suite.test('SQL enforces active uniqueness, immutable order bindings, deferred body identity, monotonic status and refusal of destructive down',async()=>{
   const insert="insert into app.payment_orders(id,owner_id,creation_key,target_type,target_id,target_revision) values($1,$2,$3,'listing',$4,$5)";
   await assert.rejects(admin.query(insert,[randomUUID(),owner.id,randomUUID(),saved.id,saved.revision]),{code:'23505'});
   for(const expression of ['owner_id=gen_random_uuid()','creation_key=gen_random_uuid()','target_revision=target_revision+1','created_at=clock_timestamp()'])await assert.rejects(admin.query(`update app.payment_orders set ${expression} where id=$1`,[prepared.id]),{code:'23514'});
   await assert.rejects(admin.query('delete from app.payment_orders where id=$1',[prepared.id]),{code:'23514'});
   await admin.query("update app.payment_orders set status='pending' where id=$1",[prepared.id]);
   await assert.rejects(admin.query("update app.payment_orders set status='created' where id=$1",[prepared.id]),{code:'23514'});
   await admin.query('begin');try{
    await admin.query(insert,[randomUUID(),owner.id,randomUUID(),randomUUID(),'1']);await assert.rejects(admin.query('commit'),{code:'23503'});
   }finally{await admin.query('rollback');}
   try{await assert.rejects(admin.query(down),/Refusing to remove nonempty payment orders/);}finally{await admin.query('rollback');}
   assert.equal((await admin.query('select status from app.payment_orders where id=$1',[prepared.id])).rows[0].status,'pending');
  });
 }finally{
  await admin.query('update app.tariffs set price=$2,duration_days=$3,active=$4 where id=$1',[oldOffer.id,oldOffer.price,oldOffer.duration_days,oldOffer.active]);await db.close();
 }
}
