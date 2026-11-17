import assert from 'node:assert/strict';import{test}from'node:test';import{spawnSync}from'node:child_process';
test('local case CLI rejects incomplete commands and sensitive-looking identifiers before stand access',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 for(const args of [[],['--run','--request','private@example.invalid','--revision','1'],['--run','--request',id,'--revision','0'],['--run','--request',id,'--revision','1','extra']]){
  const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/inspect-local-deletion-case.mjs',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'test'},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(result.stderr.includes('Local deletion case inspection failed; no deletion performed.'));assert.equal(result.stderr.includes('private@example.invalid'),false);
 }
});
