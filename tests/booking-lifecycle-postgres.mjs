// Opt-in disposable PG18 only. No dotenv, persistent stand, provider or production.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const run=promisify(execFile),image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const name='blizhniy-booking-lifecycle-'+randomBytes(8).toString('hex'),label='blizhniy.booking-lifecycle',password=randomBytes(24).toString('hex');
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();
test('booking lifecycle: real restricted PostgreSQL expiry, cancellation, audit and inventory',{timeout:120000},async suite=>{
 const migration=await readFile(new URL('../database/migrations/0041-booking-lifecycle.sql',import.meta.url),'utf8');
 const {PostgresDatabase}=load('postgres'),{hashSessionToken}=load('identity');
 const {PostgresBookingStore,PostgresBookingAvailabilityStore}=load('postgres-bookings');
  const {PostgresBookingExpiryStore}=load('postgres-booking-expiry');
 let container,admin,db;
 try{
  container=await docker(['run','--detach','--pull','never','--name',name,'--label',label+'='+name,'--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql:rw,size=268435456','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
  const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Image,image);assert.equal(metadata.Config.Labels[label],name);
  const binding=metadata.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
  const end=Date.now()+20000;for(;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{assert.ok(Date.now()<end);}await new Promise(r=>setTimeout(r,100));}
  const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:3000};
  admin=new pg.Pool({...config,max:5});assert.match((await admin.query('show server_version')).rows[0].server_version,/^18\.6/);
  const names=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^00(?:[0-3][0-9]|40)-[a-z-]+\.sql$/.test(n)).sort();assert.equal(names.length,40);
  for(const n of names)await admin.query(await readFile(new URL('../database/migrations/'+n,import.meta.url),'utf8'));
  await admin.query("insert into app.regions(slug,name) values('krasnodarskiy-kray','Краснодарский край');insert into app.cities(region_id,slug,name) select id,'krasnodar','Краснодар' from app.regions;insert into app.categories(slug,name) values('otdyh','Хобби и отдых')");
  await admin.query(migration);
  await admin.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
   revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to blizhniy_runtime;grant usage on schema app to blizhniy_runtime;
   grant select on app.users,app.sessions,app.listings,app.categories,app.cities,app.listing_moderation,app.listing_photos,app.media_objects,app.booking_requests,app.notifications to blizhniy_runtime;
   grant update(last_seen_at) on app.sessions to blizhniy_runtime;grant update(id) on app.users,app.listings to blizhniy_runtime;
   grant insert(listing_id,guest_id,creation_key,mode,start_date,end_date,guests,total,details_snapshot),update(status,revision,decided_at,updated_at) on app.booking_requests to blizhniy_runtime;
   grant insert(user_id,event_key,category,tone,title,body,action_href,booking_request_id) on app.notifications to blizhniy_runtime`);
  await admin.query(await readFile(new URL('../database/permissions/booking-lifecycle.sql',import.meta.url),'utf8'));
  db=new PostgresDatabase(new pg.Pool({...config,user:'blizhniy_runtime',password,max:5}));
  const store=new PostgresBookingStore(db,{lifecycle:true}),inventory=new PostgresBookingAvailabilityStore(db,{lifecycle:true});
  const users=[];for(let n=0;n<6;n++){
   const id=randomUUID(),token=randomBytes(32).toString('hex');users.push({id,token});
   await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',[id,id+'@booking.invalid','scrypt$131072$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128)]);
   await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')",[hashSessionToken(token),id]);
  }
  const [host,guest,other,third,fourth,fifth]=users;
  const today=(await admin.query("select to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as day")).rows[0].day;
  const {addBookingDays}=load('booking-availability'),day=n=>addBookingDays(today,n);
  const booking={mode:'stay',priceWeekday:100,priceWeekend:100,minNights:1,includedGuests:2,maxGuests:4,checkInTime:'14:00'};
  async function listing(terms=booking){
   const row=(await admin.query("insert into app.listings(author_id,listing_type,category_id,city_id,title,description,contact_phone,booking,status,is_paid,published_at,expires_at) select $1,'rent',c.id,city.id,'Синтетическое жильё','Полное описание синтетического жилья для проверки бронирования.','+79990000000',$2::jsonb,'published',true,clock_timestamp(),clock_timestamp()+interval '30 days' from app.categories c cross join app.cities city where c.slug='otdyh' and city.name='Краснодар' returning id",[host.id,JSON.stringify(terms)])).rows[0];
   await admin.query("insert into app.listing_moderation(listing_id,revision,state,decided_at) values($1,1,'approved',clock_timestamp())",[row.id]);return row.id;
  }
  const input=(id,patch={})=>({listingId:id,creationKey:randomUUID(),expectedListingRevision:'1',mode:'stay',startDate:day(2),endDate:day(3),guests:2,...patch});
  const events=async id=>(await admin.query('select status,actor_id,reason,revision from app.booking_events where booking_id=$1 order by revision',[id])).rows;
  const inject=async(id,assignment,values=[])=>{await admin.query('alter table app.booking_requests disable trigger user');try{await admin.query('update app.booking_requests set '+assignment+' where id=$1',[id,...values]);}finally{await admin.query('alter table app.booking_requests enable trigger user;alter table app.booking_requests enable always trigger booking_lifecycle_guard;alter table app.booking_requests enable always trigger booking_lifecycle_event');}};
  await suite.test('stored preferences apply at delivery for booking requests and database-generated cancellations',async()=>{
   const {PostgresNotificationInbox}=load('postgres-notification-inbox');
   const inbox=new PostgresNotificationInbox(db);
   const visible=async(user)=>(await inbox.list(user.token,user.id,null)).items;
   const id=await listing();
   const previous=await store.create(guest.token,guest.id,input(id));
   await store.cancel(guest.token,guest.id,previous.id,'1','Изменились планы.');
   const before=await visible(host);
   assert.equal(before.filter(item=>item.bookingRequestId===previous.id).length,2);
   await admin.query(await readFile(new URL('../database/candidates/0064-inbox-notification-preferences.sql',import.meta.url),'utf8'));
   await admin.query("insert into app.cabinet_profiles(user_id,profile) values($1,$2)",[host.id,{notifyBookings:false}]);
   const data=input(id),muted=await store.create(guest.token,guest.id,data);
   assert.equal((await store.create(guest.token,guest.id,data)).id,muted.id);
   await store.decide(host.token,host.id,muted.id,'1','accepted');
   await store.cancel(guest.token,guest.id,muted.id,'2','Поездка отменилась.');
   assert.deepEqual(await visible(host),before);
   assert.equal((await visible(guest)).filter(item=>item.bookingRequestId===muted.id).length,1);
   await admin.query("update app.cabinet_profiles set profile=$2 where user_id=$1",[host.id,{notifyBookings:true}]);
   await store.cancel(guest.token,guest.id,muted.id,'2','Поездка отменилась.');
   assert.deepEqual(await visible(host),before);
   const next=await store.create(guest.token,guest.id,input(id));
   assert.equal((await visible(host)).filter(item=>item.bookingRequestId===next.id).length,1);
   assert.deepEqual((await events(muted.id)).map(event=>event.status),['pending','accepted','cancelled']);
   await store.cancel(guest.token,guest.id,next.id,'1','Изменились планы.');
  });
  await suite.test('all inbox categories follow their own saved toggle and a retried event keeps its original delivery',async()=>{
   const {enqueueNotificationInTransaction,PostgresNotificationInbox}=load('postgres-notification-inbox');
   const inbox=new PostgresNotificationInbox(db);
   const categories={booking:'notifyBookings',message:'notifyMessages',payment:'notifyPayments',publication:'notifyPublicationStatus',system:'notifySystem'};
   const delivery=(key,category)=>db.transaction(tx=>enqueueNotificationInTransaction(tx,fifth.id,{
    eventKey:key,category,tone:'info',title:'Проверка настройки',body:'Синтетическое событие',actionHref:null,bookingRequestId:null
   }));
   for(const [muted,key] of Object.entries(categories)){
    await admin.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2) on conflict(user_id) do update set profile=excluded.profile',[fifth.id,{[key]:false}]);
    const ids=new Map();
    for(const category of Object.keys(categories))ids.set(category,await delivery(muted+':'+category,category));
    const visible=new Set((await inbox.list(fifth.token,fifth.id,null)).items.map(item=>item.id));
    for(const [category,id] of ids)assert.equal(visible.has(id),category!==muted);
    await admin.query('delete from app.cabinet_profiles where user_id=$1',[fifth.id]);
    assert.equal(await delivery(muted+':'+muted,muted),ids.get(muted));
    assert.equal((await inbox.list(fifth.token,fifth.id,null)).items.some(item=>item.id===ids.get(muted)),false);
   }
   assert.equal((await admin.query('select count(*)::int as n from app.notifications where user_id=$1',[fifth.id])).rows[0].n,25);
   assert.equal((await admin.query("select has_table_privilege('blizhniy_runtime','app.cabinet_profiles','SELECT') as profile,has_function_privilege('blizhniy_runtime','app.apply_inbox_preference()','EXECUTE') as fn")).rows.some(row=>row.profile||row.fn),false);
  });
  await suite.test('server freezes Moscow start and six-hour deadline, immutable quote and private original host',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   assert.equal(request.lifecycle.startsAt,day(2)+'T11:00:00.000000Z');assert.equal(request.total,'100.00');
   assert.equal(Date.parse(request.lifecycle.expiresAt)-Date.parse(request.createdAt),6*3600000);assert.equal(request.lifecycle.canCancel,true);
   assert.equal(Object.hasOwn(request,'hostId'),false);assert.deepEqual((await events(request.id)).map(e=>e.status),['pending']);
   await store.cancel(guest.token,guest.id,request.id,request.revision,'Не смогу приехать.');
  });
  await suite.test('both participants cancel pending or accepted once, notify the other and release the dates',async()=>{
   for(const actor of [guest,host])for(const accepted of [false,true]){
    const id=await listing(),data=input(id),request=await store.create(guest.token,guest.id,data);
    const current=accepted?await store.decide(host.token,host.id,request.id,'1','accepted'):request;
    const cancelled=await store.cancel(actor.token,actor.id,current.id,current.revision,'Изменились планы.');
    assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.lifecycle.canCancel,false);assert.equal(cancelled.total,request.total);
    assert.deepEqual(await store.cancel(actor.token,actor.id,current.id,current.revision,'Изменились планы.'),cancelled);
    await assert.rejects(store.cancel(actor.token,actor.id,current.id,current.revision,'Иная причина.'),{name:'BookingConflictError'});
    const peer=actor===host?guest:host;await assert.rejects(store.cancel(peer.token,peer.id,current.id,current.revision,'Изменились планы.'),{name:'BookingConflictError'});
    assert.deepEqual((await events(current.id)).map(e=>e.status),accepted?['pending','accepted','cancelled']:['pending','cancelled']);
    const notification=(await admin.query("select user_id,body from app.notifications where booking_request_id=$1 and event_key like 'booking_cancelled:%'",[current.id])).rows;
    assert.deepEqual(notification,[{user_id:peer.id,body:'Причина отмены: Изменились планы.'}]);
    assert.deepEqual((await inventory.read(id)).occupiedDates,[]);
    const next=await store.create(other.token,other.id,input(id));assert.equal(next.status,'pending');await store.cancel(other.token,other.id,next.id,'1','Проверка освобождения завершена.');
   }
  });
  await suite.test('expired hold releases anonymous inventory without cleanup; failed acceptance commits expiry and two notifications',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await inject(request.id,"expires_at=clock_timestamp()-interval '1 second'");
   assert.deepEqual((await inventory.read(id)).occupiedDates,[]);
   await assert.rejects(store.decide(host.token,host.id,request.id,'1','accepted'),{name:'BookingConflictError'});
   assert.equal((await store.read(guest.token,guest.id,request.id)).status,'expired');
   assert.deepEqual((await events(request.id)).map(e=>e.status),['pending','expired']);
   assert.equal((await admin.query("select count(*)::int as n from app.notifications where booking_request_id=$1 and event_key like 'booking_expired:%'",[request.id])).rows[0].n,2);
   assert.equal((await store.create(third.token,third.id,input(id))).status,'pending');
  });
  await suite.test('accepted bookings never automatically expire; cancellation after immutable start is refused',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));await store.decide(host.token,host.id,request.id,'1','accepted');
   await inject(request.id,"expires_at=clock_timestamp()-interval '1 second'");
   assert.equal((await store.read(guest.token,guest.id,request.id)).status,'accepted');assert.ok((await inventory.read(id)).occupiedDates.length);
   await inject(request.id,"starts_at=clock_timestamp()-interval '1 second'");
   await assert.rejects(store.cancel(guest.token,guest.id,request.id,'2','Не смогу приехать.'),{name:'BookingConflictError'});
   await assert.rejects(store.cancel(host.token,host.id,request.id,'2','Не смогу принять.'),{name:'BookingConflictError'});
  });
  await suite.test('three active holds are enforced across listing locks; expired and cancelled requests do not count',async()=>{
   const ids=await Promise.all(Array.from({length:4},()=>listing()));
   const results=await Promise.allSettled(ids.map(id=>store.create(fourth.token,fourth.id,input(id))));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.name==='BookingHoldLimitError').length,1);
   const active=results.find(r=>r.status==='fulfilled').value;await store.cancel(fourth.token,fourth.id,active.id,'1','Другие даты.');
   const remaining=ids[results.findIndex(r=>r.status==='rejected')];assert.equal((await store.create(fourth.token,fourth.id,input(remaining))).status,'pending');
  });
  await suite.test('accept versus cancellation uses exact bigint CAS; terminal cancellation cannot be resurrected',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await inject(request.id,'revision=9007199254740993');
   const result=await Promise.allSettled([store.decide(host.token,host.id,request.id,'9007199254740993','accepted'),store.cancel(guest.token,guest.id,request.id,'9007199254740993','Изменились планы.')]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);
   const stored=await store.read(guest.token,guest.id,request.id);assert.equal(stored.revision,'9007199254740994');
   if(stored.status==='cancelled')await assert.rejects(store.decide(host.token,host.id,request.id,stored.revision,'accepted'),{name:'BookingConflictError'});
  });
  await suite.test('foreign account and substituted owner cannot cancel or inspect private reasons',async()=>{
   const id=await listing(),request=await store.create(fifth.token,fifth.id,input(id));
   await assert.rejects(store.cancel(other.token,other.id,request.id,'1','Не моя заявка.'),{name:'BookingAccessError'});
   await assert.rejects(store.cancel(other.token,fifth.id,request.id,'1','Подмена владельца.'),{name:'AppSessionAccessError'});
   assert.equal((await events(request.id)).length,1);
  });
  await suite.test('expiry sweep needs no participant session, is replayable and cannot expire accepted or future requests',async()=>{
   const id=await listing(),request=await store.create(fifth.token,fifth.id,input(id));
   await inject(request.id,"expires_at=clock_timestamp()-interval '1 second'");
   const sweeper=new PostgresBookingExpiryStore(db),first=await sweeper.tick();assert.equal(first.state,'completed');assert.ok(first.expired>=1);
   const stored=await store.read(fifth.token,fifth.id,request.id);assert.equal(stored.status,'expired');
   const before=await events(request.id);assert.deepEqual(before.map(e=>e.status),['pending','expired']);assert.equal(before[1].actor_id,null);
   await sweeper.tick();assert.deepEqual(await events(request.id),before);
   assert.equal((await store.create(fifth.token,fifth.id,input(id))).status,'pending');
  });
  await suite.test('Moscow midnight and supplied start times are independent of the connection timezone; past same-day starts are rejected',async()=>{
   const connection=await admin.connect();try{
    await connection.query("set time zone 'Pacific/Honolulu'");
    const times=(await connection.query("select app.booking_start_time('stay','2026-11-05','{\"booking\":{}}') as midnight,app.booking_start_time('tour','2026-11-05','{\"booking\":{\"tourTime\":\"09:30\"}}') as tour")).rows[0];
    assert.equal(times.midnight.toISOString(),'2026-11-04T21:00:00.000Z');assert.equal(times.tour.toISOString(),'2026-11-05T06:30:00.000Z');
   }finally{await connection.query("set time zone 'UTC'");connection.release();}
   const id=await listing({...booking,checkInTime:'00:00'});
   await assert.rejects(store.create(guest.token,guest.id,input(id,{startDate:today,endDate:day(1)})),{name:'BookingConflictError'});
   assert.equal((await admin.query('select count(*)::int as n from app.booking_requests where listing_id=$1',[id])).rows[0].n,0);
  });
  await suite.test('notification failure rolls cancellation, history and calendar release back together',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await admin.query("create function app.synthetic_notification_failure() returns trigger language plpgsql as $$begin if new.event_key like 'booking_cancelled:%' then raise exception 'synthetic notification failure';end if;return new;end;$$;create trigger synthetic_notification_failure before insert on app.notifications for each row execute function app.synthetic_notification_failure()");
   try{await assert.rejects(store.cancel(guest.token,guest.id,request.id,'1','Отмена для проверки.'));}
   finally{await admin.query('drop trigger synthetic_notification_failure on app.notifications;drop function app.synthetic_notification_failure()');}
   assert.equal((await store.read(guest.token,guest.id,request.id)).status,'pending');assert.equal((await events(request.id)).length,1);assert.ok((await inventory.read(id)).occupiedDates.length);
   await store.cancel(guest.token,guest.id,request.id,'1','Проверка завершена.');
  });
  await suite.test('lost cancellation COMMIT acknowledgement recovers through read and exact replay without duplicated history or inbox',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));let commits=0;
   const uncertain=new PostgresBookingStore({transaction:async work=>{const result=await db.transaction(work);commits++;void result;throw Error('Synthetic lost acknowledgement');}},{lifecycle:true});
   await assert.rejects(uncertain.cancel(guest.token,guest.id,request.id,'1','Изменились планы.'));assert.equal(commits,1);
   const saved=await store.read(guest.token,guest.id,request.id);assert.equal(saved.status,'cancelled');assert.deepEqual(await store.cancel(guest.token,guest.id,request.id,'1','Изменились планы.'),saved);
   assert.equal((await events(request.id)).length,2);assert.equal((await admin.query("select count(*)::int as n from app.notifications where booking_request_id=$1 and event_key like 'booking_cancelled:%'",[request.id])).rows[0].n,1);
  });
  await suite.test('ordinary comparison signs in a reason are literal text, while markup is rejected before mutation',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await assert.rejects(async()=>store.cancel(guest.token,guest.id,request.id,'1','<script>alert(1)</script>'),{name:'BookingLifecycleInputError'});
   const saved=await store.cancel(guest.token,guest.id,request.id,'1','Цена < 100 > бюджета.');assert.equal(saved.lifecycle.cancellationReason,'Цена < 100 > бюджета.');
  });
  await suite.test('peer auth row locks refuse cancellation and expiry promptly, without FK deadlock or partial history',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id)),locker=await admin.connect();
   try{
    await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[host.id]);
    await assert.rejects(store.cancel(guest.token,guest.id,request.id,'1','Изменились планы.'),{name:'BookingBusyError'});
    assert.equal((await events(request.id)).length,1);await locker.query('rollback');
    await inject(request.id,"expires_at=clock_timestamp()-interval '1 second'");
    await locker.query('begin');await locker.query('select id from app.users where id=$1 for update',[guest.id]);
    await assert.rejects(new PostgresBookingExpiryStore(db).tick(),error=>error.code==='55P03');
    assert.deepEqual((await inventory.read(id)).occupiedDates,[]);assert.equal((await events(request.id)).length,1);
    await locker.query('rollback');assert.equal((await store.read(guest.token,guest.id,request.id)).status,'expired');
   }finally{await locker.query('rollback');locker.release();}
  });
  await suite.test('waiting for the listing lock cannot extend the acceptance deadline',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id)),locker=await admin.connect();
   await inject(request.id,"expires_at=clock_timestamp()+interval '800 milliseconds'");
   try{
    await locker.query('begin');await locker.query('select id from app.listings where id=$1 for update',[id]);
    const accepting=store.decide(host.token,host.id,request.id,'1','accepted').then(value=>({value}),error=>({error}));
    const deadline=Date.now()+2500;let waiting=false;
    while(Date.now()<deadline){waiting=(await admin.query("select exists(select 1 from pg_stat_activity where usename='blizhniy_runtime' and wait_event_type='Lock' and query like '%app.listings%') as waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,15));}
    assert.equal(waiting,true,'real acceptance must be waiting for the listing');await locker.query('select pg_sleep(0.9)');await locker.query('commit');
    const result=await accepting;assert.equal(result.error?.name,'BookingConflictError');
    assert.equal((await store.read(guest.token,guest.id,request.id)).status,'expired');assert.deepEqual((await events(request.id)).map(e=>e.status),['pending','expired']);
    assert.equal((await store.create(third.token,third.id,input(id))).status,'pending');
   }finally{await locker.query('rollback');locker.release();}
  });
  await suite.test('original booking host and private access survive an owner-operated listing transfer',async()=>{
   const id=await listing(),request=await store.create(guest.token,guest.id,input(id));
   await admin.query('update app.listings set author_id=$2 where id=$1',[id,other.id]);
   assert.equal((await store.read(host.token,host.id,request.id)).view,'host');await assert.rejects(store.read(other.token,other.id,request.id),{name:'BookingAccessError'});
   await store.cancel(host.token,host.id,request.id,'1','Невозможно принять гостя.');
   assert.equal((await store.read(guest.token,guest.id,request.id)).lifecycle.cancelledBy,'host');
  });
  await suite.test('restricted role cannot rewrite host, deadlines, amount, snapshots, audit or financial state',async()=>{
   for(const sql of ["update app.booking_requests set starts_at=clock_timestamp() where false","update app.booking_requests set expires_at=clock_timestamp() where false","update app.booking_requests set host_id=gen_random_uuid() where false","update app.booking_requests set total=0 where false","update app.booking_requests set details_snapshot='{}' where false","insert into app.booking_events default values","delete from app.booking_events where false","update app.booking_events set reason='bad' where false","update app.listings set is_paid=true where false"]){await assert.rejects(db.query(sql),{code:'42501'});}
   assert.equal((await admin.query('select count(*)::int as n from app.payment_orders')).rows[0].n,0);
  });
 }finally{
  await Promise.allSettled([db?.close(),admin?.end()]);
  if(container){const metadata=JSON.parse(await docker(['inspect',container]))[0];assert.equal(metadata.Id,container);assert.equal(metadata.Config.Labels[label],name);await docker(['rm','--force',container]);}
 }
});
