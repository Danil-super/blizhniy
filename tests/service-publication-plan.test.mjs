import assert from 'node:assert/strict';import {test} from 'node:test';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('service schema is an explicit additive opt-in, not an implicit expansion of earlier approved migration plans',()=>{
 const prefix=getBootstrapPlan({includeWorkPublications:true}),plan=getBootstrapPlan({includeServicePublications:true});
 assert.equal(prefix.length,16);assert.equal(plan.length,17);assert.equal(plan.at(-1).name,'0017-service-publications.sql');
 assert.deepEqual(plan.slice(0,16),prefix);assert.equal(getBootstrapPlan().length,7);
 assert.throws(()=>getBootstrapPlan({includeServicePublications:'yes'}));
});
test('service operator CLI exposes the same explicit offline plan without reading runtime or owner credentials',async()=>{
 const result=await promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/bootstrap-postgres.mjs','--plan-service-publications'],{
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'},timeout:10000,maxBuffer:65536});
 const plan=JSON.parse(result.stdout);assert.equal(plan.migrations.length,17);assert.equal(plan.migrations.at(-1).name,'0017-service-publications.sql');
});
