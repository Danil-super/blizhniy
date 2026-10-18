import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseBookingRequest,quoteBookingRequest,BookingRequestInputError,BookingQuoteError} from '../src/lib/booking-request-contract.ts';
const id='10000000-0000-4000-8000-000000000001',key='10000000-0000-4000-8000-000000000002',today='2026-10-18';
const input={listingId:id,creationKey:key,expectedListingRevision:'9007199254740993',mode:'stay',startDate:'2026-10-23',endDate:'2026-10-26',guests:3};
const stay={mode:'stay',priceWeekday:100.01,priceWeekend:200.02,minNights:1,includedGuests:2,maxGuests:5,extraGuestPrice:10.03,availableFrom:'2026-10-18',availableTo:'2026-12-31',blockedDates:[]};
test('booking request exact input binds target/revision/intent and calendar dates without claimed guest identity, price or status',()=>{
 assert.deepEqual(parseBookingRequest(input),input);
 for(const patch of [{total:'0.01'},{guestId:id},{status:'accepted'},{snapshot:{}},{expectedListingRevision:9007199254740993},{mode:'unknown'},{guests:0},{guests:1001},{guests:1.5},{startDate:'2026-02-30'},{startDate:'0000-01-01'},{endDate:null}])assert.throws(()=>parseBookingRequest({...input,...patch}),BookingRequestInputError);
 const inherited=Object.create(input);assert.throws(()=>parseBookingRequest(inherited),BookingRequestInputError);
 assert.throws(()=>parseBookingRequest({...input,[Symbol('private')]:true}),BookingRequestInputError);
 const tour={...input,mode:'tour',endDate:null};assert.deepEqual(parseBookingRequest(tour),tour);
 assert.throws(()=>parseBookingRequest({...tour,endDate:'2026-10-24'}),BookingRequestInputError);
});
test('stay quote computes exact kopecks for each night and extra guest, never rounding binary floating point or charging checkout day',()=>{
 const quote=quoteBookingRequest(stay,parseBookingRequest(input),today);
 assert.deepEqual(quote,{mode:'stay',startDate:input.startDate,endDate:input.endDate,guests:3,nights:3,total:'530.14'});
 const oneNight={...input,startDate:'2026-10-18',endDate:'2026-10-19',guests:1};assert.equal(quoteBookingRequest({...stay,blockedDates:['2026-10-19']},parseBookingRequest(oneNight),today).total,'200.02');
 assert.equal(quoteBookingRequest({...stay,priceWeekday:0.1,priceWeekend:0.1,extraGuestPrice:0.2},parseBookingRequest(input),today).total,'0.90');
 const huge={...stay,priceWeekday:9999999999.99,priceWeekend:9999999999.99,extraGuestPrice:9999999999.99,maxGuests:1000,includedGuests:1};
 assert.equal(quoteBookingRequest(huge,parseBookingRequest({...input,guests:1000}),today).total,'29999999999970.00');
});
test('stay quote enforces occupied nights, inclusive availableTo, bounds, minimum nights and guest limits without swallowing invalid server configuration',()=>{
 for(const patch of [{blockedDates:['2026-10-24']},{availableFrom:'2026-10-24'},{availableTo:'2026-10-24'},{minNights:4},{maxGuests:2,includedGuests:2},
  {includedGuests:6},{priceWeekday:0},{priceWeekend:Infinity},{priceWeekday:0.001},{extraGuestPrice:-1},{blockedDates:['2026-02-30']}])assert.throws(()=>quoteBookingRequest({...stay,...patch},parseBookingRequest(input),today),BookingQuoteError);
 for(const patch of [{startDate:'2026-10-17',endDate:'2026-10-19'},{startDate:'2027-10-19',endDate:'2027-10-20'},
  {startDate:'2026-10-18',endDate:'2026-11-18'},{endDate:input.startDate}])assert.throws(()=>quoteBookingRequest(stay,parseBookingRequest({...input,...patch}),today),BookingQuoteError);
 assert.equal(quoteBookingRequest({...stay,availableTo:'2026-10-25'},parseBookingRequest(input),today).nights,3);
 const last={...input,startDate:'2027-10-18',endDate:'2027-10-19'},unbounded={...stay};delete unbounded.availableTo;assert.equal(quoteBookingRequest(unbounded,parseBookingRequest(last),today).nights,1);
 assert.throws(()=>quoteBookingRequest(stay,parseBookingRequest(input),'2026-02-30'),BookingQuoteError);
});
test('tour quote uses only current server date and price, exact per-person multiplication and capacity; period and money fields are not input',()=>{
 const tour={mode:'tour',tourDate:'2026-10-23',pricePerPerson:100.01,maxGuests:4},request=parseBookingRequest({...input,mode:'tour',endDate:null});
 assert.deepEqual(quoteBookingRequest(tour,request,today),{mode:'tour',startDate:request.startDate,endDate:null,guests:3,nights:0,total:'300.03'});
 for(const patch of [{tourDate:'2026-10-24'},{tourDate:'2026-10-17'},{maxGuests:2},{maxGuests:1.5},{pricePerPerson:NaN},{pricePerPerson:0.001}])assert.throws(()=>quoteBookingRequest({...tour,...patch},request,today),BookingQuoteError);
 assert.throws(()=>quoteBookingRequest(tour,parseBookingRequest(input),today),BookingQuoteError);
});
