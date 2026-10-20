import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paymentPublicationPeriod,PaymentPublicationError} from '../src/lib/payment-publication-period.ts';

test('paid period uses original capture and duration, never the reconciliation time',()=>{
 assert.deepEqual(paymentPublicationPeriod('2026-10-19T11:59:00Z',30),{publishedAt:'2026-10-19T11:59:00.000000Z',expiresAt:'2026-11-18T11:59:00.000000Z'});
 assert.deepEqual(paymentPublicationPeriod('2024-02-28T23:59:59.123456Z',2),{publishedAt:'2024-02-28T23:59:59.123456Z',expiresAt:'2024-03-01T23:59:59.123456Z'});
 assert.deepEqual(paymentPublicationPeriod('2026-03-08T01:00:00.1Z',1),{publishedAt:'2026-03-08T01:00:00.100000Z',expiresAt:'2026-03-09T01:00:00.100000Z'});
});
test('PostgreSQL precision is rounded inward, including carry to the next second',()=>{
 assert.deepEqual(paymentPublicationPeriod('2026-10-19T11:59:00.123456789Z',30),{publishedAt:'2026-10-19T11:59:00.123457Z',expiresAt:'2026-11-18T11:59:00.123456Z'});
 assert.deepEqual(paymentPublicationPeriod('2026-12-31T23:59:59.999999999Z',1),{publishedAt:'2027-01-01T00:00:00.000000Z',expiresAt:'2027-01-01T23:59:59.999999Z'});
 assert.deepEqual(paymentPublicationPeriod('2026-10-19T11:59:00.123000000Z',30),paymentPublicationPeriod('2026-10-19T11:59:00.123Z',30));
});
test('absent, malformed or impossible capture and unbounded durations never create an entitlement',()=>{
 for(const capture of [null,undefined,'','2026-02-30T00:00:00Z','2026-10-19T24:00:00Z','2026-10-19T11:59:00.1234567890Z','2026-10-19T11:59:00+00:00','9999-12-31T00:00:00Z'])
  assert.throws(()=>paymentPublicationPeriod(capture,30),PaymentPublicationError);
 for(const duration of [null,0,-1,1.5,3651,NaN,'30'])assert.throws(()=>paymentPublicationPeriod('2026-10-19T11:59:00Z',duration),PaymentPublicationError);
});
