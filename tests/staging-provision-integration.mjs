// Runs only in the owned, disposable PostgreSQL 18 fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { provisionStaging, staging, verifyStagingRuntime } from '../scripts/provision-staging-postgres.mjs';

export async function testStagingProvision(suite, administrator, config) {
  const directory = mkdtempSync(path.join(tmpdir(), 'blizhniy-stage-integration-'));
  const file = path.join(directory, 'credentials.json');
  const operator = 'staging_fixture_operator';
  let account, runtime;
  try {
    await administrator.query(`create role ${operator} login createdb createrole nosuperuser password 'fixture-operator-only'`);
    const operatorConfig = { ...config, user: operator, password: 'fixture-operator-only', statement_timeout: 10000 };
    account = new pg.Client(operatorConfig); await account.connect();
    let result;
    await suite.test('non-superuser operator installs isolated staging with seven migrations and no accounts', async () => {
      result = await provisionStaging(operatorConfig, `${config.host}:${staging.database}`, file, 'test');
      assert.deepEqual(result.bootstrap, { applied: 7, users: 0, categories: 105, tariffs: 7, cities: 26, professions: 14 });
      assert.equal(result.database, staging.database);
      assert.equal(result.runtimeProfile, 'references-read-only');
      const credentials = JSON.parse(readFileSync(file, 'utf8'));
      assert.ok(!JSON.stringify(credentials).includes('fixture-operator-only'));
      runtime = new pg.Client({ ...config, database: staging.database, user: staging.runtime, password: credentials.runtime.password });
      await runtime.connect();
    });
    await suite.test('actual runtime login reads references but cannot write, DDL or elevate', async () => {
      assert.equal((await runtime.query('select count(*)::integer as n from app.categories')).rows[0].n, 105);
      assert.equal((await verifyStagingRuntime(runtime)).restricted, true);
    });
    await suite.test('a runtime with revoked schema access is not reported as usable', async () => {
      const owner = new pg.Client({ ...config, database: staging.database });
      try {
        await owner.connect();
        await owner.query(`revoke usage on schema app from ${staging.runtime}`);
        try { await assert.rejects(verifyStagingRuntime(runtime), { code: '42501' }); }
        finally { await owner.query(`grant usage on schema app to ${staging.runtime}`); }
      } finally { await owner.end(); }
      assert.equal((await verifyStagingRuntime(runtime)).restricted, true);
    });
    await suite.test('staging runtime has no access to a protected table in operator database', async () => {
      const credentials = JSON.parse(readFileSync(file, 'utf8'));
      await administrator.query('create schema isolated_working; revoke all on schema isolated_working from public; create table isolated_working.private_probe(id integer)');
      const working = new pg.Client({ ...config, user: staging.runtime, password: credentials.runtime.password });
      try {
        await working.connect();
        await assert.rejects(working.query('select * from isolated_working.private_probe limit 0'), { code: '42501' });
        assert.equal((await working.query('select current_database() as name')).rows[0].name, config.database);
      } finally { await working.end(); }
      await administrator.query('drop schema isolated_working cascade');
    });
    await suite.test('repeated provisioning refuses existing roles/database without rotating credentials', async () => {
      const before = readFileSync(file, 'utf8');
      await assert.rejects(provisionStaging(operatorConfig, `${config.host}:${staging.database}`, file, 'test'), /already exists/);
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.equal((await runtime.query('select count(*)::integer as n from app.tariffs')).rows[0].n, 7);
    });
  } finally {
    if (runtime) await runtime.end();
    if (account) await account.end();
    rmSync(directory, { recursive: true, force: true });
    // Database and roles disappear with the positively identified fixture container.
  }
}
