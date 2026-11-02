import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {validatePrimaryYooKassaRefund} from '../src/lib/yookassa-refund-contract.ts';
import {createPrimaryYooKassaRefundReader} from '../src/lib/primary-yookassa-refund-reader.ts';
const load = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {PostgresRefundJournalStore, RefundJournalError} = load('postgres-refund-journal');
const operationId = '10000000-0000-4000-8000-000000000001';
const payment = {id: '10000000-0000-4000-8000-000000000002', targetId: '10000000-0000-4000-8000-000000000003', targetType: 'listing', tariffId: 'listing-publication', amount: '199.00', shopId: 'fixture-shop', isTest: true, providerPaymentId: '216749f7-0016-50be-b000-078d43a63ae4'};
const binding = {operationId, payment, providerRefundId: '216749f7-0016-50be-b000-078d43a63ae5', amount: '199.00'};
const payload = () => ({id: binding.providerRefundId, payment_id: payment.providerPaymentId, amount: {value: '199.00', currency: 'RUB'}, status: 'pending', created_at: '2026-01-01T12:00:00.123456789Z', metadata: {localRefundId: operationId, localPaymentId: payment.id}});
const now = Date.parse('2026-01-02T00:00:00Z');
const merchant = {shopId: payment.shopId, isTest: true, secretKey: 'test_fixture'};
const paid = capturedAt => ({id: payment.providerPaymentId, amount: {value: payment.amount, currency: 'RUB'}, paid: true, status: 'succeeded', test: true, recipient: {account_id: payment.shopId}, captured_at: capturedAt, metadata: {localPaymentId: payment.id, targetId: payment.targetId, targetType: payment.targetType, tariffId: payment.tariffId}});

test('journal provenance requires both prepared operation and original payment metadata', () => {
  assert.equal(validatePrimaryYooKassaRefund(payload(), binding, now).status, 'pending');
  for (const metadata of [undefined, null, {}, {localRefundId: operationId}, {localPaymentId: payment.id}, {localRefundId: payment.id, localPaymentId: payment.id}, {localRefundId: operationId, localPaymentId: operationId}]) {
    assert.throws(() => validatePrimaryYooKassaRefund({...payload(), metadata}, binding, now));
  }
  for (const value of [null, {}, '', '../../refunds', operationId + '\n']) assert.throws(() => validatePrimaryYooKassaRefund(payload(), {...binding, operationId: value}, now));
  assert.throws(() => validatePrimaryYooKassaRefund({...payload(), metadata: {localRefundId: operationId + '\n', localPaymentId: payment.id}}, {...binding, operationId: operationId + '\n'}, now));
  const legacy = {payment, providerRefundId: binding.providerRefundId, amount: binding.amount};
  assert.equal(validatePrimaryYooKassaRefund({...payload(), metadata: undefined}, legacy, now).status, 'pending');
});

test('journal validates merchant and input before accessing SQL or provider', async () => {
  let sql = 0, network = 0;
  const database = {transaction: async () => { sql++; throw Error('Unexpected SQL'); }};
  const fetcher = async () => { network++; throw Error('Unexpected provider'); };
  for (const patch of [{shopId: ''}, {isTest: false}, {secretKey: ''}, {secretKey: undefined}]) assert.throws(() => new PostgresRefundJournalStore(database, {...merchant, ...patch}, fetcher));
  const store = new PostgresRefundJournalStore(database, merchant, fetcher);
  for (const invalid of [undefined, null, {}, [], 1, '', '../../refunds', operationId + '\n', 'a'.repeat(10000)]) {
    await assert.rejects(store.read(invalid), RefundJournalError);
    await assert.rejects(store.reconcile(invalid, binding.providerRefundId), RefundJournalError);
    if (invalid !== undefined) await assert.rejects(store.reconcile(operationId, invalid), RefundJournalError);
  }
  assert.equal(sql, 0); assert.equal(network, 0);
});

test('refund reader rejects a contradictory original capture before requesting the refund', async () => {
  const paymentCapturedAt = '2026-01-01T11:00:00.123456789Z'; let calls = 0;
  const reader = createPrimaryYooKassaRefundReader(merchant, async () => {
    calls++;
    return Response.json(calls === 1 ? paid('2026-01-01T11:00:00.123456790Z') : {...payload(), created_at: '2026-01-01T23:00:00.123456789Z'});
  });
  await assert.rejects(reader.read({...binding, paymentCapturedAt})); assert.equal(calls, 1);
});

test('stored capture accepts equivalent nanoseconds and survives missing GET capture; omitted expectation retains compatibility', async () => {
  for (const [paymentCapturedAt, capturedAt] of [['2026-01-01T11:00:00.123Z', '2026-01-01T11:00:00.123000000Z'], ['2026-01-01T11:00:00.123456789Z', undefined], [undefined, '2026-01-01T11:00:00.123456790Z']]) {
    let calls = 0; const reader = createPrimaryYooKassaRefundReader(merchant, async () => Response.json(++calls === 1 ? paid(capturedAt) : payload()));
    assert.equal((await reader.read({...binding, ...(paymentCapturedAt === undefined ? {} : {paymentCapturedAt})})).createdAt, payload().created_at); assert.equal(calls, 2);
  }
  const paymentCapturedAt = '2026-01-01T12:00:00.123456790Z'; let calls = 0;
  const reader = createPrimaryYooKassaRefundReader(merchant, async () => Response.json(++calls === 1 ? paid(undefined) : payload()));
  await assert.rejects(reader.read({...binding, paymentCapturedAt})); assert.equal(calls, 2);
  assert.throws(() => validatePrimaryYooKassaRefund(payload(), {...binding, paymentCapturedAt}, now));
});

test('invalid stored capture timestamps fail before fetch and honor exact future tolerance', async () => {
  let calls = 0; const reader = createPrimaryYooKassaRefundReader(merchant, async () => { calls++; return Response.json(paid(undefined)); });
  for (const paymentCapturedAt of [null, 1, '', 'private invalid capture', '2026-02-30T00:00:00Z', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00.1234567890Z', '2026-01-01T00:00:00Z\n', '2099-01-01T00:00:00Z']) await assert.rejects(reader.read({...binding, paymentCapturedAt}), error => !error.message.includes('private invalid capture'));
  assert.equal(calls, 0);
  const edge = {...binding, paymentCapturedAt: '2026-01-02T00:05:00.000000000Z'}, refund = {...payload(), created_at: edge.paymentCapturedAt};
  assert.equal(validatePrimaryYooKassaRefund(refund, edge, now).createdAt, edge.paymentCapturedAt);
  assert.throws(() => validatePrimaryYooKassaRefund(refund, {...edge, paymentCapturedAt: '2026-01-02T00:05:00.000000001Z'}, now));
});

test('pure refund validation preserves expected capture and rejects contradictory supplied capture', () => {
  const stored = {...binding, paymentCapturedAt: '2026-01-01T11:00:00.123456789Z'};
  assert.throws(() => validatePrimaryYooKassaRefund(payload(), stored, now, '2026-01-01T11:00:00.123456790Z'));
  const equivalent = {...binding, paymentCapturedAt: '2026-01-01T11:00:00.123Z'};
  assert.equal(validatePrimaryYooKassaRefund(payload(), equivalent, now, '2026-01-01T11:00:00.123000000Z').createdAt, payload().created_at);
});
