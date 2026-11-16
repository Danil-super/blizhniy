import assert from 'node:assert/strict';import {test} from 'node:test';
import {getMediaRetentionRolePlan,mediaRetentionRuntimeGrants} from '../scripts/media-retention-role.mjs';
test('cleanup plan locks metadata without payment/contact/deletion/clock authority',()=>{
 const plan=getMediaRetentionRolePlan('blizhniy_prod');assert.equal(plan.journal.length,58);assert.match(plan.createRole,/nologin.*noinherit.*connection limit 2/);
 assert.ok(plan.grants.includes('grant select(media_id) on app.media_retirement_completions to blizhniy_media_cleanup'));
 assert.ok(plan.grants.includes('grant update(id) on app.media_objects to blizhniy_media_cleanup'));
 assert.equal(plan.grants.some(sql=>/payment|app\.users|app\.sessions|delete|truncate|execute|media_storage_budget/.test(sql)),false);
 assert.equal(mediaRetentionRuntimeGrants.length,2);for(const value of ['db";drop database x','',null])assert.throws(()=>getMediaRetentionRolePlan(value));
});
