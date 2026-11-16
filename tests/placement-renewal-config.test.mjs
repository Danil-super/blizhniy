import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {readPlacementRenewalsEnabled}=load('placement-renewal-config');
test('renewal rollout defaults off and accepts only the inspected local postmoderation deployment',()=>{
 assert.equal(readPlacementRenewalsEnabled({}),false);assert.equal(readPlacementRenewalsEnabled({BLIZHNIY_PLACEMENT_RENEWALS:'disabled'}),false);
 const env={BLIZHNIY_PLACEMENT_RENEWALS:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readPlacementRenewalsEnabled(env),true);
 for(const patch of [{BLIZHNIY_PLACEMENT_RENEWALS:'true'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.com'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}])assert.throws(()=>readPlacementRenewalsEnabled({...env,...patch}));
});
