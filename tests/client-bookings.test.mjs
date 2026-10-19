import assert from 'node:assert/strict';import {test} from 'node:test';import {createBookingsClient,BookingClientError} from '../src/lib/client-bookings.ts';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',stamp='2026-10-19T00:00:00.123456Z';
const input={listingId:id,creationKey:key,expectedListingRevision:'9007199254740993',mode:'stay',startDate:'2026-10-20',endDate:'2026-10-22',guests:2};
const booking={mode:'stay',priceWeekday:100,priceWeekend:100,minNights:1,maxGuests:4,includedGuests:2,extraGuestPrice:0};
const listing={id,revision:input.expectedListingRevision,title:'Синтетическое жильё'},quote={mode:'stay',startDate:input.startDate,endDate:input.endDate,guests:2,nights:2,total:'200.00'};
const detail={id,revision:'1',view:'guest',listing:{id,title:listing.title},mode:'stay',startDate:input.startDate,endDate:input.endDate,guests:2,total:'200.00',status:'pending',booking,createdAt:stamp,updatedAt:stamp,decidedAt:null};
const inventory={listing,booking,today:'2026-10-19',occupiedDates:['2026-10-23'],tourSeatsRemaining:null};
test('booking client uses bounded cookie-only exact owner/intent/CAS requests and never retries an ambiguous write',async()=>{
 const calls=[],client=createBookingsClient(async(path,init)=>{const body=init.body?JSON.parse(init.body):null;calls.push({path,init,body});return Response.json(!body?inventory:body.action==='preview'?{listing,quote}:detail);});
 assert.deepEqual(await client.inventory(id),inventory);assert.deepEqual(await client.preview(owner,input),{listing,quote});assert.deepEqual(await client.create(owner,input),detail);assert.deepEqual(await client.intent(owner,key),detail);assert.deepEqual(await client.read(owner,id),detail);
 for(const call of calls){assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers?.Authorization,undefined);if(call.body)assert.equal(call.body.expectedOwnerId,owner);}
 assert.equal(calls[2].init.method,'PUT');assert.equal(calls[2].body.input.creationKey,key);
 let writes=0;await assert.rejects(createBookingsClient(async()=>{writes++;throw Error('Lost response');}).create(owner,input),BookingClientError);assert.equal(writes,1);
});
test('booking client refuses foreign IDs, identities, forged quotes, invalid dates and acknowledgements that do not bind the submitted intent',async()=>{
 for(const bad of [{...detail,id:key},{...detail,guest:owner},{...detail,revision:1},{...detail,total:'0.001'},{...detail,endDate:'2026-02-30'},{...detail,status:'accepted'},{...detail,booking:{...booking,secret:'bad'}}]){
  await assert.rejects(createBookingsClient(async()=>Response.json(bad)).read(owner,id),BookingClientError);
 }
 for(const bad of [{listing:{...listing,id:key},quote},{listing,quote:{...quote,guests:3}},{listing,quote:{...quote,startDate:'2026-10-21'}},{listing,quote:{...quote,total:200}}])await assert.rejects(createBookingsClient(async()=>Response.json(bad)).preview(owner,input),BookingClientError);
 await assert.rejects(createBookingsClient(async()=>Response.json({...detail,guests:3})).create(owner,input),BookingClientError);
 const accepted={...detail,view:'host',status:'accepted',revision:'9007199254740994',decidedAt:stamp};
 assert.deepEqual(await createBookingsClient(async()=>Response.json(accepted)).decide(owner,id,'9007199254740993','accepted'),accepted);
 for(const bad of [{...accepted,view:'guest'},{...accepted,status:'declined'},{...accepted,revision:'9007199254740995'}])await assert.rejects(createBookingsClient(async()=>Response.json(bad)).decide(owner,id,'9007199254740993','accepted'),BookingClientError);
});
test('booking inventory is exact, date-window-bounded and anonymous; list pages retain exact microsecond ordering',async()=>{
 for(const bad of [{...inventory,requests:[detail]},{...inventory,listing:{...listing,id:key}},{...inventory,occupiedDates:['2026-10-23','2026-10-23']},{...inventory,occupiedDates:['2028-01-01']},{...inventory,tourSeatsRemaining:2}])await assert.rejects(createBookingsClient(async()=>Response.json(bad)).inventory(id),BookingClientError);
 const {booking,updatedAt,decidedAt,...summary}=detail;assert.ok(booking);assert.ok(updatedAt);assert.equal(decidedAt,null);
 assert.deepEqual(await createBookingsClient(async()=>Response.json({items:[summary],nextCursor:null})).list(owner,'guest',null),{items:[summary],nextCursor:null});
 for(const page of [{items:[summary,summary],nextCursor:null},{items:[{...summary,booking}],nextCursor:null},{items:[summary],nextCursor:{id,updatedAt:stamp}}])await assert.rejects(createBookingsClient(async()=>Response.json(page)).list(owner,'guest',null),BookingClientError);
});
test('booking client bounds body bytes/chunks, honours abort before network and does not trust a mismatched structured error',async()=>{
 for(const response of [()=>new Response('x'.repeat(262145)),()=>new Response('{'),()=>new Response(new Uint8Array([255]))])await assert.rejects(createBookingsClient(async()=>response()).read(owner,id),BookingClientError);
 let cancelled=false;await assert.rejects(createBookingsClient(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}}))).read(owner,id),BookingClientError);assert.equal(cancelled,true);
 let calls=0;await assert.rejects(createBookingsClient(async()=>{calls++;return Response.json(detail);}).read(owner,id,{signal:AbortSignal.abort()}),BookingClientError);assert.equal(calls,0);
 for(const [status,code,expected] of [[401,'UNAUTHENTICATED','UNAUTHENTICATED'],[409,'BOOKING_CHANGED','BOOKING_CHANGED'],[409,'BOOKING_BUSY','BOOKING_BUSY'],[500,'UNAUTHENTICATED','UNKNOWN']])await assert.rejects(createBookingsClient(async()=>Response.json({error:{code}},{status})).read(owner,id),error=>error.code===expected);
});
