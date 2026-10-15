import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
test('moderation is opt-in and preserves every photo/account migration byte',()=>{
 const prior=getBootstrapPlan({includeListingPhotos:true}),plan=getBootstrapPlan({includeListingModeration:true});
 assert.equal(plan.length,14);assert.deepEqual(plan.slice(0,13),prior);assert.equal(plan.at(-1).name,'0014-listing-moderation.sql');
 for(const bad of [null,1,'true'])assert.throws(()=>getBootstrapPlan({includeListingModeration:bad}),/Invalid/);
 assert.equal(getBootstrapPlan().length,7);assert.equal(getBootstrapPlan({includeListingPhotos:true}).length,13);
});
test('operator can inspect moderation plan without credentials or network',()=>{
 const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/bootstrap-postgres.mjs','--plan-listing-moderation'],{
  encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,PGHOST:'never-connect.example.invalid'},
 });
 assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).migrations.at(-1).name,'0014-listing-moderation.sql');
});
