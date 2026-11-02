import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PostgresPlacementRefundEffectStore, RefundEffectError} from '../src/lib/postgres-placement-refund-effect.ts';

const merchant = {shopId: 'effect-fixture', isTest: true};
const operationId = '10000000-0000-4000-8000-000000000001';
test('refund effect validates TEST merchant before database access', () => {
  let calls = 0;
  const db = {transaction() {calls++; throw Error('Unexpected SQL');}};
  for (const invalid of [null, {}, {...merchant, isTest: false}, {...merchant, isTest: 'true'}, {...merchant, shopId: '../shop'}, {...merchant, shopId: 'a'.repeat(65)}]) {
    assert.throws(() => new PostgresPlacementRefundEffectStore(db, invalid), RefundEffectError);
  }
  assert.equal(calls, 0);
});
test('refund effect rejects malformed operation IDs before database access', async () => {
  let calls = 0;
  const store = new PostgresPlacementRefundEffectStore({transaction() {calls++; throw Error('Unexpected SQL');}}, merchant);
  for (const invalid of [undefined, null, {}, [], 1, '', '../operation', operationId + '\n', 'a'.repeat(10000)]) {
    await assert.rejects(store.apply(invalid), RefundEffectError);
  }
  assert.equal(calls, 0);
});

test('refund processor rejects invalid operation before SQL, provider I/O or POST authorization', async () => {
  const {createPrimaryPlacementRefundProcessor} = await import('../src/lib/primary-placement-refund-processor.ts');
  let sql = 0, network = 0, authorization = 0;
  const processor = createPrimaryPlacementRefundProcessor({transaction() {sql++; throw Error('Unexpected SQL');}}, {...merchant, secretKey:'test_fixture'}, async () => {network++; throw Error('Unexpected provider I/O');});
  for (const invalid of [null, {}, '', '../refund', operationId + '\n']) {
    await assert.rejects(processor.process(invalid, async () => {authorization++;}));
  }
  assert.deepEqual({sql, network, authorization}, {sql:0, network:0, authorization:0});
});
