import assert from 'node:assert/strict';import {test} from 'node:test';
import {validateBookingSelection,bookingMatchesSelection} from '../src/lib/booking-selection.ts';
const id='10000000-0000-4000-8000-000000000001',key='10000000-0000-4000-8000-000000000002';
const inventory={listing:{id,title:'Синтетическое жильё',revision:'9007199254740993'},booking:{mode:'stay',priceWeekday:100,priceWeekend:150,minNights:2,includedGuests:2,maxGuests:4},today:'2026-10-19',occupiedDates:['2026-10-23'],tourSeatsRemaining:null};
const selection={startDate:'2026-10-20',endDate:'2026-10-22',guests:'2'};
test('booking selection retains exact server revision and never adds a client amount or guest identity to the request',()=>{
 const result=validateBookingSelection(inventory,selection,key);assert.deepEqual(result.issues,{});assert.deepEqual(result.input,{listingId:id,creationKey:key,expectedListingRevision:inventory.listing.revision,mode:'stay',startDate:selection.startDate,endDate:selection.endDate,guests:2});
});
test('booking selection provides field errors for empty, malformed, stale, too short/long, blocked or over-capacity periods',()=>{
 for(const [fields,field] of [[{startDate:''},'startDate'],[{startDate:'2026-02-30'},'startDate'],[{startDate:'2026-10-18'},'startDate'],[{endDate:''},'endDate'],[{endDate:'2026-10-21'},'endDate'],[{endDate:'2026-12-01'},'endDate'],[{endDate:'2026-10-24'},'endDate'],[{guests:''},'guests'],[{guests:'0'},'guests'],[{guests:'5'},'guests'],[{guests:'1.5'},'guests']]){
  const result=validateBookingSelection(inventory,{...selection,...fields},key);assert.equal(result.input,null);assert.equal(typeof result.issues[field],'string');
 }
 const blocked=validateBookingSelection({...inventory,booking:{...inventory.booking,blockedDates:['2026-10-21']}},selection,key);assert.equal(blocked.input,null);assert.ok(blocked.issues.endDate);
});
test('checkout can be the next occupied/blocked date, and configured first/last night and server window are enforced',()=>{
 assert.ok(validateBookingSelection(inventory,{...selection,endDate:'2026-10-23'},key).input);
 assert.ok(validateBookingSelection({...inventory,booking:{...inventory.booking,blockedDates:['2026-10-22'],availableTo:'2026-10-21'}},selection,key).input);
 assert.ok(validateBookingSelection({...inventory,booking:{...inventory.booking,availableFrom:'2026-10-21'}},selection,key).issues.startDate);
 assert.ok(validateBookingSelection({...inventory,today:'2026-10-21'},selection,key).issues.startDate);
 assert.ok(validateBookingSelection(inventory,{...selection,startDate:'2027-10-20',endDate:'2027-10-23'},key).issues.startDate);
});
test('tour selection uses the server-defined tour date and accepted-seat remainder, not an editable arbitrary period',()=>{
 const tour={...inventory,booking:{mode:'tour',pricePerPerson:100,tourDate:'2026-10-22',maxGuests:4},occupiedDates:[],tourSeatsRemaining:2};
 const result=validateBookingSelection(tour,{startDate:'2026-10-22',endDate:'',guests:'2'},key);assert.ok(result.input);assert.equal(result.input.endDate,null);
 assert.ok(validateBookingSelection(tour,{startDate:'2026-10-23',endDate:'',guests:'2'},key).issues.startDate);
 assert.ok(validateBookingSelection(tour,{startDate:'2026-10-22',endDate:'',guests:'3'},key).issues.guests);
});
test('recovered booking must match the immutable original selection before it is treated as a successful submission',()=>{
 const {input}=validateBookingSelection(inventory,selection,key),saved={listing:{id},view:'guest',mode:'stay',startDate:selection.startDate,endDate:selection.endDate,guests:2};
 assert.equal(bookingMatchesSelection(saved,input),true);
 for(const changed of [{listing:{id:key}},{view:'host'},{mode:'tour'},{startDate:'2026-10-21'},{endDate:'2026-10-23'},{guests:3}])assert.equal(bookingMatchesSelection({...saved,...changed},input),false);
});
