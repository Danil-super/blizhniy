import assert from 'node:assert/strict';import {test} from 'node:test';
import {readMediaRetentionEnabled} from '../src/lib/media-retention-config.ts';
import {getMediaRetentionMigration} from '../scripts/media-retention-release.mjs';
test('media retention defaults off and requires exact owned local57 rollout',()=>{
 const env={BLIZHNIY_MEDIA_RETENTION:'local-v1',BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readMediaRetentionEnabled({}),false);assert.equal(readMediaRetentionEnabled({...env,BLIZHNIY_MEDIA_RETENTION:'disabled'}),false);assert.equal(readMediaRetentionEnabled(env),true);
 for(const [key,value]of [['BLIZHNIY_MEDIA_RETENTION','live'],['BLIZHNIY_SERVICE_CHECKOUT','disabled'],['BLIZHNIY_LOCAL_PRIMARY',undefined],['BLIZHNIY_LOCAL_PRIMARY_ORIGIN','https://example.invalid'],['BLIZHNIY_LOCAL_PRIMARY_ORIGIN','https://127.0.0.1:3046'],['BLIZHNIY_LISTING_WORKFLOW','pre-moderation']])assert.throws(()=>readMediaRetentionEnabled({...env,[key]:value}));
});
test('retention release is a bounded named source candidate, not an automatic migration',()=>{
 const plan=getMediaRetentionMigration();assert.equal(plan.name,'0058-media-reference-journal.sql');assert.match(plan.sha256,/^[a-f0-9]{64}$/);assert.ok(plan.source.includes('create table app.media_retirement_requests'));assert.ok(plan.source.endsWith('commit;\n'));
});
