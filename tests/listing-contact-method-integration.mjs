import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {bootstrapPostgres, getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {grantListingContactMethod, getListingContactMethodGrantPlan} from '../scripts/grant-listing-contact-method.mjs';
import {buildPaymentWorker} from '../scripts/build-payment-worker.mjs';
import {formModule} from './listing-form-module.mjs';
import {PostgresListingDraftStore, ListingDraftAccessError, ListingDraftConflictError} from './listing-draft-module.mjs';
import {ListingDraftInputError} from '../src/lib/listing-draft-contract.ts';

export async function testListingContactMethod(suite, admin, config, credentials) {
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.database, 'blizhniy_test');
  const db = new PostgresDatabase(new pg.Pool({...config, user: credentials.user, password: credentials.password, max: 2}));
  const {PostgresListingFormStore} = formModule('postgres-listing-form');
  const legacy = new PostgresListingFormStore(db), forms = new PostgresListingFormStore(db, {contactMethod: true});
  const users = [randomUUID(), randomUUID()], tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const target = `${config.host}:${config.database}`, options = {includeListingContactMethod: true};
  const prior = (await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  const down = readFileSync(new URL('../database/migrations/0025-listing-contact-method.down.sql', import.meta.url), 'utf8');
  const artifacts = mkdtempSync(join(tmpdir(), 'blizhniy-contact-worker-'));
  let workerDb;
  try {
    for (let index = 0; index < users.length; index++) {
      const id = users[index];
      await admin.query('insert into app.users(id,email,password_hash,email_verified_at) values($1,$2,$3,clock_timestamp())',
        [id, `contact-${id}@example.invalid`, `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`]);
      await admin.query("insert into app.sessions(token_hash,user_id,scope,auth_version,expires_at) values($1,$2,'app',0,clock_timestamp()+interval '1 hour')", [hashSessionToken(tokens[index]), id]);
    }
    const draft = await new PostgresListingDraftStore(db).createEmpty(tokens[0], users[0], randomUUID());
    const original = await legacy.read(tokens[0], users[0], draft.id);
    await suite.test('contact preference capability is off by default and never queries a missing25 column in the old24 schema', async () => {
      assert.equal(prior.length, 24);
      assert.deepEqual(await legacy.read(tokens[0], users[0], draft.id), original);
      await assert.rejects(legacy.update(tokens[0], users[0], draft.id, original.revision, {...original.form, contactMethod: 'messenger'}), ListingDraftInputError);
      assert.deepEqual(await legacy.read(tokens[0], users[0], draft.id), original);
      await assert.rejects(forms.read(tokens[0], users[0], draft.id), {code: '42703'});
    });
    const artifact = join(artifacts, 'artifact'); buildPaymentWorker(artifact);
    const {verifyPaymentReconciliationDatabase} = await import(pathToFileURL(join(artifact, 'scripts/payment-reconciliation-role.mjs')).href);
    const password = randomUUID(); await admin.query(`alter role blizhniy_payment_reconciler login password '${password}'`);
    workerDb = new PostgresDatabase(new pg.Pool({...config, user: 'blizhniy_payment_reconciler', password, max: 2}));
    const verifyWorker = () => verifyPaymentReconciliationDatabase(workerDb, {database: config.database});
    await suite.test('new standalone worker artifact validates the old24 schema before the optional expansion', async () => {
      await verifyWorker();
      assert.match(readFileSync(join(artifact, 'database/migrations/0025-listing-contact-method.sql'), 'utf8'), /contact_method/);
    });
    await suite.test('explicit25 expansion preserves24 exact hashes, defaults existing rows to phone, grants nothing and can roll back before preference writes', async () => {
      const before = (await admin.query('select id,author_id,title,description,status,is_paid,revision from app.listings order by id')).rows;
      assert.equal((await bootstrapPostgres(admin, target, options)).applied, 1);
      assert.deepEqual((await admin.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows.slice(0, 24), prior);
      assert.deepEqual((await admin.query('select id,author_id,title,description,status,is_paid,revision from app.listings order by id')).rows, before);
      assert.equal((await admin.query("select count(*)::int as n from app.listings where contact_method<>'phone'")).rows[0].n, 0);
      await assert.rejects(forms.read(tokens[0], users[0], draft.id), {code: '42501'});
      await admin.query(down); await admin.query("delete from blizhniy_meta.migrations where name='0025-listing-contact-method.sql'");
      assert.equal((await bootstrapPostgres(admin, target, options)).applied, 1);
      assert.equal((await bootstrapPostgres(admin, target, options)).applied, 0);
      await assert.rejects(bootstrapPostgres(admin, target, {includePaymentReconciliationRole: true}), /journal differs/);
    });
    await suite.test('worker accepts only canonical24 or canonical25 hashes with unchanged exact financial authority', async () => {
      await verifyWorker();
      assert.equal((await workerDb.query("select has_column_privilege('app.listings','contact_method','SELECT,INSERT,UPDATE') as allowed")).rows[0].allowed, false);
      const expectedHash = getBootstrapPlan(options).at(-1).sha256;
      await admin.query("update blizhniy_meta.migrations set sha256=repeat('0',64) where name='0025-listing-contact-method.sql'");
      try {await assert.rejects(verifyWorker());}
      finally {await admin.query("update blizhniy_meta.migrations set sha256=$1 where name='0025-listing-contact-method.sql'", [expectedHash]);}
      await admin.query("insert into blizhniy_meta.migrations(name,sha256) values('0026-unapproved-fixture.sql',repeat('a',64))");
      try {await assert.rejects(verifyWorker());}
      finally {await admin.query("delete from blizhniy_meta.migrations where name='0026-unapproved-fixture.sql'");}
      await verifyWorker();
    });
    await suite.test('approved runtime grants add only SELECT and UPDATE contact_method, retaining ownership/payment/financial restrictions', async () => {
      const plan = getListingContactMethodGrantPlan();
      assert.deepEqual(plan.columns, ['contact_method']); assert.deepEqual(plan.privileges, ['SELECT', 'UPDATE']);
      assert.deepEqual(await grantListingContactMethod(admin, target), {columns: 1, privileges: 2});
      assert.deepEqual(await forms.read(tokens[0], users[0], draft.id), original);
      for (const sql of ["update app.listings set is_paid=true where false", 'update app.listings set author_id=author_id where false',
        'delete from app.listings where false', "insert into app.listings(author_id,listing_type,contact_method) values(null,'sell','phone')"])
        await assert.rejects(db.query(sql), {code: '42501'});
      await verifyWorker();
    });
    let saved;
    await suite.test('full owner form durably preserves messenger preference and both contacts with CAS and independent ownership authorization', async () => {
      const input = {...original.form, title: 'Контакты сохраняются', contactMethod: 'messenger', contactPhone: '+79990000000', messengerUrl: 'https://t.me/fixture_user'};
      saved = await forms.update(tokens[0], users[0], draft.id, original.revision, input);
      assert.deepEqual(saved.form, input); assert.equal(saved.revision, '2');
      assert.deepEqual(await forms.read(tokens[0], users[0], draft.id), saved);
      assert.equal((await admin.query('select contact_method from app.listings where id=$1', [draft.id])).rows[0].contact_method, 'messenger');
      await assert.rejects(forms.read(tokens[1], users[1], draft.id), ListingDraftAccessError);
      await assert.rejects(forms.update(tokens[1], users[0], draft.id, saved.revision, input), ListingDraftAccessError);
      await assert.rejects(forms.update(tokens[0], users[0], draft.id, original.revision, input), ListingDraftConflictError);
      assert.deepEqual(await forms.read(tokens[0], users[0], draft.id), saved);
    });
    await suite.test('legacy-mode edits preserve the stored preference; safe rollback refuses to discard a messenger choice', async () => {
      const oldShape = await legacy.read(tokens[0], users[0], draft.id);
      assert.equal(Object.hasOwn(oldShape.form, 'contactMethod'), false);
      await legacy.update(tokens[0], users[0], draft.id, oldShape.revision, {...oldShape.form, title: 'Старый клиент не меняет выбор'});
      assert.equal((await forms.read(tokens[0], users[0], draft.id)).form.contactMethod, 'messenger');
      try {await assert.rejects(admin.query(down), {code: '23514'});} finally {await admin.query('rollback');}
      assert.equal((await forms.read(tokens[0], users[0], draft.id)).form.contactMethod, 'messenger');
      const current = await forms.read(tokens[0], users[0], draft.id);
      const phone = await forms.update(tokens[0], users[0], draft.id, current.revision, {...current.form, contactMethod: 'phone'});
      assert.equal(Object.hasOwn(phone.form, 'contactMethod'), false);
      assert.equal((await admin.query('select contact_method from app.listings where id=$1', [draft.id])).rows[0].contact_method, 'phone');
    });
  } finally {
    await workerDb?.close(); await db.close();
    assert.ok(artifacts.startsWith(join(tmpdir(), 'blizhniy-contact-worker-'))); rmSync(artifacts, {recursive: true, force: true});
  }
}
