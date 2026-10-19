import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';
import {formModule} from './listing-form-module.mjs';import * as http from '../src/lib/auth-http.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
const {createProductionBookingInventoryHandler}=formModule('production-booking-inventory-http',{'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':http,'./trusted-proxy-ip':proxy});
const origin='https://inventory.example.invalid',id='10000000-0000-4000-8000-000000000001';
test('anonymous booking inventory rejects unsafe ingress, identifiers, query and method before runtime',async()=>{
 for(const [method,headers,key,query,status] of [['POST',{},id,'',405],['GET',{host:'foreign.invalid'},id,'',403],['GET',{'x-real-ip':''},id,'',403],['GET',{},'invalid','',404],['GET',{},id,'?guestId=someone',400]]){
  let calls=0;const handler=createProductionBookingInventoryHandler({origin},()=>{calls++;throw Error();},()=>{}),response=await handler(new Request(origin+'/api/listings/'+id+'/bookings'+query,{method,headers:{host:'inventory.example.invalid','x-real-ip':'192.0.2.7',...headers}}),key);
  assert.equal(response.status,status);assert.equal(calls,0);assert.equal(response.headers.get('cache-control'),'no-store');
 }
});
test('anonymous inventory returns current public stock without cookies, fails closed rather than empty-success on unavailable SQL, and audits no identifiers',async()=>{
 for(const [value,status,code] of [[{occupiedDates:[]},200,null],[null,404,'BOOKING_NOT_FOUND'],[Error('private SQL details'),503,'BOOKINGS_UNAVAILABLE']]){
  const events=[],calls=[],handler=createProductionBookingInventoryHandler({origin},()=>({read:async key=>{calls.push(key);if(value instanceof Error)throw value;return value;}}),event=>events.push(event));
  const response=await handler(new Request(origin+'/api/listings/'+id+'/bookings',{headers:{host:'inventory.example.invalid','x-real-ip':'192.0.2.7'}}),id);
  assert.equal(response.status,status);assert.deepEqual(await response.json(),code?{error:{code}}:value);assert.deepEqual(calls,[id]);assert.equal(JSON.stringify(events).includes(id),false);
 }
});
