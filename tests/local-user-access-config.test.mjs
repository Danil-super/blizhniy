import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {readLocalUserAccessOperatorConfig}=load('local-user-access-config');
test('user operator view is off by default and enables only an explicit local production-shaped stand',()=>{
  assert.equal(readLocalUserAccessOperatorConfig({}),null);
  const env={NODE_ENV:'production',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_AUTH_MODE:'postgres',
    BLIZHNIY_USER_ACCESS_OPERATOR:'local-v1',BLIZHNIY_USER_ACCESS_SOCKET:join(tmpdir(),'blizhniy-user-operator-abc123','operator.sock')};
  assert.deepEqual(readLocalUserAccessOperatorConfig(env),{socketPath:env.BLIZHNIY_USER_ACCESS_SOCKET});
  for(const patch of [{NODE_ENV:'development'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://production.example.invalid'},
    {BLIZHNIY_AUTH_MODE:'local'},{BLIZHNIY_USER_ACCESS_OPERATOR:'enabled'},{BLIZHNIY_USER_ACCESS_SOCKET:'/tmp/other.sock'},{BLIZHNIY_USER_ACCESS_SOCKET:'https://remote.example.invalid'}])
    assert.throws(()=>readLocalUserAccessOperatorConfig({...env,...patch}));
});
