import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readBookingRuntimeEnabled} from '../src/lib/production-booking-config.ts';

test('hosted booking lifecycle is opt-in on the production PostgreSQL site',()=>{
 const env={NODE_ENV:'production',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readBookingRuntimeEnabled(env),false);
 const on={...env,BLIZHNIY_BOOKING_LIFECYCLE:'production-v1'};
 assert.equal(readBookingRuntimeEnabled(on),true);
 for(const change of [{NODE_ENV:'development'},{BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'},
  {BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'},{BLIZHNIY_LOCAL_PRIMARY:'enabled'},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'}]){
  assert.throws(()=>readBookingRuntimeEnabled({...on,...change}));
 }
 assert.equal(readBookingRuntimeEnabled({BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'}),true);
});
