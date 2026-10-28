import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
import {bookingDetails} from './listing-publication-check-module.mjs';
import * as bookingContract from '../src/lib/booking-request-contract.ts';
const eligibility=formModule('listing-public-eligibility');
const projection=formModule('public-listings',{'./booking-details':bookingDetails});
const {PostgresPublicListingStore}=formModule('postgres-public-listings',{'./public-listings':projection,'./listing-public-eligibility':eligibility});
const {PostgresBookingAvailabilityStore}=formModule('postgres-bookings',{'./booking-request-contract.ts':bookingContract,'./postgres-notification-inbox':{},'./listing-public-eligibility':eligibility});
const id='11111111-1111-4111-8111-111111111111',photo='22222222-2222-4222-8222-222222222222';
test('postmoderation anonymous detail, category/seller lists and photos all require no persistent block',async()=>{
 const queries=[],db={query:async(sql)=>{queries.push(sql);return{rows:[],rowCount:0};}},store=new PostgresPublicListingStore(db,{postmoderation:true});
 assert.equal(await store.read(id),undefined);assert.deepEqual(await store.list({ownerId:id,categorySlug:'otdyh'}),[]);assert.equal(await store.photoRecord(id,photo),undefined);
 assert.equal(queries.length,3);
 for(const sql of queries){assert.match(sql,/not exists\(select 1 from app\.listing_blocks block where block\.listing_id=l\.id\)/);assert.doesNotMatch(sql,/join app\.listing_moderation review/);assert.match(sql,/l\.status='published' and l\.is_paid/);}
});
test('default public SQL remains approval-gated without schema26 references',async()=>{
 const queries=[],store=new PostgresPublicListingStore({query:async(sql)=>{queries.push(sql);return{rows:[],rowCount:0};}});
 await store.read(id);await store.list();await store.photoRecord(id,photo);
 for(const sql of queries){assert.match(sql,/review\.state='approved'/);assert.doesNotMatch(sql,/app\.listing_blocks/);}
});
test('blocked local listings never expose anonymous booking inventory',async()=>{
 let calls=0;const store=new PostgresBookingAvailabilityStore({query:async(sql)=>{calls++;assert.match(sql,/not exists\(select 1 from app\.listing_blocks/);assert.doesNotMatch(sql,/join app\.listing_moderation review/);return{rows:[],rowCount:0};}},{postmoderation:true});
 assert.equal(await store.read(id),null);assert.equal(calls,1);
});
