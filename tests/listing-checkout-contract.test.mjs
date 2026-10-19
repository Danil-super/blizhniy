import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseListingCheckout,ListingCheckoutInputError} from '../src/lib/listing-checkout-contract.ts';
const input={listingId:'10000000-0000-4000-8000-000000000001',expectedRevision:'9007199254740993',creationKey:'10000000-0000-4000-8000-000000000002',expectedTariffId:'listing-publication',expectedAmount:'199.99',expectedDurationDays:30};
test('listing checkout accepts only an immutable user intent and exact expected offer, never financial authority',()=>{
 assert.deepEqual(parseListingCheckout(input),input);
 for(const patch of [{paid:true},{status:'succeeded'},{ownerId:input.listingId},{providerId:input.listingId},{expectedRevision:1},{expectedRevision:'9223372036854775808'},
  {expectedAmount:199.99},{expectedAmount:'1e3'},{expectedAmount:'01.00'},{expectedDurationDays:0},{expectedDurationDays:null},{creationKey:'new-key'},{expectedTariffId:'a/b'}])
  assert.throws(()=>parseListingCheckout({...input,...patch}),ListingCheckoutInputError);
 for(const value of [null,[],{},undefined])assert.throws(()=>parseListingCheckout(value),ListingCheckoutInputError);
});
