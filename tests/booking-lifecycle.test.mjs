import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {createBookingsClient,BookingClientError} from '../src/lib/client-bookings.ts';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const stamp='2026-11-03T00:00:00.123456Z';
const lifecycle={startsAt:'2026-11-05T11:00:00.000000Z',expiresAt:'2026-11-03T06:00:00.123456Z',canCancel:false,cancelledBy:'guest',cancellationReason:'Изменились планы.'};
const saved={id,revision:'9007199254740994',view:'guest',listing:{id,title:'Синтетическое жильё'},mode:'stay',startDate:'2026-11-05',endDate:'2026-11-06',guests:2,total:'200.00',status:'cancelled',booking:{mode:'stay',priceWeekday:100,priceWeekend:100,minNights:1,maxGuests:4,includedGuests:2},createdAt:stamp,updatedAt:stamp,decidedAt:stamp,lifecycle};
test('booking cancellation requires bounded plain-text reason without silently truncating or coercing input',()=>{
 const {parseBookingCancellation,BookingLifecycleInputError}=load('booking-lifecycle');
 assert.equal(parseBookingCancellation('  Изменились планы.  '),'Изменились планы.');
 assert.equal(parseBookingCancellation('Я не смогу приехать — перенесём на 12-е.'),'Я не смогу приехать — перенесём на 12-е.');
 for(const reason of [null,3,'','  ','x'.repeat(501),'<img src=x onerror=alert(1)>','Нельзя\u0000','Ложь\u202eтекст','\ud800'])assert.throws(()=>parseBookingCancellation(reason),BookingLifecycleInputError);
 assert.equal(parseBookingCancellation('я'.repeat(500)).length,500);
});
test('booking cancellation client binds owner, id, exact bigint CAS and acknowledged reason with no write retry',async()=>{
 const calls=[],client=createBookingsClient(async(path,init)=>{calls.push({path,init,body:JSON.parse(init.body)});return Response.json(saved);});
 assert.deepEqual(await client.cancel(owner,id,'9007199254740993','Изменились планы.'),saved);
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/account/bookings');assert.equal(calls[0].init.method,'PUT');
 assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.redirect,'error');
 assert.deepEqual(calls[0].body,{action:'cancel',expectedOwnerId:owner,bookingId:id,expectedRevision:'9007199254740993',reason:'Изменились планы.'});
 for(const bad of [{...saved,id:owner},{...saved,status:'accepted'},{...saved,revision:'9007199254740995'},{...saved,lifecycle:{...lifecycle,cancellationReason:'Другая причина.'}},{...saved,lifecycle:{...lifecycle,canCancel:true}},{...saved,lifecycle:{...lifecycle,cancelledBy:owner}}])await assert.rejects(createBookingsClient(async()=>Response.json(bad)).cancel(owner,id,'9007199254740993','Изменились планы.'),BookingClientError);
 let writes=0;await assert.rejects(createBookingsClient(async()=>{writes++;throw Error('Synthetic lost reply');}).cancel(owner,id,'1','Изменились планы.'),BookingClientError);assert.equal(writes,1);
});
test('booking client accepts explicit expiry and validates lifecycle deadlines and action permissions',async()=>{
 const expired={...saved,status:'expired',revision:'2',lifecycle:{...lifecycle,cancelledBy:null,cancellationReason:null}};
 assert.deepEqual(await createBookingsClient(async()=>Response.json(expired)).read(owner,id),expired);
 for(const bad of [{...expired,lifecycle:{...expired.lifecycle,canCancel:true}},{...expired,lifecycle:{...expired.lifecycle,expiresAt:'2026-11-06T00:00:00.000000Z'}},{...expired,lifecycle:{...expired.lifecycle,private:owner}},{...expired,lifecycle:{...expired.lifecycle,cancelledBy:'host'}}])await assert.rejects(createBookingsClient(async()=>Response.json(bad)).read(owner,id),BookingClientError);
});
test('booking lifecycle activation is local-only and rejects accidental production activation',()=>{
 const {readBookingLifecycleEnabled}=load('booking-lifecycle');
 assert.equal(readBookingLifecycleEnabled({}),false);
 assert.equal(readBookingLifecycleEnabled({BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'}),true);
 for(const env of [{BLIZHNIY_BOOKING_LIFECYCLE:'true'},{BLIZHNIY_BOOKING_LIFECYCLE:'local-v1'},{BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.invalid'},{BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:99999'}])assert.throws(()=>readBookingLifecycleEnabled(env));
});
test('cancellation HTTP requires exact cookie/CSRF/owner/revision/reason envelope and never audits the private reason',async()=>{
 const {createProductionBookingHandler}=load('production-booking-http'),origin='https://bookings.example.invalid',calls=[],audit=[];let factories=0;
 const handler=createProductionBookingHandler({origin},()=>{factories++;return{store:{cancel:async(...args)=>{calls.push(args);return saved;}},limiter:{allowProduction:async()=>true}};},event=>audit.push(event));
 const body={action:'cancel',expectedOwnerId:owner,bookingId:id,expectedRevision:'9007199254740993',reason:'Изменились планы.'};
 const request=(value,headers={})=>new Request(origin+'/api/account/bookings',{method:'PUT',headers:{host:'bookings.example.invalid',origin,'x-real-ip':'192.0.2.5','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+'b'.repeat(64),...headers},body:JSON.stringify(value)});
 for(const bad of [{...body,reason:''},{...body,reason:'<script>x</script>'},{...body,reason:'x'.repeat(501)},{...body,expectedRevision:1},{...body,cancelledBy:owner},{...body,total:'0.00'}])assert.equal((await handler(request(bad))).status,422);
 assert.equal(factories,0);assert.equal((await handler(request(body,{cookie:''}))).status,401);assert.equal((await handler(request(body,{origin:'https://other.invalid'}))).status,403);
 assert.equal((await handler(request(body))).status,200);assert.equal(calls.length,1);assert.deepEqual(calls[0],['b'.repeat(64),owner,id,'9007199254740993','Изменились планы.']);
 for(const secret of [body.reason,owner,id,'b'.repeat(64)])assert.equal(JSON.stringify(audit).includes(secret),false);
});
