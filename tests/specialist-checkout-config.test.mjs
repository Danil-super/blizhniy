import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
test('specialist checkout is opt-in for the owned local stand and never activates Fair or production',()=>{
 const {readSpecialistCheckoutEnabled}=load('specialist-checkout-config');
 assert.equal(readSpecialistCheckoutEnabled({}),false);
 assert.equal(readSpecialistCheckoutEnabled({BLIZHNIY_SPECIALIST_CHECKOUT:'disabled'}),false);
 const enabled={BLIZHNIY_SPECIALIST_CHECKOUT:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readSpecialistCheckoutEnabled(enabled),true);
 for(const patch of [{BLIZHNIY_SPECIALIST_CHECKOUT:'production-v1'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://example.invalid'},{BLIZHNIY_LISTING_WORKFLOW:undefined}])assert.throws(()=>readSpecialistCheckoutEnabled({...enabled,...patch}));
 assert.equal(load('service-checkout-config').readServiceCheckoutEnabled(enabled),false);
});
