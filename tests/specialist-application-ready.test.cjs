const assert = require('node:assert/strict');
const test = require('node:test');
const { loadLocalPrimaryModule: load } = require('../scripts/local-primary-modules.cjs');
const { PostgresApplicationStore } = load('postgres-applications');
const { parseWorkPublicationForm } = load('work-publication-contract');

const owner = '11111111-1111-4111-8111-111111111111';
const employer = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const specialistId = '44444444-4444-4444-8444-444444444444';
const applicationId = '55555555-5555-4555-8555-555555555555';
const creationKey = '66666666-6666-4666-8666-666666666666';
const cityId = '77777777-7777-4777-8777-777777777777';
const professionId = '88888888-8888-4888-8888-888888888888';
const token = 'a'.repeat(64);
const about = 'Устанавливаю и ремонтирую сантехнику, аккуратно работаю и соблюдаю сроки.';

function fixture(changes = {}, policy = { specialistApplicationReady: true }) {
  const state = {
    verified: true, blocked: false, profileName: 'Анна-Мария',
    specialistOwner: owner, specialistKind: 'specialist', deleted: false,
    cityExists: true, professionActive: true, targetLive: true,
    form: {
      kind: 'specialist', title: 'Прежнее имя из старой анкеты', description: about,
      cityName: 'Краснодар', professionName: 'Сантехник', price: '1500.00',
      contactPhone: '+79990000000', placementRightConfirmed: true,
      skills: null, experience: null,
    },
    ...changes,
  };
  const calls = [];
  let inserted;
  const one = row => ({ rows: [row], rowCount: 1 });
  const none = () => ({ rows: [], rowCount: 0 });
  const publicTarget = {
    id: targetId, kind: 'workRequest', form: parseWorkPublicationForm('workRequest', {
      title: 'Починить раковину', description: 'Нужно заменить слив и устранить протечку на кухне.',
      cityName: 'Краснодар', professionName: 'Сантехник', budget: '2500',
      contactPhone: '+79991112233', placementRightConfirmed: true,
    }), mediaIds: [], status: 'published', paid: true,
    createdAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-02T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const db = { transaction: work => work({ query: async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql === "select pg_catalog.to_regnamespace('app_publication_restriction') is not null as installed, pg_catalog.current_setting('transaction_isolation') as isolation") return one({ installed: false, isolation: 'read committed' });
    if (sql.startsWith('select u.id')) return one({ id: owner, role: 'user', verified: state.verified, isBlocked: state.blocked, authVersion: '0' });
    if (sql.startsWith('select token_hash') || sql.startsWith('update app.sessions')) return one({});
    if (sql.includes('from app.cabinet_profiles')) return state.profileName === null ? none() : one({ name: state.profileName, profile: { name: state.profileName } });
    if (sql.startsWith('select id from app.users')) return one({ id: employer });
    if (sql.startsWith('select author_id as author')) return one({ author: employer, revision: '1' });
    if (sql.includes('from app.work_publications w') && sql.includes('w.form')) return state.targetLive ? one(publicTarget) : none();
    if (sql.includes('from app.service_publications') && !sql.includes('app.service_moderation')) {
      if (state.deleted || state.specialistOwner !== owner || state.specialistKind !== 'specialist') return none();
      if (/join app.cities|join app.specialist_categories/.test(sql) && (!state.cityExists || !state.professionActive)) return none();
      return one({ id: specialistId, revision: '3', form: state.form, author: owner, authorId: owner,
        kind: 'specialist', status: 'draft', paid: false, cityId, professionId });
    }
    // No payment, publication period or approved moderation exists for this profile.
    if (sql.includes('from app.service_publications')) return none();
    if (sql.includes('from app.cities')) return state.cityExists ? one({ id: cityId, name: 'Краснодар' }) : none();
    if (sql.includes('from app.specialist_categories')) return state.professionActive ? one({ id: professionId, name: 'Сантехник', active: true }) : none();
    if (sql.startsWith('select w.id from app.work_publications')) {
      return state.targetLive && !/s\.is_paid|s\.status='published'|s\.expires_at/.test(sql) ? one({ id: targetId }) : none();
    }
    if (sql.startsWith('select id from app.applications')) return none();
    if (sql.startsWith('insert into app.applications')) {
      inserted = { id: applicationId, applicant: owner, targetOwner: employer, targetId,
        kind: 'workRequest', targetTitle: 'Починить раковину', creationKey,
        targetRevision: '1', specialistId, specialistRevision: '3', revision: '1',
        snapshot: JSON.parse(values[6]), message: values[7], status: 'pending_payment', paid: false,
        sentAt: null, createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z' };
      return one({ id: applicationId });
    }
    if (sql.includes('from app.applications a')) return inserted ? one(inserted) : none();
    throw new Error(`Unexpected readiness SQL: ${sql}`);
  } }) };
  return { state, calls, store: new PostgresApplicationStore(db, policy), get inserted() { return inserted; } };
}
const createInput = (change = {}) => ({ kind: 'workRequest', targetId, specialistId, creationKey,
  expectedTargetRevision: '1', expectedSpecialistRevision: '3', message: 'Готова помочь с ремонтом.', ...change });

test('complete saved specialist is immediately eligible without public catalogue approval or payment', async () => {
  const f = fixture();
  const preview = await f.store.preview(token, owner, 'workRequest', targetId);
  assert.equal(preview.specialist.id, specialistId);
  assert.equal(preview.specialist.snapshot.name, 'Анна-Мария');
  assert.equal(preview.specialist.snapshot.skills, about);
  assert.equal(preview.specialist.snapshot.price, '1500.00');
  assert.equal(preview.existing, null);
  assert.equal(f.calls.some(({ sql }) => sql.includes('service_moderation')), false);
});

test('eligible draft creates only an unpaid application snapshot, not a published profile or delivered response', async () => {
  const f = fixture();
  const result = await f.store.create(token, owner, createInput());
  assert.equal(result.status, 'pending_payment');
  assert.equal(result.paid, false);
  assert.equal(result.sentAt, null);
  assert.equal(result.snapshot.name, 'Анна-Мария');
  assert.equal(result.snapshot.skills, about);
  assert.deepEqual(f.calls.filter(({ sql }) => /^(?:insert|update|delete)/.test(sql)).map(({ sql }) => sql.split(/[\s(]+/).slice(0, 3).join(' ')), ['insert into app.applications', 'update app.sessions set']);
});

test('default store retains published paid specialist requirement; request data cannot opt in', async () => {
  const f = fixture({}, {});
  await assert.rejects(f.store.preview(token, owner, 'workRequest', targetId), { name: 'ApplicationEligibilityError' });
  const forged = fixture();
  assert.throws(() => forged.store.create(token, owner, createInput({ specialistApplicationReady: true })), { name: 'ApplicationInputError' });
  assert.equal(forged.inserted, undefined);
});

for (const [name, formChange] of [
  ['short about', { description: 'Ремонт' }],
  ['missing price', { price: null }],
  ['price below minimum', { price: '99.99' }],
  ['missing consent', { placementRightConfirmed: false }],
  ['no contact', { contactPhone: null, email: null, messengerUrl: null }],
  ['invalid phone', { contactPhone: 'not-a-phone' }],
]) {
  test(`application-ready specialist refuses ${name} before application creation`, async () => {
    const f = fixture(); f.state.form = { ...f.state.form, ...formChange };
    await assert.rejects(f.store.create(token, owner, createInput()), { name: 'ApplicationEligibilityError' });
    assert.equal(f.inserted, undefined);
  });
}

for (const [name, change] of [
  ['deleted profile', { deleted: true }], ['foreign profile', { specialistOwner: employer }],
  ['non-specialist service', { specialistKind: 'fair' }], ['missing city', { cityExists: false }],
  ['inactive profession', { professionActive: false }], ['missing cabinet profile', { profileName: null }],
]) {
  test(`application readiness rejects ${name}`, async () => {
    const f = fixture(change);
    await assert.rejects(f.store.preview(token, owner, 'workRequest', targetId), { name: 'ApplicationEligibilityError' });
    assert.equal(f.inserted, undefined);
  });
}

test('ready specialist still requires verified unblocked current session and exact expected owner', async () => {
  for (const change of [{ blocked: true }, { verified: false }]) {
    const f = fixture(change);
    await assert.rejects(f.store.preview(token, owner, 'workRequest', targetId), { name: 'AppSessionAccessError' });
  }
  await assert.rejects(fixture().store.preview(token, employer, 'workRequest', targetId), { name: 'AppSessionAccessError' });
});

test('specialist readiness does not bypass target publication/payment eligibility or revision CAS', async () => {
  await assert.rejects(fixture({ targetLive: false }).store.preview(token, owner, 'workRequest', targetId), { name: 'ApplicationAccessError' });
  const f = fixture();
  await assert.rejects(f.store.create(token, owner, createInput({ expectedSpecialistRevision: '2' })), { name: 'ApplicationConflictError' });
  assert.equal(f.inserted, undefined);
});
