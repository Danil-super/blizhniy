const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const ownerId = '11111111-1111-4111-8111-111111111111';
const applicationId = '22222222-2222-4222-8222-222222222222';
const otherOwnerId = '33333333-3333-4333-8333-333333333333';

function loadFairStore(row, configured = true) {
  const requests = [];
  const stubs = {
    '@/lib/data': { fairApplications: [] },
    '@/lib/runtime-mode': { shouldShowFallbackContent: () => false },
    '@/lib/supabase-rest': {
      isSupabaseRestConfigured: () => configured,
      isUuid: (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      supabaseRest: async (requestPath) => {
        requests.push(requestPath);
        const query = new URL(requestPath, 'https://database.example.test').searchParams;
        const matches = row && [...query].every(([field, filter]) => {
          if (filter.startsWith('eq.')) return row[field] === filter.slice(3);
          if (filter.startsWith('neq.')) return row[field] != null && row[field] !== filter.slice(4);
          return true;
        });
        return matches ? [{ id: row.id, participant_name: row.participant_name }] : [];
      },
    },
  };
  const filename = path.join(__dirname, '../src/lib/fair-application-store.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return { lookup: module.exports.getStoredFairApplicationForPayment, requests };
}

function application(overrides = {}) {
  return { id: applicationId, user_id: ownerId, status: 'pending_payment', payment_status: 'pending', participant_name: 'Тестовый участник', ...overrides };
}

test('fair-payment lookup returns only the verified owner’s unpaid eligible application', async () => {
  const { lookup, requests } = loadFairStore(application());
  assert.deepEqual(await lookup(applicationId, ownerId), { id: applicationId, participantName: 'Тестовый участник' });
  const query = new URL(requests[0], 'https://database.example.test').searchParams;
  assert.equal(query.get('select'), 'id,participant_name');
  assert.equal(query.get('limit'), '1');
});

test('fair-payment lookup rejects another owner, terminal states and an already settled payment', async () => {
  for (const row of [
    application({ user_id: otherOwnerId }),
    ...['draft', 'pending_review', 'published', 'rejected', 'archived'].map((status) => application({ status })),
    application({ payment_status: 'succeeded' }),
    application({ id: otherOwnerId }),
  ]) {
    const { lookup } = loadFairStore(row);
    assert.equal(await lookup(applicationId, ownerId), undefined, JSON.stringify(row));
  }
});

test('invalid fair-payment identifiers and missing configuration never query the database', async () => {
  const { lookup, requests } = loadFairStore(application());
  for (const [id, userId] of [['invalid', ownerId], [applicationId, 'invalid'], [undefined, ownerId]]) {
    assert.equal(await lookup(id, userId), undefined);
  }
  assert.deepEqual(requests, []);
  const unconfigured = loadFairStore(application(), false);
  assert.equal(await unconfigured.lookup(applicationId, ownerId), undefined);
  assert.deepEqual(unconfigured.requests, []);
});
