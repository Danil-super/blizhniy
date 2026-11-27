import assert from 'node:assert/strict';import {test} from 'node:test';
import {readServiceCheckoutEnabled,servicePlacementRefundTarget,serviceRefundKindEnabled} from '../src/lib/service-checkout-config.ts';
test('paid services are disabled by default and cannot opt in outside the exact local postmoderation scope',()=>{
 assert.equal(readServiceCheckoutEnabled({}),false);assert.equal(readServiceCheckoutEnabled({BLIZHNIY_SERVICE_CHECKOUT:'disabled'}),false);
 const env={BLIZHNIY_SERVICE_CHECKOUT:'local-v1',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_LISTING_WORKFLOW:'postmoderation'};
 assert.equal(readServiceCheckoutEnabled(env),true);
 for(const bad of [{BLIZHNIY_SERVICE_CHECKOUT:'enabled'},{BLIZHNIY_LOCAL_PRIMARY:undefined},{BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://site.example.invalid'},{BLIZHNIY_LISTING_WORKFLOW:'pre-moderation'}])assert.throws(()=>readServiceCheckoutEnabled({...env,...bad}));
});
test('the explicit hosted refund scope admits only a time-bounded advertising purchase',()=>{
 const scope={marqueeRefunds:true};
 assert.equal(servicePlacementRefundTarget({targetType:'ad_marquee',durationDays:7},scope),true);
 assert.equal(servicePlacementRefundTarget({targetType:'ad_marquee',durationDays:null},scope),false);
 assert.equal(serviceRefundKindEnabled('fair_application',scope),false);
 assert.equal(serviceRefundKindEnabled('ad_marquee',{marqueeRefunds:false}),false);
 assert.equal(serviceRefundKindEnabled('specialist',scope),false);
});
