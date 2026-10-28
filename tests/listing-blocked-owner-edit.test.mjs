import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
import {ListingDraftAccessError, ListingDraftConflictError} from './listing-draft-module.mjs';

const {PostgresListingFormStore} = formModule('postgres-listing-form');
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const id = '10000000-0000-4000-8000-000000000003';
const token = 'a'.repeat(64);
const form = {kind: 'prodam', title: 'Исправленный комод', description: 'Подробное описание комода без запрещённой информации.', price: '3500.00',
  categorySlug: 'dlya-doma-i-dachi', subcategoryName: null, cityName: 'Сочи', district: null, address: null,
  latitude: null, longitude: null, showExactAddress: false, contactPhone: '+79990000000', messengerUrl: null, booking: null, photoIds: []};

// A block is a separate immutable row, not app.listings.status='blocked'.
// These fakes retain the real session guard and repository; fail on any
// attempted financial/visibility/block mutation rather than allowing it silently.
function fixture(actor = owner) {
  let stored = {...form, title: 'Старое описание', revision: '7', listingType: 'sell', status: 'published', id};
  const queries = [];
  const db = {transaction: work => work({query: async (sql, values = []) => {
    queries.push(sql);
    if (sql.startsWith('select u.id')) return {rows: [{id: actor, role: 'user', isBlocked: false, verified: true, authVersion: '1'}], rowCount: 1};
    if (sql.startsWith('select token_hash') || sql.startsWith('update app.sessions')) return {rows: [], rowCount: 1};
    if (sql.includes('from app.listings l')) {
      if (values[1] !== owner || !sql.includes("l.status in ('draft','published','archived')")) return {rows: [], rowCount: 0};
      if (sql.startsWith('select l.revision')) return {rows: [{revision: stored.revision, status: stored.status}], rowCount: 1};
      const {status, ...snapshot} = stored; void status;
      return {rows: [snapshot], rowCount: 1};
    }
    if (sql.startsWith('select c.id')) return {rows: [{id: other, active: true}], rowCount: 1};
    if (sql.startsWith('select id from app.cities')) return {rows: [{id: other}], rowCount: 1};
    if (sql.includes('from app.listing_photos')) return {rows: [], rowCount: 0};
    if (sql.startsWith('update app.listings')) {
      assert.doesNotMatch(sql, /\b(?:status|is_paid|published_at|expires_at)\s*=/);
      assert.equal(values[0], id); assert.equal(values[1], owner); assert.equal(values[16], stored.revision);
      stored = {...stored, ...form, revision: String(BigInt(stored.revision) + 1n)};
      return {rows: [], rowCount: 1};
    }
    if (sql === 'delete from app.listing_photos where listing_id=$1') return {rows: [], rowCount: 0};
    throw Error(`Unexpected blocked edit SQL: ${sql.split(' ').slice(0, 4).join(' ')}`);
  }})};
  return {queries, store: new PostgresListingFormStore(db, {postmoderation: true})};
}

test('editing blocked content preserves its underlying publication, block and payment ledgers', async () => {
  const fixtureValue = fixture();
  const saved = await fixtureValue.store.update(token, owner, id, '7', form);
  assert.equal(saved.revision, '8');
  assert.equal(saved.form.title, form.title);
  assert.doesNotMatch(fixtureValue.queries.join('\n'), /(?:insert into|update|delete from) app\.(?:listing_blocks|listing_block_mail|payment_\w+)/);
});

test('blocked content editing keeps ownership and revision CAS checks', async () => {
  const fixtureValue = fixture();
  await assert.rejects(fixtureValue.store.update(token, other, id, '7', form), ListingDraftAccessError);
  await assert.rejects(fixtureValue.store.update(token, owner, id, '6', form), ListingDraftConflictError);
  assert.equal(fixtureValue.queries.some(sql => sql.startsWith('update app.listings')), false);
});

test('another valid user cannot read or edit the blocked resource using their own identity', async () => {
  const fixtureValue = fixture(other);
  await assert.rejects(fixtureValue.store.read(token, other, id), ListingDraftAccessError);
  await assert.rejects(fixtureValue.store.update(token, other, id, '7', form), ListingDraftAccessError);
  assert.equal(fixtureValue.queries.some(sql => sql.startsWith('update app.listings')), false);
});
