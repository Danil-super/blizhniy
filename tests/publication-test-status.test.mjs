import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseListingPaymentSnapshot} from '../src/lib/client-listing-payment.ts';
const id='11111111-1111-4111-8111-111111111111';
const snapshot={order:{id,creationKey:id,targetId:id,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,status:'succeeded',createdAt:'2026-11-16T10:00:00.000000Z'},fulfillment:null};
test('saved publication admission survives status readback without inventing fulfillment or upgrading old TEST orders',()=>{
 const historical=parseListingPaymentSnapshot(snapshot,id);assert.equal(Object.hasOwn(historical,'testPublication'),false);assert.equal(historical.fulfillment,null);
 const admitted=parseListingPaymentSnapshot({...snapshot,testPublication:true},id);assert.equal(admitted.testPublication,true);assert.equal(admitted.fulfillment,null);
 const testOnly=parseListingPaymentSnapshot({...snapshot,testOnly:true},id);assert.equal(testOnly.testOnly,true);assert.equal(Object.hasOwn(testOnly,'testPublication'),false);
 const marked=parseListingPaymentSnapshot({...snapshot,testOnly:true,testPublication:true},id);assert.equal(marked.testOnly,true);assert.equal(marked.testPublication,true);
 for(const field of ['testPublication','testOnly'])for(const value of [false,'true',null,1,{}])assert.throws(()=>parseListingPaymentSnapshot({...snapshot,[field]:value},id));
 assert.throws(()=>parseListingPaymentSnapshot({...snapshot,testPublication:true,unexpected:true},id));
});
