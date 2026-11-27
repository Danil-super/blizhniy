import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesHostedPostgresLocation } from '../scripts/hosted-postgres-location.mjs';

test('hosted services require the dedicated port and an explicitly selected PostgreSQL host', () => {
  const remote = { BLIZHNIY_DB_HOST: '17e86f80f26733d39ef4b84d.twc1.net', BLIZHNIY_DB_PORT: '5432' };
  const local = { ...remote, BLIZHNIY_DB_HOST: '127.0.0.1', BLIZHNIY_DB_PLACEMENT: 'same-host' };
  assert.equal(matchesHostedPostgresLocation(remote), true);
  assert.equal(matchesHostedPostgresLocation(local), true);
  for (const env of [
    { ...local, BLIZHNIY_DB_PLACEMENT: undefined },
    { ...remote, BLIZHNIY_DB_PLACEMENT: 'same-host' },
    { ...remote, BLIZHNIY_DB_PLACEMENT: 'unexpected' },
    { ...local, BLIZHNIY_DB_HOST: 'localhost' },
    { ...local, BLIZHNIY_DB_HOST: '192.0.2.10' },
    { ...remote, BLIZHNIY_DB_PORT: '5433' },
    { ...local, BLIZHNIY_DB_PORT: '5433' },
  ]) assert.equal(matchesHostedPostgresLocation(env), false);
});
