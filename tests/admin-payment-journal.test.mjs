import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAdminPaymentJournalQuery, parseAdminPaymentJournalPage } from '../src/lib/admin-payment-journal-contract.ts';

const id = '10000000-0000-4000-8000-000000000002';
const owner = '10000000-0000-4000-8000-000000000001';
const createdAt = '2026-11-25T12:03:04.567891Z';
const query = { expectedAdminId: owner, kind: 'listing', status: 'created', after: null };
const item = {
 id, targetId: owner, targetType: 'listing', amount: '199.00', createdAt,
 orderStatus: 'created', providerStatus: 'unknown', capturedAt: null,
 reconciliation: 'blocked', reconciliationCode: 'attempts_exhausted',
 fulfillment: 'not_recorded', fulfilledAt: null, refund: 'unavailable', refundedAt: null, compensation: 'not_applicable',
};
test('admin payment journal accepts only known filters and a timestamp/UUID cursor', () => {
 assert.deepEqual(parseAdminPaymentJournalQuery(query), query);
 assert.deepEqual(parseAdminPaymentJournalQuery({ ...query, after: { id, createdAt } }), { ...query, after: { id, createdAt } });
 for (const input of [{ ...query, shop: 'untrusted' }, { ...query, status: 'paid' }, { ...query, kind: 'unknown' },
  { ...query, after: { id, createdAt: 'bad' } }, { ...query, expectedAdminId: 'bad' }]) assert.throws(() => parseAdminPaymentJournalQuery(input));
});
test('journal validates independent server facts, rejects private fields, other filters and inconsistent pages', () => {
 const page = { items: [item], nextAfter: null };
 assert.deepEqual(parseAdminPaymentJournalPage(query, page), page);
 for (const input of [{ ...item, contactEmail: 'synthetic@example.invalid' }, { ...item, amount: 199.3 }, { ...item, targetType: 'vacancy' },
  { ...item, orderStatus: 'succeeded' }, { ...item, fulfillment: 'fulfilled' }, { ...item, refund: 'applied' }, { ...item, reconciliationCode: null }]) {
  assert.throws(() => parseAdminPaymentJournalPage(query, { ...page, items: [input] }));
 }
 assert.throws(() => parseAdminPaymentJournalPage(query, { items: [item, item], nextAfter: null }));
 assert.throws(() => parseAdminPaymentJournalPage(query, { items: [item], nextAfter: { id, createdAt } }));
 assert.throws(() => parseAdminPaymentJournalPage({ ...query, after: { id, createdAt } }, page));
});

test('refund action hints are restricted to the appropriate order and verified refund stages',()=>{
 const filter={...query,status:'succeeded'};
 const paid={...item,orderStatus:'succeeded',providerStatus:'succeeded',capturedAt:createdAt,refund:'none'};
 const approve={...paid,refundAction:{kind:'approve'}};
 const recover={...paid,refund:'unknown',refundAction:{kind:'recover',operationId:id,providerRefundId:null}};
 const parse=(row,kind='listing')=>parseAdminPaymentJournalPage({...filter,kind},{items:[row],nextAfter:null}).items[0];
 assert.deepEqual(parse(approve),approve);
 assert.deepEqual(parse(recover),recover);
 assert.throws(()=>parse({...approve,targetType:'fair_application'},'fair_application'));
 assert.throws(()=>parse({...approve,refundAction:{kind:'approve',amount:'1.00'}}));
 assert.throws(()=>parse({...recover,refund:'canceled'}));
 assert.throws(()=>parse({...recover,refundAction:{kind:'recover',operationId:'invalid',providerRefundId:null}}));
});
