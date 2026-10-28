import assert from 'node:assert/strict';import {test} from 'node:test';
import {parseApplicationCheckout} from '../src/lib/application-checkout-contract.ts';
const input={applicationId:'11111111-1111-4111-8111-111111111111',expectedRevision:'9007199254740993',creationKey:'22222222-2222-4222-8222-222222222222',expectedTariffId:'job-response',expectedAmount:'99.00'};
test('application checkout is an exact one-time fee without invented placement duration or financial authority',()=>{
 assert.deepEqual(parseApplicationCheckout(input),input);
 for(const patch of [{expectedAmount:'0.00'},{expectedAmount:'1e2'},{expectedRevision:9007199254740993},{expectedRevision:'0'},{applicationId:'bad'},{expectedTariffId:'other-tariff'},{durationDays:30},{paid:true}])assert.throws(()=>parseApplicationCheckout({...input,...patch}));
});
