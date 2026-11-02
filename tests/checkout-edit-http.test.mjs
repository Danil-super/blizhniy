import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const load = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const origin = 'https://checkout-edit.example.invalid';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const form = {kind: 'prodam', title: 'Синтетическое объявление'};
const workForm = {kind: 'workRequest', title: 'Синтетический заказ'};
const cases = [
  ['core', 'production-listing-draft-http', 'createProductionListingDraftHandler', 'update', {expectedOwnerId: owner, listingId: id, expectedRevision: '1', draft: form}],
  ['form', 'production-listing-form-http', 'createProductionListingFormHandler', 'update', {expectedOwnerId: owner, listingId: id, expectedRevision: '1', form}],
  ['photos', 'production-listing-photo-http', 'createProductionListingPhotoHandler', 'replace', {expectedOwnerId: owner, listingId: id, expectedRevision: '1', photoIds: []}],
  ['work', 'production-work-publication-http', 'createProductionWorkPublicationHandler', 'update', {action: 'update', kind: 'workRequest', expectedOwnerId: owner, publicationId: id, expectedRevision: '1', form: workForm}],
];

for (const [label, module, factory, method, body] of cases) {
  test(`${label} mutation reports unresolved checkout as private 409 and hides unrelated SQL errors`, async () => {
    for (const code of ['PBL01', 'PBL02', '23514']) {
      let writes = 0;
      const events = [];
      const handle = load(module)[factory]({origin}, () => ({limiter: {allowProduction: async () => true}, store: {
        [method]: async () => {writes++; throw Object.assign(new Error('private-sql-payment-owner'), {code});},
      }}), event => events.push(event));
      const response = await handle(new Request(origin + '/api/account/test', {method: 'PUT', headers: {
        host: new URL(origin).host, origin, 'x-blizhniy-request': '1', 'x-real-ip': '192.0.2.3',
        'content-type': 'application/json', cookie: '__Host-blizhniy_session=' + 'a'.repeat(64),
      }, body: JSON.stringify(body)}));
      assert.equal(writes, 1);
      assert.equal(response.status, code === 'PBL01' ? 409 : 503);
      const reply = await response.json();
      if (code === 'PBL01') assert.deepEqual(reply, {error: {code: 'CHECKOUT_ACTIVE'}});
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(JSON.stringify([reply, events]).includes('private-sql-payment-owner'), false);
    }
  });
}

test('owner clients preserve the checkout conflict and useful message without repeating the write', async () => {
  const savedFetch = globalThis.fetch;
  let calls = 0;
  const transport = async () => {calls++; return Response.json({error: {code: 'CHECKOUT_ACTIVE'}}, {status: 409});};
  globalThis.fetch = transport;
  try {
    const actions = [
      () => load('client-listing-form').productionListingForm.write(owner, id, '1', form),
      () => load('client-listing-drafts').productionDrafts.write(owner, id, '1', form),
      () => load('client-listing-media').createListingMediaClient(transport).replace(owner, id, '1', []),
      () => load('client-work-publications').createWorkPublicationClient(transport).update(owner, 'workRequest', id, '1', workForm),
    ];
    for (const action of actions) {
      const before = calls;
      await assert.rejects(action, error => error.code === 'CHECKOUT_ACTIVE' && /оплат/iu.test(error.message));
      assert.equal(calls, before + 1, 'Conflict must never cause a transparent mutation retry');
    }
  } finally {globalThis.fetch = savedFetch;}
});
