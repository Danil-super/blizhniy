import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {listingCheckoutModule} from './listing-checkout-module.mjs';
import {createListingCheckoutHandler} from './listing-checkout-http-module.mjs';

export async function testListingCheckoutPermissions(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'blizhniy_test');
 const sql=readFileSync(new URL('../database/permissions/listing-checkout.sql',import.meta.url),'utf8');
 const db=new PostgresDatabase(new pg.Pool({...config,user:credentials.user,password:credentials.password,max:2}));
 const tables=['payment_orders','payment_checkout_intents','payment_dispatch_anchors','payment_provider_links','payment_verifications','payment_fulfillments','payment_reconciliation_jobs'];
 try{
  await suite.test('reviewed checkout grants expose exactly40 financial column privileges and no settlement or dispatch authority',async()=>{
   await admin.query('revoke all on app.payment_orders,app.payment_checkout_intents,app.payment_fulfillments from blizhniy_runtime');
   await admin.query(sql);
   const expected=new Set([
    ...'id,owner_id,creation_key,target_type,target_id,target_revision,status,created_at'.split(',').map(c=>`payment_orders.${c}:SELECT`),
    ...'id,owner_id,creation_key,target_type,target_id,target_revision'.split(',').map(c=>`payment_orders.${c}:INSERT`),
    ...'id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body,request_sha256'.split(',').map(c=>`payment_checkout_intents.${c}:SELECT`),
    ...'id,owner_id,target_type,target_id,target_revision,tariff_id,amount,duration_days,merchant_shop_id,is_test,request_body'.split(',').map(c=>`payment_checkout_intents.${c}:INSERT`),
    ...'intent_id,published_at,expires_at'.split(',').map(c=>`payment_fulfillments.${c}:SELECT`),
   ]);
   const actual=(await db.query(`select c.relname||'.'||a.attname||':'||p.privilege as key,
    has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION') as grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    where n.nspname='app' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
     and has_column_privilege(c.oid,a.attnum,p.privilege)`,[tables])).rows;
   assert.equal(expected.size,40);assert.equal(actual.length,expected.size);
   for(const row of actual){assert.equal(row.grantable,false);assert.equal(expected.delete(row.key),true);}
   assert.equal(expected.size,0);
   for(const query of ["update app.payment_orders set status='succeeded' where false",'delete from app.payment_orders where false',
    'select created_at from app.payment_checkout_intents limit 0','select fulfilled_at from app.payment_fulfillments limit 0',
    'select * from app.payment_dispatch_anchors limit 0','select * from app.payment_provider_links limit 0',
    'select * from app.payment_verifications limit 0','select * from app.payment_reconciliation_jobs limit 0',
    "update app.listings set is_paid=true where false",'insert into app.payment_fulfillments(intent_id,published_at,expires_at) select gen_random_uuid(),clock_timestamp(),clock_timestamp() where false'])
    await assert.rejects(db.query(query),{code:'42501'});
  });
  const owner=randomUUID(),other=randomUUID(),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex');
  for(const [id,credential] of [[owner,token],[other,otherToken]]){
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`checkout-permission-${id}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at) select $1,id,auth_version,'app',clock_timestamp()+interval '1 hour' from app.users where id=$2",[hashSessionToken(credential),id]);
  }
  const makeListing=async()=>{
   const id=randomUUID();
   await admin.query(`insert into app.listings(id,author_id,listing_type,category_id,city_id,title,description,contact_phone)
    select $1,$2,'sell',c.id,city.id,'Проверка подготовки заказа','Синтетическая проверка минимальных прав','+79990000000'
    from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар'`,[id,owner]);
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[id]);return id;
  };
  const offer=(await admin.query("select id,price::text as amount,duration_days as duration from app.tariffs where action='listing_publication'")).rows[0];
  const store=new listingCheckoutModule.PostgresListingCheckoutStore(db,{shopId:'restricted-checkout',isTest:true,siteOrigin:'https://site.example.invalid',receiptVatCode:1});
  const handler=createListingCheckoutHandler({origin:'https://site.example.invalid'},()=>({store,limiter:{allowProduction:async()=>true}}),()=>{});
  const request=(body,method='POST',credential=token,expectedOwnerId=owner)=>new Request('https://site.example.invalid/api/account/listing-checkout',{method,headers:{host:'site.example.invalid',origin:'https://site.example.invalid','x-blizhniy-request':'1','x-real-ip':'192.0.2.5','content-type':'application/json',cookie:`__Host-blizhniy_session=${credential}`},body:JSON.stringify({expectedOwnerId,...body})});
  const input=id=>({listingId:id,expectedRevision:'1',creationKey:randomUUID(),expectedTariffId:offer.id,expectedAmount:offer.amount,expectedDurationDays:offer.duration});
  await suite.test('restricted HTTP prepares, replays and reads one TEST order, rejects another account and leaves publication unchanged',async()=>{
   const id=await makeListing(),body=input(id),before=(await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[id])).rows[0];
   const response=await handler(request(body,'PUT'));assert.equal(response.status,200);const order=await response.json();assert.equal(order.status,'created');
   assert.deepEqual(await(await handler(request(body,'PUT'))).json(),order);
   assert.deepEqual(await(await handler(request({action:'intent',creationKey:body.creationKey}))).json(),order);
   assert.deepEqual(await(await handler(request({action:'order',paymentId:order.id}))).json(),{order,fulfillment:null});
   assert.equal((await handler(request(body,'PUT',otherToken))).status,401);
   assert.equal((await handler(request(body,'PUT',otherToken,other))).status,404);
   assert.equal(await(await handler(request({action:'order',paymentId:order.id},'POST',otherToken,other))).json(),null);
   assert.equal((await admin.query('select count(*)::int as n from app.payment_orders where owner_id=$1',[owner])).rows[0].n,1);
   assert.deepEqual((await admin.query('select status,is_paid,published_at,expires_at from app.listings where id=$1',[id])).rows[0],before);
   assert.equal(JSON.stringify(order).includes('@'),false);
  });
  await suite.test('removing the required request-body INSERT makes preparation fail atomically; restoring the same plan recovers with the original key',async()=>{
   const body=input(await makeListing());await admin.query('revoke insert(request_body) on app.payment_checkout_intents from blizhniy_runtime');
   try{
    const response=await handler(request(body,'PUT'));assert.equal(response.status,503);
    assert.equal((await admin.query('select count(*)::int as n from app.payment_orders where creation_key=$1',[body.creationKey])).rows[0].n,0);
   }finally{await admin.query(sql);}
   const response=await handler(request(body,'PUT'));assert.equal(response.status,200);assert.equal((await response.json()).creationKey,body.creationKey);
  });
  await suite.test('permission rollback removes the40 additions without erasing historical orders, and reapplying the plan preserves them',async()=>{
   const before=(await admin.query('select id,status from app.payment_orders where owner_id=$1 order by id',[owner])).rows;
   const down=readFileSync(new URL('../database/permissions/listing-checkout-revoke.sql',import.meta.url),'utf8');
   await admin.query(down);
   try{
    const remaining=(await db.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     join pg_attribute a on a.attrelid=c.oid cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
     where n.nspname='app' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
      and has_column_privilege(c.oid,a.attnum,p.privilege)`,[tables])).rows;
    assert.equal(remaining.length,0);
    assert.deepEqual((await admin.query('select id,status from app.payment_orders where owner_id=$1 order by id',[owner])).rows,before);
   }finally{await admin.query(sql);}
   await admin.query(sql);
   assert.equal((await handler(request({action:'order',paymentId:before[0].id}))).status,200);
  });
 }finally{await db.close();}
}
