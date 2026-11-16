import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseServiceCheckout,ServiceCheckoutInputError} from '../src/lib/service-checkout-contract.ts';
const id='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222';
const fair={publicationId:id,expectedRevision:'1',creationKey:key,expectedTariffId:'fair-participation',expectedAmount:'1000.00',expectedDurationDays:null,expectedFairDate:'2026-11-29'};
const marquee={...fair,expectedTariffId:'ad-marquee',expectedAmount:'500.00',expectedDurationDays:7,expectedFairDate:null};
test('service purchases distinguish a concrete fair from elapsed advertising days',()=>{
 assert.deepEqual(parseServiceCheckout('fair',fair),fair);assert.deepEqual(parseServiceCheckout('marquee',marquee),marquee);
 assert.notEqual(parseServiceCheckout('fair',fair),fair);
});
test('a checkout cannot choose a different type, duration, tariff identity or malformed event date',()=>{
 const bad=[['specialist',fair],['fair',marquee],['marquee',fair],['fair',{...fair,expectedDurationDays:1}],['fair',{...fair,expectedFairDate:'2026-02-30'}],['fair',{...fair,expectedFairDate:'2026-11-28'}],['fair',{...fair,expectedFairDate:'2026-11-01'}],['marquee',{...marquee,expectedDurationDays:0}],['marquee',{...marquee,expectedDurationDays:3651}],['marquee',{...marquee,expectedDurationDays:1.5}],['fair',{...fair,expectedFairDate:null}]];
 for(const [kind,input] of bad)assert.throws(()=>parseServiceCheckout(kind,input),ServiceCheckoutInputError);
});
test('untrusted checkout input has an exact allowlist and bounded canonical identities and money',()=>{
 const variants=[null,[],Object.create({publicationId:id}),{...fair,status:'succeeded'},{...fair,ownerId:id},{...fair,endsAt:'2027-01-01T00:00:00Z'},{...fair,expectedAmount:'1000'},{...fair,expectedAmount:'1e3'},{...fair,expectedAmount:'0.00'},{...fair,expectedAmount:'01000.00'},{...fair,expectedAmount:1000},{...fair,expectedAmount:'1000.001'},{...fair,expectedRevision:'0'},{...fair,expectedRevision:'9223372036854775808'},{...fair,creationKey:id.toUpperCase()+' '},{...fair,publicationId:'../payment'},{...fair,expectedTariffId:'fair_participation'},{...fair,[Symbol('input')]:true}];
 for(const input of variants)assert.throws(()=>parseServiceCheckout('fair',input),ServiceCheckoutInputError);
});
test('an old valid fair date remains readable; eligibility and current event are separate server checks',()=>{
 assert.equal(parseServiceCheckout('fair',{...fair,expectedFairDate:'2024-02-25'}).expectedFairDate,'2024-02-25');
});
