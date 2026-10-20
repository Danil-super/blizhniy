import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {hashSessionToken} from '../src/lib/identity.ts';
import {loadAdminModule} from './admin-module.mjs';
import * as contract from '../src/lib/admin-overview-contract.ts';
import * as draftIdentity from '../src/lib/listing-draft-contract.ts';

const ts = createRequire(import.meta.url)('typescript');
function overviewStore() {
  const exports = {};
  const dependencies = {
    './app-session-transaction': loadAdminModule('app-session-transaction'),
    './admin-authorization': loadAdminModule('admin-authorization'),
    './admin-overview-contract.ts': contract,
    './listing-draft-contract.ts': draftIdentity,
  };
  const source = readFileSync(new URL('../src/lib/postgres-admin-overview.ts', import.meta.url), 'utf8');
  new Function('require', 'exports', ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText)(path => {
    if (!Object.hasOwn(dependencies, path)) throw Error(`Unapproved overview integration dependency: ${path}`);
    return dependencies[path];
  }, exports);
  return exports.PostgresAdminOverviewStore;
}

export async function testAdminOverview(suite, admin, config, credentials) {
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.database, 'blizhniy_test');
  const db = new PostgresDatabase(new pg.Pool({...config, user: credentials.user, password: credentials.password, max: 2}));
  const Store = overviewStore();
  const store = new Store(db);
  const reviewer = randomUUID(), owner = randomUUID(), blocked = randomUUID(), unverified = randomUUID();
  const passwordHash = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;
  async function user(id, role = 'user', isBlocked = false, verified = true) {
    await admin.query(`insert into app.users(id,email,password_hash,role,is_blocked,email_verified_at)
      values($1,$2,$3,$4,$5,case when $6 then clock_timestamp() else null end)`,
    [id, `overview-${id}@example.invalid`, passwordHash, role, isBlocked, verified]);
  }
  async function session(id = reviewer, scope = 'app') {
    const token = randomBytes(32).toString('hex');
    await admin.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
      select $1,id,auth_version,$3,clock_timestamp()+interval '1 hour' from app.users where id=$2`,
    [hashSessionToken(token), id, scope]);
    return token;
  }
  async function authority() {
    return (await admin.query(`select n.nspname,c.relname,c.relacl::text,
      coalesce(jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) order by a.attnum)
        filter(where a.attnum>0 and not a.attisdropped),'[]'::jsonb) as columns
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      left join pg_attribute a on a.attrelid=c.oid
      where n.nspname='app' and c.relkind in ('r','v','p')
      group by n.nspname,c.relname,c.relacl::text order by n.nspname,c.relname`)).rows;
  }
  async function listing(author, {stale = false, approved = false, archived = false} = {}) {
    const id = randomUUID();
    await admin.query(`insert into app.listings(id,author_id,listing_type,title,revision)
      values($1,$2,'sell','Синтетическое объявление обзора',$3)`, [id, author, stale ? 2 : 1]);
    await admin.query(`insert into app.listing_moderation(listing_id,revision,state,decided_at)
      values($1,1,$2,case when $3 then clock_timestamp() else null end)`, [id, approved ? 'approved' : 'pending', approved]);
    if (archived) await admin.query("update app.listings set status='archived' where id=$1", [id]);
  }
  async function publication(family, kind, author, {stale = false, approved = false, deleted = false} = {}) {
    assert.ok(['work', 'service'].includes(family));
    const id = randomUUID();
    await admin.query(`insert into app.${family}_publications(id,author_id,kind,creation_key,form,revision,deleted_at)
      values($1,$2,$3,$4,$5::jsonb,$6,case when $7 then clock_timestamp() else null end)`,
    [id, author, kind, randomUUID(), JSON.stringify({kind, title: 'Синтетическая публикация обзора'}), stale ? 2 : 1, deleted]);
    await admin.query(`insert into app.${family}_moderation(publication_id,revision,state,decided_at)
      values($1,1,$2,case when $3 then clock_timestamp() else null end)`, [id, approved ? 'approved' : 'pending', approved]);
  }
  try {
    const originalAuthority = await authority();
    await user(reviewer, 'admin');
    const token = await session();
    let baseline;
    await suite.test('primary overview executes through the actual existing restricted runtime role, without extra grants', async () => {
      const principal = (await db.query('select current_user as name')).rows[0];
      assert.equal(principal.name, credentials.user);
      assert.notEqual(principal.name, config.user);
      baseline = await store.read(token, reviewer);
      assert.deepEqual(Object.keys(baseline).sort(), ['adMarquee', 'publications', 'tariffs', 'users']);
      for (const value of Object.values(baseline)) {
        for (const count of Object.values(value)) assert.ok(Number.isSafeInteger(count) && count >= 0);
      }
      assert.deepEqual(await authority(), originalAuthority);
    });
    await user(owner); await user(blocked, 'user', true); await user(unverified, 'user', false, false);
    await listing(owner); await listing(owner, {stale: true}); await listing(owner, {approved: true});
    await listing(blocked); await listing(unverified); await listing(reviewer);
    await listing(owner, {archived: true});
    for (const [family, kind] of [['work', 'vacancy'], ['service', 'fair'], ['service', 'marquee']]) {
      await publication(family, kind, owner);
      await publication(family, kind, owner, {stale: true});
      await publication(family, kind, owner, {approved: true});
      await publication(family, kind, owner, {deleted: true});
      await publication(family, kind, blocked);
      await publication(family, kind, unverified);
      await publication(family, kind, reviewer);
    }
    await publication('service', 'specialist', owner);
    await suite.test('overview inventory and actionable queues distinguish current reviews, deleted forms and inactive owners', async () => {
      const actual = await store.read(token, reviewer);
      assert.deepEqual(actual, {
        users: {total: baseline.users.total + 3, blocked: baseline.users.blocked + 1},
        publications: {total: baseline.publications.total + 20, awaitingReview: baseline.publications.awaitingReview + 5},
        tariffs: baseline.tariffs,
        adMarquee: {total: baseline.adMarquee.total + 6, awaitingReview: baseline.adMarquee.awaitingReview + 1},
      });
      const reference = (await admin.query(`select count(*)::int as total,count(*) filter(where active)::int as active from app.tariffs`)).rows[0];
      assert.deepEqual(actual.tariffs, reference);
      assert.deepEqual(await authority(), originalAuthority);
    });
    await suite.test('overview denies normal users, mismatched expected administrators and fabricated or non-app sessions', async () => {
      await assert.rejects(store.read(await session(owner), owner));
      await assert.rejects(store.read(token, owner));
      await assert.rejects(store.read(randomBytes(32).toString('hex'), reviewer));
      await assert.rejects(store.read(await session(reviewer, 'data-subject'), reviewer));
    });
    await suite.test('overview rechecks expired, idle, revoked and stale-version sessions against actual database state', async () => {
      for (const state of ['expired', 'idle', 'revoked', 'stale-version']) {
        const denied = await session(), tokenHash = hashSessionToken(denied);
        if (state === 'expired') await admin.query(`update app.sessions set created_at=created_at-interval '2 hours',
          expires_at=expires_at-interval '2 hours',last_seen_at=last_seen_at-interval '2 hours' where token_hash=$1`, [tokenHash]);
        if (state === 'idle') await admin.query(`update app.sessions set created_at=clock_timestamp()-interval '1 hour',
          last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=$1`, [tokenHash]);
        if (state === 'revoked') await admin.query('delete from app.sessions where token_hash=$1', [tokenHash]);
        if (state === 'stale-version') await admin.query('update app.users set auth_version=auth_version+1 where id=$1', [reviewer]);
        await assert.rejects(store.read(denied, reviewer));
      }
    });
    await suite.test('overview cannot be read by a blocked, unverified or demoted former admin', async () => {
      for (const state of ['blocked', 'unverified', 'demoted']) {
        const denied = await session();
        if (state === 'blocked') await admin.query('update app.users set is_blocked=true where id=$1', [reviewer]);
        if (state === 'unverified') await admin.query('update app.users set email_verified_at=null where id=$1', [reviewer]);
        if (state === 'demoted') await admin.query("update app.users set role='user' where id=$1", [reviewer]);
        try {await assert.rejects(store.read(denied, reviewer));}
        finally {await admin.query("update app.users set role='admin',is_blocked=false,email_verified_at=clock_timestamp() where id=$1", [reviewer]);}
      }
      assert.deepEqual(await authority(), originalAuthority);
    });
  } finally {await db.close();}
}
