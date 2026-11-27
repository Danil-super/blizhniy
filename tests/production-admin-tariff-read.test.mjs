import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const load = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const { readAdminTariffs } = load('postgres-admin-tariff-read');
const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const command = { resource: 'tariffs', action: 'list', expectedAdminId: actor };
const token = 'a'.repeat(64);
const stored = { id: 'listing-publication', action: 'listing_publication', name: 'Размещение',
  price: '9999999999.99', duration_days: 30, active: false };

function database({ role = 'admin', currentSession = true } = {}) {
  let tariffReads = 0;
  const query = async (sql) => {
    if (sql.includes('from app.users')) {
      return { rows: [{ id: actor, role, isBlocked: false, verified: true, authVersion: '1' }] };
    }
    if (sql.includes('app.sessions')) return { rowCount: currentSession ? 1 : 0 };
    assert.match(sql, /^select .* from app.tariffs /);
    tariffReads++;
    return { rows: [stored] };
  };
  return { transaction: work => work({ query }), tariffReads: () => tariffReads };
}

test('the hosted list uses the confirmed administrator and preserves tariff fields', async () => {
  const db = database();
  const result = await readAdminTariffs(db, token, command);
  const expected = { id: stored.id, action: stored.action, name: stored.name, price: stored.price,
    durationDays: 30, active: false, revision: result.tariffs[0].revision };
  assert.match(expected.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, { tariffs: [expected], receipt: null, history: [] });
  assert.deepEqual(await readAdminTariffs(db, token, command), result);
  assert.equal(db.tariffReads(), 2);
});

test('wrong identity, ordinary account and revoked session cannot read the hosted list', async () => {
  for (const [db, id] of [[database(), other], [database({ role: 'user' }), actor],
    [database({ currentSession: false }), actor]]) {
    await assert.rejects(readAdminTariffs(db, token, { ...command, expectedAdminId: id }), { code: 'ADMIN_REQUIRED' });
    assert.equal(db.tariffReads(), 0);
  }
});

test('the hosted endpoint rejects commands for changing tariffs or recovering a write', async () => {
  const db = database();
  const target = { resource: 'tariffs', expectedAdminId: actor, tariffId: stored.id, id: other };
  const input = { id: other, tariffId: stored.id, expectedRevision: 'a'.repeat(64), name: stored.name,
    price: '100.00', durationDays: 30, active: true, reason: 'Изменение цены' };
  for (const command of [{ ...target, action: 'recover' }, { resource: 'tariffs', expectedAdminId: actor, action: 'change', input }]) {
    await assert.rejects(readAdminTariffs(db, token, command), { code: 'READ_ONLY' });
  }
  assert.equal(db.tariffReads(), 0);
});
