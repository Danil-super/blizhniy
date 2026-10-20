import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseListingFormDraft} from '../src/lib/listing-form-contract.ts';
import {parseListingFormSnapshot} from '../src/lib/client-listing-form.ts';
import {getBootstrapPlan} from '../scripts/postgres-migration-plan.mjs';
import {grantListingContactMethod, getListingContactMethodGrantPlan} from '../scripts/grant-listing-contact-method.mjs';

test('listing contact preference preserves the old canonical phone shape and explicitly retains messenger choice', () => {
  const old = parseListingFormDraft({kind: 'prodam', contactPhone: '+79990000000', messengerUrl: '@fixture_user'});
  assert.deepEqual(parseListingFormDraft({...old, contactMethod: 'phone'}), old);
  const messenger = parseListingFormDraft({...old, contactMethod: 'messenger'});
  assert.equal(messenger.contactMethod, 'messenger');
  assert.equal(messenger.contactPhone, old.contactPhone);
  assert.equal(messenger.messengerUrl, old.messengerUrl);
  for (const contactMethod of ['', 'sms', 'email', 'PHONE', null, 1, {}, []]) {
    assert.throws(() => parseListingFormDraft({...old, contactMethod}));
  }
});
test('private form transport accepts exactly the canonical additional preference field, without replacing required fields', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const old = parseListingFormDraft({kind: 'prodam'});
  assert.deepEqual(parseListingFormSnapshot({id, revision: '1', form: old, photos: []}, id).form, old);
  const form = {...old, contactMethod: 'messenger'};
  assert.deepEqual(parseListingFormSnapshot({id, revision: '2', form, photos: []}, id).form, form);
  const missing = {...form}; delete missing.contactPhone;
  assert.throws(() => parseListingFormSnapshot({id, revision: '2', form: missing, photos: []}, id));
  assert.throws(() => parseListingFormSnapshot({id, revision: '2', form: {...form, paid: true}, photos: []}, id));
});
test('contact preference migration is separately opt-in25, preserves all24 source hashes and has a non-destructive default', () => {
  const previous = getBootstrapPlan({includePaymentReconciliationRole: true});
  const next = getBootstrapPlan({includeListingContactMethod: true});
  assert.equal(previous.length, 24); assert.equal(getBootstrapPlan().length, 7);
  assert.equal(next.length, 25); assert.deepEqual(next.slice(0, 24), previous);
  assert.equal(next.at(-1).name, '0025-listing-contact-method.sql');
  const source = readFileSync(new URL('../database/migrations/0025-listing-contact-method.sql', import.meta.url), 'utf8');
  assert.equal(next.at(-1).sha256, createHash('sha256').update(source).digest('hex'));
  assert.match(source, /contact_method text not null default 'phone'/i);
  assert.match(source, /check\s*\(contact_method in \('phone','messenger'\)\)/i);
  assert.doesNotMatch(source, /\bgrant\b|delete from|truncate|update app|drop table/i);
  assert.throws(() => getBootstrapPlan({includeListingContactMethod: 'true'}));
});
test('contact preference operator has an exact ordinary column plan and refuses unconfirmed targets before SQL', async () => {
  const plan = getListingContactMethodGrantPlan();
  assert.equal(plan.migrations.length, 25); assert.equal(plan.role, 'blizhniy_runtime');
  assert.deepEqual(plan.columns, ['contact_method']); assert.deepEqual(plan.privileges, ['SELECT', 'UPDATE']);
  assert.match(plan.sql, /grant select\(contact_method\),update\(contact_method\) on app\.listings to blizhniy_runtime;/);
  assert.doesNotMatch(plan.sql, /with grant option|blizhniy_payment_reconciler|payment_orders|is_paid/);
  let calls = 0;
  const client = {connectionParameters: {host: '127.0.0.1', database: 'blizhniy_test'}, query: async () => {calls++; assert.fail('No SQL for invalid confirmation');}};
  for (const target of [undefined, '127.0.0.1:other', 'other:blizhniy_test', {}, '127.0.0.1:blizhniy_test\n']) {
    await assert.rejects(grantListingContactMethod(client, target));
  }
  assert.equal(calls, 0);
});
test('primary full-form runtime enables the25 store only through its explicit capability flag', async () => {
  const ts = createRequire(import.meta.url)('typescript');
  const source = readFileSync(new URL('../src/lib/production-listing-form-runtime.ts', import.meta.url), 'utf8');
  for (const flag of [undefined, '', 'enabled', 'disabled', 'true']) {
    const exports = {}; let options;
    const dependencies = {
      './auth-http': {authJson: (body, status) => Response.json(body, {status})},
      './production-auth-config': {readProductionAuthConfig: () => ({origin: 'https://site.example.invalid'})},
      './production-auth-runtime': {getProductionAccountDatabase: async () => ({db: {query: async () => ({rows: []})}, limiter: {}})},
      './postgres-listing-form': {PostgresListingFormStore: class {constructor(_db, value) {options = value;}}},
      './production-listing-form-http': {createProductionListingFormHandler: (_config, runtime) => async () => {await runtime(); return Response.json({});}},
    };
    new Function('require', 'exports', 'process', ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText)(
      name => {assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name];}, exports, {env: {BLIZHNIY_LISTING_CONTACT_METHOD: flag}});
    assert.equal((await exports.handleProductionListingFormRequest(new Request('https://site.example.invalid/api/account/listing-form'))).status, 200);
    assert.deepEqual(options, {contactMethod: flag === 'enabled'});
  }
});
