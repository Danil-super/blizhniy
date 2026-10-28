// Owned loopback stand only. Adds0026 locally, exercises fresh synthetic rows, then erases those fixtures.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {stateFile,localPrimaryDatabaseConfig,docker,getLocalPrimaryExtraMigrations} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getBootstrapPlan} from './postgres-migration-plan.mjs';
import {blockModule} from '../tests/listing-block-module.mjs';
import {formModule} from '../tests/listing-form-module.mjs';
import {bookingDetails} from '../tests/listing-publication-check-module.mjs';
import * as bookingContract from '../src/lib/booking-request-contract.ts';
import * as bookingCalendar from '../src/lib/booking-availability.ts';
import * as overviewContract from '../src/lib/admin-overview-contract.ts';
import {loadAdminModule} from '../tests/admin-module.mjs';
const {PostgresListingManagementStore}=blockModule('postgres-listing-management');
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner')),db=new PostgresDatabase(new pg.Pool(localPrimaryDatabaseConfig(state)));
await owner.connect();const ids=[],tokens=[];let checks=0;
async function check(name,work){await work();checks++;console.log(JSON.stringify({check:name,status:'passed'}));}
try{
 const source=await readFile(new URL('../database/migrations/0026-listing-blocks.sql',import.meta.url),'utf8'),name='0026-listing-blocks.sql',sha256=createHash('sha256').update(source).digest('hex');
 const prior=getBootstrapPlan({includeListingContactMethod:true}).map(({name,sha256})=>({name,sha256})),journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
 if(journal.length===25){assert.deepEqual(journal,prior);await owner.query('begin');try{await owner.query(source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);await owner.query('commit');}catch(error){await owner.query('rollback');throw error;}}
 else{const extras=await getLocalPrimaryExtraMigrations();assert.ok(journal.length>=26&&journal.length<=25+extras.length);assert.deepEqual(journal,[...prior,...extras.slice(0,journal.length-25).map(({name,sha256})=>({name,sha256}))]);}
 await owner.query('grant select,insert on app.listing_blocks,app.listing_block_mail to blizhniy_runtime;grant insert on app.notifications to blizhniy_runtime');
 const store=new PostgresListingManagementStore(db);
 for(const role of ['admin','user','admin']){
  const user=(await owner.query(`insert into app.users(email,password_hash,role,email_verified_at) values($1,$2,$3,clock_timestamp()) returning id`,[`block-check-${randomUUID()}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,role])).rows[0].id;ids.push(user);
  const token=randomBytes(32).toString('hex');tokens.push(token);
  await owner.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at,last_seen_at) values($1,$2,0,'app',clock_timestamp()+interval '15 minutes',clock_timestamp())`,[hashSessionToken(token),user]);
 }
 const listings=[];
 for(const user of ids){listings.push((await owner.query(`insert into app.listings(author_id,listing_type,title,description) values($1,'sell','Проверка блокировки','Синтетические данные, не предложение.') returning id`,[user])).rows[0].id);}
 await check('all statuses and own listings visible to authorized admin',async()=>{
  const page=await store.list(tokens[0],ids[0],null);assert.ok(page.items.some(item=>item.id===listings[0]));assert.ok(page.items.some(item=>item.id===listings[1]));
  assert.equal((await store.inspect(tokens[0],ids[0],listings[1])).listing.blocked,false);
 });
 await check('overview excludes obsolete listing approval queue only in postmoderation',async()=>{
  await owner.query('insert into app.listing_moderation(listing_id,revision) values($1,1)',[listings[1]]);
  const {PostgresAdminOverviewStore}=formModule('postgres-admin-overview',{'./admin-authorization':loadAdminModule('admin-authorization'),'./admin-overview-contract.ts':overviewContract});
  const before=await new PostgresAdminOverviewStore(db).read(tokens[0],ids[0]);
  const after=await new PostgresAdminOverviewStore(db,{postmoderation:true}).read(tokens[0],ids[0]);
  assert.equal(after.publications.awaitingReview,before.publications.awaitingReview-1);assert.equal(after.publications.total,before.publications.total);
 });
 await check('ordinary user, forged actor, missing listing and stale revision denied',async()=>{
  await assert.rejects(store.block(tokens[1],ids[1],listings[1],'1','Причина'),{name:'AdminAccessError'});
  await assert.rejects(store.block(tokens[0],ids[2],listings[1],'1','Причина'),{name:'AdminAccessError'});
  await assert.rejects(store.block(tokens[0],ids[0],randomUUID(),'1','Причина'),{name:'ListingManagementNotFoundError'});
  await assert.rejects(store.block(tokens[0],ids[0],listings[1],'2','Причина'),{name:'ListingManagementConflictError'});
 });
 await check('blocking is immutable audited, atomic with inbox and captured mail, no financial writes',async()=>{
  const before=(await owner.query('select * from app.listings where id=$1',[listings[1]])).rows;
  const result=await store.block(tokens[0],ids[0],listings[1],'1','Запрещённый товар');assert.equal(result.blocked,true);assert.equal(result.blockReason,'Запрещённый товар');
  assert.deepEqual((await owner.query('select * from app.listings where id=$1',[listings[1]])).rows,before);
  assert.deepEqual((await owner.query('select blocked_by,blocked_revision,reason from app.listing_blocks where listing_id=$1',[listings[1]])).rows[0],{blocked_by:ids[0],blocked_revision:'1',reason:'Запрещённый товар'});
  assert.equal((await owner.query('select count(*)::int as n from app.notifications where user_id=$1',[ids[1]])).rows[0].n,1);
  assert.equal((await owner.query('select count(*)::int as n from app.listing_block_mail where user_id=$1',[ids[1]])).rows[0].n,1);
  assert.deepEqual(await store.block(tokens[0],ids[0],listings[1],'1','Запрещённый товар'),result);
  await assert.rejects(store.block(tokens[2],ids[2],listings[1],'1','Другое решение'),{name:'ListingManagementConflictError'});
  await assert.rejects(db.query('delete from app.listing_blocks where false'),{code:'42501'});await assert.rejects(db.query("update app.listing_blocks set reason='changed' where false"),{code:'42501'});
 });
 await check('owner content changes cannot unblock, self block is audited',async()=>{
  await owner.query("update app.listings set title='Исправлено',revision=revision+1 where id=$1",[listings[1]]);
  assert.equal((await store.inspect(tokens[0],ids[0],listings[1])).listing.blocked,true);
  assert.equal((await store.block(tokens[0],ids[0],listings[0],'1','Собственная проверка')).blocked,true);
 });
 await check('concurrent conflicting decisions have one winner and one notification',async()=>{
  const fresh=(await owner.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Конкурентная проверка') returning id",[ids[1]])).rows[0].id;
  const results=await Promise.allSettled([store.block(tokens[0],ids[0],fresh,'1','Первая причина'),store.block(tokens[2],ids[2],fresh,'1','Вторая причина')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.name==='ListingManagementConflictError').length,1);
  assert.equal((await owner.query('select count(*)::int as n from app.notifications where event_key=$1',[`listing-block:${fresh}`])).rows[0].n,1);
 });
 await check('notification delivery failure rolls back the block and all notices',async()=>{
  const fresh=(await owner.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Проверка отката') returning id",[ids[1]])).rows[0].id;
  const failing=new PostgresListingManagementStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{if(sql.startsWith('insert into app.listing_block_mail'))throw Error('Synthetic capture failure');return tx.query(sql,values);}}))});
  await assert.rejects(failing.block(tokens[0],ids[0],fresh,'1','Причина'),/Synthetic capture failure/);
  assert.equal((await owner.query('select count(*)::int as n from app.listing_blocks where listing_id=$1',[fresh])).rows[0].n,0);
  assert.equal((await owner.query('select count(*)::int as n from app.notifications where event_key=$1',[`listing-block:${fresh}`])).rows[0].n,0);
 });
 await check('lost block response resolves by readback without repeating the decision',async()=>{
  const fresh=(await owner.query("insert into app.listings(author_id,listing_type,title) values($1,'sell','Проверка потери ответа') returning id",[ids[1]])).rows[0].id;
  let attempts=0;const uncertain=new PostgresListingManagementStore({transaction:async work=>{attempts++;await db.transaction(work);throw Error('Synthetic lost commit reply');}});
  await assert.rejects(uncertain.block(tokens[0],ids[0],fresh,'1','Причина'),/Synthetic lost commit reply/);assert.equal(attempts,1);
  assert.equal((await store.inspect(tokens[0],ids[0],fresh)).listing.blocked,true);
  assert.equal((await owner.query('select count(*)::int as n from app.notifications where event_key=$1',[`listing-block:${fresh}`])).rows[0].n,1);
 });
 await check('revoked administrator cannot block',async()=>{
  await owner.query("update app.users set role='user' where id=$1",[ids[2]]);await assert.rejects(store.block(tokens[2],ids[2],listings[2],'1','Причина'),{name:'AdminAccessError'});
 });
 await check('published unreviewed listing is visible until block; detail, seller/category lists, photos and bookings then fail closed',async()=>{
  // Entire image metadata/budget fixture is rolled back, never bypasses immutable-media cleanup.
  await owner.query('begin');
  try{
   const tx={query:(sql,values)=>owner.query(sql,values)},eligibility=formModule('listing-public-eligibility');
   const projection=formModule('public-listings',{'./booking-details':bookingDetails});
   const {PostgresPublicListingStore}=formModule('postgres-public-listings',{'./public-listings':projection,'./listing-public-eligibility':eligibility});
   const inbox=formModule('postgres-notification-inbox');
   const {PostgresBookingAvailabilityStore,PostgresBookingStore}=formModule('postgres-bookings',{'./booking-request-contract.ts':bookingContract,'./booking-availability.ts':bookingCalendar,'./postgres-notification-inbox':inbox,'./listing-public-eligibility':eligibility});
   const refs=(await owner.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.categories where parent_id is null and active order by id limit 1) as category")).rows[0];
   const booking={mode:'stay',priceWeekday:100,priceWeekend:150,minNights:1,includedGuests:2,maxGuests:4};
   const listing=(await owner.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,booking,status,is_paid,published_at,expires_at) values($1,'rent',$2,$3,'Синтетическая публикация','Синтетическое подробное описание для проверки.','+79990000000',$4::jsonb,'published',true,clock_timestamp(),clock_timestamp()+interval '1 day') returning id",[ids[1],refs.category,refs.city,JSON.stringify(booking)])).rows[0].id;
   const image=(await owner.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,'image/webp',2,2,12,$3) returning id",[ids[1],randomUUID(),'b'.repeat(64)])).rows[0].id;
   await owner.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1",[image]);await owner.query('insert into app.listing_photos(listing_id,media_id,position) values($1,$2,0)',[listing,image]);
   const publicStore=new PostgresPublicListingStore(tx,{postmoderation:true}),inventory=new PostgresBookingAvailabilityStore(tx,{postmoderation:true});
   assert.equal((await publicStore.read(listing)).id,listing);assert.ok((await publicStore.list({ownerId:ids[1]})).some(item=>item.id===listing));assert.equal((await publicStore.photoRecord(listing,image)).record.id,image);assert.ok(await inventory.read(listing));
   assert.equal(await new PostgresPublicListingStore(tx).read(listing),undefined);
   const blockStore=new PostgresListingManagementStore({transaction:work=>work(tx)});await blockStore.block(tokens[0],ids[0],listing,'1','Нарушение правил');
   assert.equal(await publicStore.read(listing),undefined);assert.equal((await publicStore.list({ownerId:ids[1]})).some(item=>item.id===listing),false);assert.equal(await publicStore.photoRecord(listing,image),undefined);assert.equal(await inventory.read(listing),null);
   const today=(await owner.query("select to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as day")).rows[0].day;
   await assert.rejects(new PostgresBookingStore({transaction:work=>work(tx)},{postmoderation:true}).create(tokens[0],ids[0],{listingId:listing,creationKey:randomUUID(),expectedListingRevision:'1',mode:'stay',startDate:bookingCalendar.addBookingDays(today,1),endDate:bookingCalendar.addBookingDays(today,2),guests:2}),{name:'BookingAccessError'});
  }finally{await owner.query('rollback');}
 });
 console.log(JSON.stringify({status:'passed',checks,schema:26,delivery:'captured-only',productionTouched:false}));
}finally{
 try{if(ids.length)await owner.query('delete from app.users where id=any($1::uuid[])',[ids]);}finally{await db.close();await owner.end();}
}
