import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createPostgresDatabase} from '../src/lib/postgres.ts';
import {formModule} from './listing-form-module.mjs';import {bookingDetails} from './listing-publication-check-module.mjs';import {grantBookingPublicationRead} from '../scripts/grant-booking-read.mjs';
import {grantPublicListingMetadataRead} from '../scripts/grant-public-listing-read.mjs';
import {createRequire} from 'node:module';import * as http from '../src/lib/auth-http.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
const projection=formModule('public-listings',{'./booking-details':bookingDetails}),eligibility=formModule('listing-public-eligibility');
export async function testPublicListingStore(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const {PostgresPublicListingStore}=formModule('postgres-public-listings',{'./public-listings':projection,'./listing-public-eligibility':eligibility});
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresPublicListingStore(db);
 const owner=randomUUID(),foreign=randomUUID(),ids=[];let root,child;
 try{
  for(const id of [owner,foreign])await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`public-listing-${id}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
  await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[owner,JSON.stringify({name:'Технический продавец',phone:'PRIVATE_ACCOUNT_PHONE',organizationAddress:'PRIVATE_ORGANIZATION_ADDRESS'})]);
  const refs=(await admin.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.categories where slug='sad-i-rasteniya' and parent_id is null) as root")).rows[0];root=refs.root;
  child=(await admin.query('select id,name from app.categories where parent_id=$1 order by id limit 1',[root])).rows[0];assert.ok(child);
  for(const [index,kind] of ['sell','buy','free','rent'].entries()){
   const booking=kind==='rent'?{mode:'stay',priceWeekday:100,priceWeekend:150,minNights:1,includedGuests:2,maxGuests:4}:null;
   const id=(await admin.query("insert into app.listings(author_id,listing_type,title,description,price,category_id,city_id,address,latitude,longitude,contact_phone,booking,created_at,view_count) values($1,$2,'Синтетическое объявление','Подробное синтетическое описание','1234.50',$3,$4,'PRIVATE_HIDDEN_ADDRESS',45,38,'+79990000000',$5::jsonb,clock_timestamp()-interval '2 hours',$6) returning id",[owner,kind,index===0?root:child.id,refs.city,booking===null?null:JSON.stringify(booking),index])).rows[0].id;ids.push(id);
  }
  await suite.test('public listing reader cannot use creation time or view count without explicit column SELECT, and those grants confer no write authority',async()=>{
   await grantBookingPublicationRead(admin,`${config.host}:${config.database}`);await assert.rejects(db.query('select created_at,view_count from app.listings limit 0'),{code:'42501'});
   // Owned disposable database only. The production operator is an explicit separately approved action.
   const grant=await grantPublicListingMetadataRead(admin,`${config.host}:${config.database}`);assert.deepEqual(grant,{columns:2});assert.deepEqual(await grantPublicListingMetadataRead(admin,`${config.host}:${config.database}`),grant);
   assert.equal((await db.query('select created_at,view_count from app.listings limit 0')).rowCount,0);
   for(const sql of ['update app.listings set view_count=1 where false','update app.listings set created_at=clock_timestamp() where false'])await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('metadata read operator refuses changed history or residual counter/finance writes and never retries an unknown COMMIT',async()=>{
   const target=`${config.host}:${config.database}`,prior=(await admin.query("select sha256 from blizhniy_meta.migrations where name='0018-interactions.sql'")).rows[0].sha256;
   await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0018-interactions.sql'",['0'.repeat(64)]);
   try{await assert.rejects(grantPublicListingMetadataRead(admin,target));}finally{await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0018-interactions.sql'",[prior]);}
   for(const column of ['view_count','created_at','is_paid']){await admin.query(`grant update(${column}) on app.listings to blizhniy_runtime`);try{await assert.rejects(grantPublicListingMetadataRead(admin,target));}finally{await admin.query(`revoke update(${column}) on app.listings from blizhniy_runtime`);}}
   let commits=0;const uncertain={connectionParameters:admin.connectionParameters,query:async(sql,values)=>{const result=await admin.query(sql,values);if(sql==='commit'){commits++;throw Error('Synthetic lost metadata grant COMMIT');}return result;}};
   await assert.rejects(grantPublicListingMetadataRead(uncertain,target));assert.equal(commits,1);
  });
  await suite.test('real public listing reads preserve every kind, name, price and category without exposing drafts, absent approvals or private account fields',async()=>{
   for(const id of ids){assert.equal(await store.read(id),undefined);await admin.query("update app.listings set status='published',is_paid=true,published_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '1 day' where id=$1",[id]);assert.equal(await store.read(id),undefined);
    await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[id]);const item=await store.read(id);assert.ok(item);assert.equal(item.author,'Технический продавец');assert.equal(item.city,'Краснодар');
    for(const value of ['PRIVATE_ACCOUNT_PHONE','PRIVATE_ORGANIZATION_ADDRESS','PRIVATE_HIDDEN_ADDRESS',`public-listing-${owner}@example.invalid`])assert.equal(JSON.stringify(item).includes(value),false);
   }
   assert.deepEqual((await store.list({ownerId:owner})).map(item=>item.kind).sort(),['arenda','kuplyu','otdam-darom','prodam']);assert.equal((await store.read(ids[0])).isSubcategory,false);assert.equal((await store.read(ids[1])).isSubcategory,true);
   assert.equal((await store.read(ids[0])).price,'1 234,50 ₽');assert.equal((await store.read(ids[3])).price,'от 100 ₽/сутки');
  });
  await suite.test('public list filtering is bounded, stably ordered and tied to actual root/child and owner identities, not names claimed by a caller',async()=>{
   await admin.query("update app.listings set published_at='2026-01-01T00:00:00.123456Z',created_at='2026-01-01T00:00:00.000001Z' where author_id=$1",[owner]);
   const all=await store.list({ownerId:owner}),pages=[...await store.list({ownerId:owner,limit:2}),...await store.list({ownerId:owner,limit:2,offset:2})];assert.deepEqual(pages.map(item=>item.id),all.map(item=>item.id));assert.equal(new Set(pages.map(item=>item.id)).size,4);
   assert.equal((await store.list({ownerId:owner,kind:'arenda'}))[0].id,ids[3]);assert.deepEqual(await store.list({ownerId:foreign}),[]);
   assert.equal((await store.list({ownerId:owner,categorySlug:'sad-i-rasteniya'})).length,4);assert.equal((await store.list({ownerId:owner,categorySlug:'sad-i-rasteniya',subcategoryName:child.name})).length,3);
   assert.deepEqual(await store.list({ownerId:owner,categorySlug:'nonexistent',subcategoryName:child.name}),[]);
   for(const input of [{limit:0},{limit:1001},{offset:-1},{offset:1.5},{kind:'unknown'},{ownerId:'bad'},{categorySlug:'bad?sql'},{subcategoryName:child.name},{unknown:true}])await assert.rejects(store.list(input));
  });
  await suite.test('changed approval, expired publication, blocked author or inactive root/child closes public access independently of private owner storage',async()=>{
   const id=ids[1];for(const statement of ["update app.listings set revision=2 where id=$1","update app.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1"]){await admin.query(statement,[id]);assert.equal(await store.read(id),undefined);await admin.query("update app.listings set revision=1,expires_at=clock_timestamp()+interval '1 day' where id=$1",[id]);}
   await admin.query('update app.users set is_blocked=true where id=$1',[owner]);try{assert.equal(await store.read(id),undefined);}finally{await admin.query('update app.users set is_blocked=false where id=$1',[owner]);}
   for(const category of [root,child.id]){await admin.query('update app.categories set active=false where id=$1',[category]);try{assert.equal(await store.read(id),undefined);}finally{await admin.query('update app.categories set active=true where id=$1',[category]);}}
   const late=new PostgresPublicListingStore({query:async(...args)=>{const result=await db.query(...args);for(const row of result.rows)row.expiresAt='2000-01-01T00:00:00.000001Z';return result;}});assert.equal(await late.read(id),undefined);
   const failed=new PostgresPublicListingStore({query:async()=>{throw Error('Synthetic SQL failure');}});await assert.rejects(failed.list({ownerId:owner}));
  });
  await suite.test('public photo metadata requires the exact current approved attachment and ready owner file, not merely a known media UUID',async()=>{
   const id=ids[0],media=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id",[owner,'b'.repeat(64)])).rows[0].id;
   assert.equal(await store.photoRecord(id,media),undefined);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[id,media]);assert.equal(await store.read(id),undefined);
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[media]);const item=await store.read(id);assert.deepEqual(item.images,[`/api/listings/${id}/photos/${media}`]);
   const access=await store.photoRecord(id,media);assert.equal(access.record.sha256,'b'.repeat(64));assert.equal(access.revision,'1');assert.equal(await store.photoRecord(ids[1],media),undefined);assert.equal(await store.photoRecord(id,randomUUID()),undefined);
   const second=(await admin.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,gen_random_uuid(),'image/webp',2,2,12,$2) returning id",[owner,'c'.repeat(64)])).rows[0].id;
   await admin.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[second]);await admin.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,1)',[id,second]);
   assert.deepEqual((await store.read(id)).images,[`/api/listings/${id}/photos/${media}`,`/api/listings/${id}/photos/${second}`]);
   assert.deepEqual((await store.list({ownerId:owner,kind:'prodam'}))[0].images,[`/api/listings/${id}/photos/${media}`]);
   const admission={reads:0},events=[],policy=formModule('production-public-work-photo-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./trusted-proxy-ip':proxy,'./production-media-http':{productionMediaAdmission:admission}});
   let reads=0,withdraw=false;const handler=policy.createProductionPublicWorkPhotoHandler({origin:'https://example.invalid'},()=>({store,files:{read:async record=>{assert.equal(record.id,media);reads++;if(withdraw)await admin.query("update app.listings set status='archived' where id=$1",[id]);return Buffer.alloc(12);}}}),event=>events.push(event));
   const request=()=>new Request(`https://example.invalid/api/listings/${id}/photos/${media}`,{headers:{host:'example.invalid','x-real-ip':'127.0.0.1'}});
   const delivered=await handler(request(),id,media);assert.equal(delivered.status,200);assert.equal(delivered.headers.get('cache-control'),'no-store');assert.equal((await delivered.arrayBuffer()).byteLength,12);
   assert.equal((await handler(request(),ids[1],media)).status,404);assert.equal(reads,1);
   withdraw=true;assert.equal((await handler(request(),id,media)).status,404);assert.equal(reads,2);assert.equal(admission.reads,0);assert.equal(JSON.stringify(events).includes(owner),false);
   await admin.query("update app.listings set status='archived' where id=$1",[id]);assert.equal(await store.photoRecord(id,media),undefined);
  });
 }finally{await admin.query('revoke select(created_at,view_count,is_paid,published_at,expires_at) on app.listings from blizhniy_runtime');await db.close();}
}
