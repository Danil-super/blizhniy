import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalDevelopmentEnvironment } from '../src/lib/local-development.ts';

test('local CAPTCHA mode requires development, an explicit flag and the exact local API', () => {
  const local = { mode: 'development', flag: 'true', api: 'http://127.0.0.1:54341' };
  assert.equal(isLocalDevelopmentEnvironment(local), true);
  for (const override of [
    { mode: 'production' }, { mode: 'test' }, { flag: undefined }, { flag: 'false' },
    { api: 'https://remote.supabase.co' }, { api: 'http://localhost:54341' },
    { api: 'http://user@127.0.0.1:54341' }, { api: 'http://127.0.0.1:54341/path' },
  ]) assert.equal(isLocalDevelopmentEnvironment({ ...local, ...override }), false);
});
