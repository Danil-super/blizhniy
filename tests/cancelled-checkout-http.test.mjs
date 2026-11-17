import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadLocalPrimaryModule as load} from '../scripts/local-primary-modules.cjs';

const origin='https://checkout.example.invalid',owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
for(const [name,create,expected] of [
 ['placement',dispatch=>load('listing-checkout-http').createListingCheckoutHandler({origin},()=>({store:{},limiter:{allowProduction:async()=>true},payments:{dispatch}}),()=>{}),'CHECKOUT_NOT_READY'],
 ['response',dispatch=>load('application-checkout-http').createApplicationCheckoutHandler(origin,{store:{},limiter:{allowProduction:async()=>true},dispatch}),'CHECKOUT_CHANGED'],
 ['service',dispatch=>load('service-checkout-http').createServiceCheckoutHandler({origin},'marquee',{store:{},limiter:{allowProduction:async()=>true},dispatch}),'CHECKOUT_NOT_READY'],
])test(name+' distinguishes a cancelled preparation from an unknown dispatch failure without retry or private details',async()=>{
 for(const [code,status,responseCode] of [['PCA02',409,expected],['PCA04',503,'CHECKOUT_UNAVAILABLE'],['XX000',503,'CHECKOUT_UNAVAILABLE']]){
  let calls=0;
  const handle=create(async()=>{calls++;throw Object.assign(Error('PRIVATE original SQL or merchant details'),{code});});
  const request=new Request(origin+'/api/account/checkout',{method:'POST',headers:{host:new URL(origin).host,origin,'x-real-ip':'192.0.2.4','x-blizhniy-request':'1','content-type':'application/json',cookie:'__Host-blizhniy_session='+'a'.repeat(64)},body:JSON.stringify({expectedOwnerId:owner,action:'dispatch',paymentId:id})});
  const response=await handle(request);assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code:responseCode}});assert.equal(calls,1);assert.equal(response.headers.get('cache-control'),'no-store');
 }
});
