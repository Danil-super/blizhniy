import assert from 'node:assert/strict';import {test} from 'node:test';
import {getBookingReadGrantPlan,grantBookingPublicationRead} from '../scripts/grant-booking-read.mjs';
test('booking read grant plan is exact reviewed history plus three fixed read-only columns, never table-wide SELECT or financial writes',()=>{
 const plan=getBookingReadGrantPlan();assert.equal(plan.migrations.length,18);assert.deepEqual(plan.columns,['is_paid','published_at','expires_at']);assert.equal(plan.table,'app.listings');assert.equal(plan.role,'blizhniy_runtime');
});
test('booking read operator refuses a mismatched target before any SQL and never treats malformed confirmation as approval',async()=>{
 let queries=0;const client={connectionParameters:{host:'127.0.0.1',database:'owned'},query:async()=>{queries++;throw Error('Must not query');}};
 for(const value of [undefined,'','wrong:owned','127.0.0.1:other',{},'127.0.0.1:owned\n'])await assert.rejects(grantBookingPublicationRead(client,value));assert.equal(queries,0);
});
