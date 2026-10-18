import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
test('interactions expand only an explicit eighteenth plan and preserve all service/auth bytes',()=>{
 const before=getBootstrapPlan({includeServicePublications:true}),after=getBootstrapPlan({includeInteractions:true});
 assert.equal(after.length,18);assert.deepEqual(after.slice(0,17),before);assert.equal(after.at(-1).name,'0018-interactions.sql');
 assert.equal(getBootstrapPlan().length,7);assert.equal(getBootstrapPlan({includeServicePublications:true}).length,17);
 assert.throws(()=>getBootstrapPlan({includeInteractions:'true'}));
});
test('interactions have an explicit read-only CLI plan and no implicit migration or privilege changes',()=>{
 const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/bootstrap-postgres.mjs','--plan-interactions'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).migrations.length,18);
});
test('interactions have a guarded empty-only down path rather than deletion of existing user requests',()=>{
 const down=readFileSync(new URL('../database/migrations/0018-interactions.down.sql',import.meta.url),'utf8');
 assert.match(down,/access exclusive mode/i);for(const table of ['applications','booking_requests','notifications'])assert.match(down,new RegExp(`exists\\(select 1 from app\\.${table}\\)`));
 assert.match(down,/raise exception 'Refusing to remove nonempty interactions'/);assert.doesNotMatch(down,/delete from|cascade/i);
});
