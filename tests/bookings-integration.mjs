import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import pg from 'pg';
import {createPostgresDatabase} from '../src/lib/postgres.ts';import {hashSessionToken} from '../src/lib/identity.ts';
import {formModule} from './listing-form-module.mjs';import {workPublicationModule} from './work-publication-module.mjs';import * as contract from '../src/lib/booking-request-contract.ts';import * as calendar from '../src/lib/booking-availability.ts';
import {grantBookingPublicationRead} from '../scripts/grant-booking-read.mjs';
import * as http from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
const inbox=workPublicationModule('postgres-notification-inbox');
const deps={'./booking-request-contract.ts':contract,'./booking-availability.ts':calendar,'./postgres-notification-inbox':inbox,'./listing-public-eligibility':formModule('listing-public-eligibility')};
export async function testBookings(suite,admin,config,credentials){
 assert.equal(config.host,'127.0.0.1');const storage=formModule('postgres-bookings',deps),{PostgresBookingStore,PostgresBookingAvailabilityStore,readBookableListing}=storage;
 const db=createPostgresDatabase({NODE_ENV:'test',BLIZHNIY_DB_HOST:config.host,BLIZHNIY_DB_PORT:String(config.port),BLIZHNIY_DB_NAME:config.database,BLIZHNIY_DB_USER:credentials.user,BLIZHNIY_DB_PASSWORD:credentials.password,BLIZHNIY_DB_SSL_MODE:'disable'}),store=new PostgresBookingStore(db),users=[];
 try{
  for(let n=0;n<3;n++){const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,`booking-${id}@example.invalid`,`scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);}
  const [guest,host,other]=users,today=(await admin.query("select to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as day")).rows[0].day;
  const day=n=>calendar.addBookingDays(today,n),refs=(await admin.query("select (select id from app.cities where name='Краснодар') as city,(select id from app.categories where parent_id is null and active order by id limit 1) as category")).rows[0];
  const stay={mode:'stay',priceWeekday:100.01,priceWeekend:100.01,minNights:1,includedGuests:2,maxGuests:4,extraGuestPrice:10.03},tour={mode:'tour',pricePerPerson:100.01,maxGuests:3,tourDate:day(5)};
  async function listing(booking=stay){
   const row=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,booking,status,is_paid,published_at,expires_at) values($1,'rent',$2,$3,'Синтетическое размещение','Синтетическое описание для проверки бронирований.','+79990000000',$4::jsonb,'published',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day') returning id",[host.id,refs.category,refs.city,JSON.stringify(booking)])).rows[0];
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[row.id]);return row.id;
  }
  const input=(id,booking=stay,patch={})=>({listingId:id,creationKey:randomUUID(),expectedListingRevision:'1',mode:booking.mode,startDate:booking.mode==='tour'?booking.tourDate:day(1),endDate:booking.mode==='tour'?null:day(3),guests:3,...patch});
  let saved,stayId;
  await suite.test('booking public eligibility fails closed without explicit publication-state SELECT; isolated fixture read grants never confer payment or publication authority',async()=>{
   await assert.rejects(db.query('select is_paid,published_at,expires_at from app.listings limit 0'),{code:'42501'});
   assert.deepEqual(await grantBookingPublicationRead(admin,`${config.host}:${config.database}`),{columns:3});assert.deepEqual(await grantBookingPublicationRead(admin,`${config.host}:${config.database}`),{columns:3});
   assert.equal((await db.query('select is_paid,published_at,expires_at from app.listings limit 0')).rowCount,0);
   for(const sql of ['update app.listings set is_paid=true where false','update app.listings set published_at=clock_timestamp() where false','update app.listings set expires_at=clock_timestamp() where false'])await assert.rejects(db.query(sql),{code:'42501'});
  });
  await suite.test('booking read operator refuses changed history and residual finance or table-wide privileges, never retries unknown COMMIT',async()=>{
   const target=`${config.host}:${config.database}`,prior=(await admin.query("select sha256 from blizhniy_meta.migrations where name='0018-interactions.sql'")).rows[0].sha256;
   await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0018-interactions.sql'",['0'.repeat(64)]);
   try{await assert.rejects(grantBookingPublicationRead(admin,target));}finally{await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0018-interactions.sql'",[prior]);}
   for(const permission of ['select','update(is_paid)','select(is_paid) with grant option']){
    const reads=(await admin.query("select attname from pg_attribute where attrelid='app.listings'::regclass and attnum>0 and not attisdropped and has_column_privilege('blizhniy_runtime',attrelid,attnum,'SELECT') order by attnum")).rows.map(row=>row.attname);
    assert.ok(reads.every(name=>/^[a-z_]+$/.test(name)));
    await admin.query(`grant ${permission.replace(' with grant option','')} on app.listings to blizhniy_runtime${permission.endsWith(' with grant option')?' with grant option':''}`);
    try{await assert.rejects(grantBookingPublicationRead(admin,target));}finally{
     await admin.query(`revoke ${permission.endsWith(' with grant option')?'grant option for select(is_paid)':permission} on app.listings from blizhniy_runtime`);
     // PostgreSQL table-level REVOKE also removes earlier column SELECT grants: restore the exact owned fixture ACL.
     await admin.query(`grant select(${reads.join(',')}) on app.listings to blizhniy_runtime`);
    }
    assert.deepEqual((await admin.query("select attname from pg_attribute where attrelid='app.listings'::regclass and attnum>0 and not attisdropped and has_column_privilege('blizhniy_runtime',attrelid,attnum,'SELECT') order by attnum")).rows.map(row=>row.attname),reads);
   }
   let commits=0;const uncertain={connectionParameters:admin.connectionParameters,query:async(sql,values)=>{const result=await admin.query(sql,values);if(sql==='commit'){commits++;throw Error('Synthetic lost booking privilege COMMIT');}return result;}};
   await assert.rejects(grantBookingPublicationRead(uncertain,target));assert.equal(commits,1);
  });
  await suite.test('booking create freezes server-quoted terms, replays one stable intent and atomically notifies only the real host',async()=>{
   stayId=await listing();const data=input(stayId);saved=await store.create(guest.token,guest.id,data);
   assert.equal(saved.total,'220.08');assert.equal(saved.status,'pending');assert.equal(saved.revision,'1');assert.equal(saved.view,'guest');assert.equal(saved.booking.priceWeekday,100.01);
   assert.deepEqual(await store.create(guest.token,guest.id,data),saved);assert.deepEqual(await store.readIntent(guest.token,guest.id,data.creationKey),saved);
   await assert.rejects(store.create(guest.token,guest.id,{...data,guests:2}),{name:'BookingConflictError'});
   const events=(await admin.query('select user_id,booking_request_id,event_key from app.notifications where booking_request_id=$1',[saved.id])).rows;
   assert.equal(events.length,1);assert.equal(events[0].user_id,host.id);assert.equal(events[0].booking_request_id,saved.id);
   assert.equal((await store.preview(guest.token,guest.id,input(stayId,{...stay}, {startDate:day(3),endDate:day(4)}))).quote.total,'110.04');
  });
  await suite.test('only the guest or actual host can read a booking; participant substitution, self-booking and financial fields are denied',async()=>{
   assert.equal((await store.read(host.token,host.id,saved.id)).view,'host');await assert.rejects(store.read(other.token,other.id,saved.id),{name:'BookingAccessError'});
   await assert.rejects(store.read(other.token,guest.id,saved.id),{name:'AppSessionAccessError'});await assert.rejects(store.create(host.token,host.id,input(stayId)),{name:'BookingAccessError'});
   await assert.rejects(store.decide(guest.token,guest.id,saved.id,'1','accepted'),{name:'BookingAccessError'});
   await assert.rejects(async()=>store.create(guest.token,guest.id,{...input(stayId),total:'0.01'}),{name:'BookingRequestInputError'});
   assert.deepEqual((await store.list(other.token,other.id,'guest',null)).items,[]);
  });
  await suite.test('pending stays block overlap but permit checkout-day adjacency; concurrent guests have exactly one winner',async()=>{
   await assert.rejects(store.create(other.token,other.id,input(stayId)),{name:'BookingAvailabilityError'});
   const id=await listing(),results=await Promise.allSettled([store.create(guest.token,guest.id,input(id)),store.create(other.token,other.id,input(id))]);
   assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.name==='BookingAvailabilityError').length,1);
   const next=await store.create(other.token,other.id,input(stayId,stay,{startDate:day(3),endDate:day(4)}));assert.equal(next.status,'pending');
  });
  await suite.test('only approved live paid eligible listings can be booked, with exact revisions and current nonblocked hosts',async()=>{
   const id=await listing();assert.ok(await readBookableListing(db,id));
   for(const update of ["status='archived'","is_paid=false,status='paid'","expires_at=clock_timestamp()-interval '1 second'"]){
    await admin.query(`update app.listings set ${update} where id=$1`,[id]);assert.equal(await readBookableListing(db,id),null);
    await admin.query("update app.listings set status='published',is_paid=true,expires_at=clock_timestamp()+interval '1 day' where id=$1",[id]);}
   await admin.query('update app.listings set revision=2 where id=$1',[id]);assert.equal(await readBookableListing(db,id),null);
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,2,'approved',clock_timestamp())",[id]);
   await assert.rejects(store.create(guest.token,guest.id,input(id)),{name:'BookingConflictError'});
   await admin.query('update app.users set is_blocked=true where id=$1',[host.id]);try{assert.equal(await readBookableListing(db,id),null);}finally{await admin.query('update app.users set is_blocked=false where id=$1',[host.id]);}
   await admin.query('update app.categories set active=false where id=$1',[refs.category]);try{assert.equal(await readBookableListing(db,id),null);}finally{await admin.query('update app.categories set active=true where id=$1',[refs.category]);}
   await admin.query("update app.listings set contact_phone=null,messenger_url=null where id=$1",[id]);assert.equal(await readBookableListing(db,id),null);
  });
  await suite.test('host decisions use exact bigint CAS, are terminal/replayable, preserve the quote and release declined stay dates',async()=>{
   await admin.query('update app.booking_requests set revision=9007199254740993 where id=$1',[saved.id]);const revision='9007199254740993';
   const results=await Promise.allSettled(['accepted','declined'].map(state=>store.decide(host.token,host.id,saved.id,revision,state)));assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
   assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.name==='BookingConflictError').length,1);const result=results.find(row=>row.status==='fulfilled').value;
   assert.equal(result.revision,'9007199254740994');assert.equal(result.total,saved.total);assert.deepEqual(await store.decide(host.token,host.id,saved.id,revision,result.status),result);
   assert.equal((await admin.query("select count(*)::int as n from app.notifications where user_id=$1 and booking_request_id=$2",[guest.id,saved.id])).rows[0].n,1);
   const id=await listing(),declined=await store.create(guest.token,guest.id,input(id));await store.decide(host.token,host.id,declined.id,'1','declined');assert.equal((await store.create(other.token,other.id,input(id))).status,'pending');
  });
  await suite.test('tour pending requests do not occupy seats; accepting competing requests cannot oversell capacity',async()=>{
   const id=await listing(tour),a=await store.create(guest.token,guest.id,input(id,tour,{guests:2})),b=await store.create(other.token,other.id,input(id,tour,{guests:2}));
   const results=await Promise.allSettled([store.decide(host.token,host.id,a.id,'1','accepted'),store.decide(host.token,host.id,b.id,'1','accepted')]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
   assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.name==='BookingAvailabilityError').length,1);
   await assert.rejects(store.create(guest.token,guest.id,input(id,tour,{guests:2})),{name:'BookingAvailabilityError'});
  });
  await suite.test('a changed listing price never rewrites the immutable quoted amount, and hosts may decline an expired listing request',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await admin.query("update app.listings set booking=$2::jsonb,revision=2 where id=$1",[id,JSON.stringify({...stay,priceWeekday:200,priceWeekend:300})]);
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,2,'approved',clock_timestamp())",[id]);
   const accepted=await store.decide(host.token,host.id,request.id,'1','accepted');assert.equal(accepted.total,request.total);assert.deepEqual(accepted.booking,request.booking);
   const fresh=await listing(),pending=await store.create(guest.token,guest.id,input(fresh));await admin.query("update app.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1",[fresh]);
   await assert.rejects(store.decide(host.token,host.id,pending.id,'1','accepted'),{name:'BookingAccessError'});assert.equal((await store.decide(host.token,host.id,pending.id,'1','declined')).status,'declined');
  });
  await suite.test('public booking inventory exposes bounded anonymous occupied dates and accepted tour capacity only, never private requests',async()=>{
   const publicStore=new PostgresBookingAvailabilityStore(db),id=await listing();
   assert.deepEqual((await publicStore.read(id)).occupiedDates,[]);
   const pending=await store.create(guest.token,guest.id,input(id));let result=await publicStore.read(id);
   assert.deepEqual(Object.keys(result).sort(),['booking','listing','occupiedDates','today','tourSeatsRemaining']);
   assert.deepEqual(result.occupiedDates,[day(1),day(2)]);assert.equal(result.tourSeatsRemaining,null);
   assert.deepEqual(Object.keys(result.listing).sort(),['id','revision','title']);
   for(const privateValue of [pending.id,guest.id,host.id,'+79990000000'])assert.equal(JSON.stringify(result).includes(privateValue),false);
   await store.decide(host.token,host.id,pending.id,'1','declined');assert.deepEqual((await publicStore.read(id)).occupiedDates,[]);
   const tourId=await listing(tour),request=await store.create(guest.token,guest.id,input(tourId,tour,{guests:2}));
   assert.equal((await publicStore.read(tourId)).tourSeatsRemaining,3);
   await store.decide(host.token,host.id,request.id,'1','accepted');result=await publicStore.read(tourId);
   assert.equal(result.tourSeatsRemaining,1);assert.deepEqual(result.occupiedDates,[]);
   await admin.query("update app.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1",[tourId]);assert.equal(await publicStore.read(tourId),null);
  });
  await suite.test('public inventory rechecks publication eligibility after its query and refuses expiry or a changed revision instead of reporting stale availability',async()=>{
   const id=await listing();let changed=false;
   const racing={query:async(sql,values)=>{const result=await db.query(sql,values);if(sql.includes('generate_series')&&!changed){changed=true;await admin.query("update app.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);}return result;}};
   assert.equal(await new PostgresBookingAvailabilityStore(racing).read(id),null);assert.equal(changed,true);
  });
  await suite.test('busy peer locks refuse writes without cross-user deadlock or partial changes',async()=>{
   const id=await listing(),locker=new pg.Client(config);await locker.connect();try{
    await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[host.id]);
    await assert.rejects(store.create(guest.token,guest.id,input(id)),{name:'BookingBusyError'});await locker.query('rollback');
    const pending=await store.create(guest.token,guest.id,input(id));await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[guest.id]);
    await assert.rejects(store.decide(host.token,host.id,pending.id,'1','accepted'),{name:'BookingBusyError'});await locker.query('rollback');
    assert.equal((await store.read(guest.token,guest.id,pending.id)).status,'pending');
   }finally{await locker.query('rollback');await locker.end();}
  });
  await suite.test('cookie booking HTTP composes real restricted SQL, owner binding, create readback and private host CAS without finance writes',async()=>{
   const {createProductionBookingHandler}=formModule('production-booking-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./booking-request-contract.ts':contract,'./postgres-bookings':storage});
   const events=[],origin='https://owned-bookings.example.invalid',handler=createProductionBookingHandler({origin},()=>({store,limiter:{allowProduction:async()=>true}}),event=>events.push(event));
   const request=(user,body,method='POST')=>new Request(origin+'/api/account/bookings',{method,headers:{host:'owned-bookings.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+user.token},body:JSON.stringify({expectedOwnerId:user.id,...body})});
   const data=input(await listing()),preview=await handler(request(guest,{action:'preview',input:data}));assert.equal(preview.status,200);assert.equal((await preview.json()).quote.total,'220.08');
   const response=await handler(request(guest,{action:'create',input:data},'PUT'));assert.equal(response.status,200);const result=await response.json();
   const recovered=await handler(request(guest,{action:'intent',creationKey:data.creationKey}));assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),result);
   assert.equal((await handler(request(other,{action:'read',bookingId:result.id}))).status,404);
   assert.equal((await handler(request(other,{action:'read',bookingId:result.id,expectedOwnerId:guest.id}))).status,401);
   const decision=await handler(request(host,{action:'decide',bookingId:result.id,expectedRevision:'1',state:'accepted'},'PUT'));assert.equal(decision.status,200);assert.equal((await decision.json()).status,'accepted');
   for(const secret of [guest.token,guest.id,host.id,result.id,data.startDate])assert.equal(JSON.stringify(events).includes(secret),false);
  });
  await suite.test('unknown COMMIT is recovered by the original intent without another insert or duplicate host event, even after listing expiry',async()=>{
   const id=await listing(),data=input(id);let commits=0;const uncertain=new PostgresBookingStore({transaction:async work=>{await db.transaction(work);commits++;throw Error('Synthetic lost booking COMMIT');}});
   await assert.rejects(uncertain.create(guest.token,guest.id,data));assert.equal(commits,1);const recovered=await store.readIntent(guest.token,guest.id,data.creationKey);assert.equal(recovered.status,'pending');
   await admin.query("update app.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]);assert.deepEqual(await store.create(guest.token,guest.id,data),recovered);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where booking_request_id=$1',[recovered.id])).rows[0].n,1);
  });
  await suite.test('listing expiry after INSERT rolls back both the new booking and its host notification',async()=>{
   const id=await listing(),data=input(id);await admin.query("update app.listings set expires_at=clock_timestamp()+interval '1 second' where id=$1",[id]);let inserted=false;
   const slow=new PostgresBookingStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{const result=await tx.query(sql,values);if(sql.startsWith('insert into app.booking_requests')){inserted=true;await tx.query('select pg_sleep(1.2)');}return result;}}))});
   await assert.rejects(slow.create(guest.token,guest.id,data),{name:'BookingAccessError'});assert.equal(inserted,true);assert.equal(await store.readIntent(guest.token,guest.id,data.creationKey),null);
   assert.equal((await admin.query('select count(*)::int as n from app.notifications n join app.booking_requests b on b.id=n.booking_request_id where b.listing_id=$1',[id])).rows[0].n,0);
  });
  await suite.test('notification failure and final session expiry roll back host decisions and their guest events atomically',async()=>{
   const id=await listing(),pending=await store.create(guest.token,guest.id,input(id));
   const faulty=new PostgresBookingStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{if(sql.startsWith('insert into app.notifications'))throw Error('Synthetic booking notification failure');return tx.query(sql,values);}}))});
   await assert.rejects(faulty.decide(host.token,host.id,pending.id,'1','accepted'));assert.deepEqual(await store.read(guest.token,guest.id,pending.id),pending);
   const slow=new PostgresBookingStore({transaction:work=>db.transaction(tx=>work({query:async(sql,values)=>{const result=await tx.query(sql,values);if(sql.startsWith('insert into app.notifications'))await tx.query('select pg_sleep(0.4)');return result;}}))});
   await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '300 milliseconds' where token_hash=$1",[hashSessionToken(host.token)]);
   try{await assert.rejects(slow.decide(host.token,host.id,pending.id,'1','declined'),{name:'AppSessionAccessError'});}
   finally{await admin.query("update app.sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=$1",[hashSessionToken(host.token)]);}
   assert.deepEqual(await store.read(guest.token,guest.id,pending.id),pending);assert.equal((await admin.query('select count(*)::int as n from app.notifications where booking_request_id=$1',[pending.id])).rows[0].n,1);
  });
  await suite.test('booking pages retain microsecond keyset order, stay private and expose no participant IDs or snapshot in bulk',async()=>{
   const id=await listing(tour);for(let n=0;n<25;n++)await admin.query("insert into app.booking_requests(listing_id,guest_id,creation_key,mode,start_date,guests,total,details_snapshot,created_at) values($1,$2,gen_random_uuid(),'tour',$3,1,'100.01',$4::jsonb,'2026-01-01T00:00:00.123456Z')",[id,guest.id,tour.tourDate,JSON.stringify({listingRevision:'1',title:'Синтетический поход',booking:tour})]);
   const collected=[];let cursor=null;do{const page=await store.list(guest.token,guest.id,'guest',cursor);assert.ok(page.items.length<=20);collected.push(...page.items);cursor=page.nextCursor;}while(cursor);
   assert.equal(new Set(collected.map(item=>item.id)).size,collected.length);for(const item of collected)for(const key of ['guest','host','terms','booking','creationKey'])assert.equal(Object.hasOwn(item,key),false);
   const own=(await store.list(host.token,host.id,'host',null)).items;assert.ok(own.length>0);assert.ok(own.every(item=>item.view==='host'));
   await admin.query('update app.users set is_blocked=true where id=$1',[guest.id]);await assert.rejects(store.list(guest.token,guest.id,'guest',null),{name:'AppSessionAccessError'});
  });
 }finally{for(const user of users)await admin.query('delete from app.users where id=$1',[user.id]);await admin.query('revoke select(is_paid,published_at,expires_at) on app.listings from blizhniy_runtime');await db.close();}
}
