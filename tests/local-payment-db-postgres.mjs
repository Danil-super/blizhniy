import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { before, after } from 'node:test';
import { createLocalPaymentDb, getReferenceData } from '../scripts/local-payment-db.mjs';

// Opt-in Docker test: never operates on the persistent developer DB.
const db = createLocalPaymentDb(`test-${randomBytes(6).toString('hex')}`);
before(async () => { await db.start(); });
after(async () => {
  const metadata = await db.inspect();
  if (metadata) {
    // inspect has already checked this run's name/labels/image/offline network.
    await db.docker(['rm', '--force', '--volumes', metadata.Id]);
  }
});

test('fresh local database has only current reference data and no account/payment history', async () => {
  const counts = JSON.parse(await db.sql(`select json_build_object(
    'users',(select count(*) from auth.users), 'profiles',(select count(*) from public.profiles),
    'payments',(select count(*) from public.payments), 'intents',(select count(*) from private.payment_checkout_intents),
    'listings',(select count(*) from public.listings), 'vacancies',(select count(*) from public.vacancies),
    'work',(select count(*) from public.work_requests), 'specialists',(select count(*) from public.specialist_profiles),
    'fair',(select count(*) from public.fair_applications), 'responses',(select count(*) from public.applications),
    'notifications',(select count(*) from public.notifications));`));
  assert.ok(Object.values(counts).every(count => count === 0), JSON.stringify(counts));
  const expected = getReferenceData();
  const actual = JSON.parse(await db.sql(`select json_build_object(
    'roots',(select count(*) from public.categories where parent_id is null),
    'children',(select count(*) from public.categories where parent_id is not null),
    'cities',(select count(*) from public.cities), 'professions',(select count(*) from public.specialist_categories),
    'tariffs',(select count(*) from public.tariffs));`));
  assert.deepEqual(actual, { roots: 18, children: expected.categories.reduce((n, row) => n + row.children.length, 0),
    cities: 26, professions: 14, tariffs: 7 });
  const tariffs = JSON.parse(await db.sql(`select json_agg(t order by action) from
    (select action::text,name,price,duration_days,active from public.tariffs) t;`));
  assert.deepEqual(tariffs, expected.tariffs.map(row => ({ action: row.action, name: row.name, price: row.price,
    duration_days: row.durationDays, active: row.active })).sort((a,b) => a.action.localeCompare(b.action)));
  const catalog = JSON.parse(await db.sql(`select json_agg(t order by sort_order) from (
    select root.slug,root.name,root.sort_order,coalesce((select json_agg(child.name order by child.sort_order)
      from public.categories child where child.parent_id=root.id),'[]') children
    from public.categories root where root.parent_id is null) t;`));
  assert.deepEqual(catalog.map(row => ({ slug: row.slug, name: row.name, children: row.children })), expected.categories);
});

test('actual local grants block public private contacts, payment writes and payment RPCs', async () => {
  assert.equal(await db.sql('set role anon; select count(*) from public.categories;'),
    String(getReferenceData().categories.reduce((n, row) => n + 1 + row.children.length, 0)));
  for (const role of ['anon', 'authenticated']) {
    for (const statement of [
      'select contact_phone from public.listings;', 'select contact_phone from public.vacancies;',
      'select contact_phone from public.work_requests;', 'select request_body from private.payment_checkout_intents;',
      "update public.payments set status='succeeded';", 'select public.reconcile_ad_marquee_queue();',
    ]) await assert.rejects(db.sql(`set role ${role}; ${statement}`), /permission denied/);
  }
  assert.equal(await db.sql('set role service_role; select count(*) from public.reconcile_ad_marquee_queue();'), '0');
});

test('real checkout intent and fulfillment are idempotent on the clean local schema', async () => {
  const result = JSON.parse(await db.sql(`begin;
    insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','local-test@example.invalid');
    set role service_role;
    insert into public.listings(id,author_id,listing_type,category_id,region_id,city_id,title,description,status)
      select '00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','sell',
        c.id,city.region_id,city.id,'Synthetic local test','No provider request','pending_payment'
      from public.categories c cross join public.cities city where c.slug='raznoe' and city.slug='krasnodar';
    insert into public.payments(id,user_id,tariff_id,target_type,target_id,provider,amount,status,purchased_duration_days)
      select '00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001',id,
        'listing','00000000-0000-4000-8000-000000000010','yookassa',price,'created',duration_days
      from public.tariffs where action='listing_publication';
    select decision as prepared from public.prepare_yookassa_checkout_intent(
      '00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','listing',
      '00000000-0000-4000-8000-000000000010','listing-publication',199,30,'999999',true,
      '{"amount":{"value":"199.00","currency":"RUB"},"capture":true,"confirmation":{"type":"redirect","return_url":"https://synthetic.example.invalid/oplata"},"description":"Synthetic local test","metadata":{"localPaymentId":"00000000-0000-4000-8000-000000000100","targetType":"listing","targetId":"00000000-0000-4000-8000-000000000010","tariffId":"listing-publication"}}') \\gset
    update public.payments set provider_payment_id='synthetic-local-only',status='succeeded',paid_at=clock_timestamp()
      where id='00000000-0000-4000-8000-000000000100';
    select applied_now as first_apply from public.apply_payment_fulfillment(
      '00000000-0000-4000-8000-000000000100','synthetic-local-only') \\gset
    select applied_now as replay from public.apply_payment_fulfillment(
      '00000000-0000-4000-8000-000000000100','synthetic-local-only') \\gset
    select json_build_object('prepared',:'prepared','first',:'first_apply','replay',:'replay',
      'status',status,'duration',extract(epoch from (expires_at-published_at))/86400)
      from public.listings where id='00000000-0000-4000-8000-000000000010';
    rollback;`));
  assert.deepEqual(result, { prepared: 'post', first: 't', replay: 'f', status: 'published', duration: 30 });
  assert.equal(await db.sql('select count(*) from auth.users;'), '0');
  assert.equal(await db.sql('select count(*) from public.payments;'), '0');
});

test('stop/start preserves local data; repeated start never reseeds or resets it', async () => {
  await db.sql('create table local_dev.persistence_probe(value integer); insert into local_dev.persistence_probe values(42);');
  await db.stop();
  assert.equal((await db.status()).running, false);
  await db.start();
  assert.equal(await db.sql('select value from local_dev.persistence_probe;'), '42');
  await db.sql("update public.tariffs set price=321 where action='ad_marquee';");
  await db.start();
  assert.equal(await db.sql("select price::integer from public.tariffs where action='ad_marquee';"), '321');
});

test('changed or incomplete bootstrap fails closed without deleting local data', async () => {
  const original = await db.sql('select fingerprint from local_dev.bootstrap;');
  assert.match(original, /^[a-f0-9]{64}$/);
  await db.sql("update local_dev.bootstrap set fingerprint='changed-for-negative-control';");
  assert.equal((await db.status()).ready, false);
  await assert.rejects(db.start(), /Data preserved; no automatic reset/);
  assert.equal(await db.sql('select value from local_dev.persistence_probe;'), '42');
  await db.sql(`update local_dev.bootstrap set fingerprint='${original}';`);
});
