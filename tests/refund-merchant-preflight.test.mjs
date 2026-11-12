import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRefundMerchantPreflight} from '../src/lib/refund-merchant-preflight.ts';
const merchant={shopId:'synthetic-shop',secretKey:'test_synthetic-only',isTest:true};
test('refund admission verifies actual TEST store with bounded GET, strips provider data and cannot be rebound',async()=>{
 const config={...merchant},calls=[];
 const probe=createRefundMerchantPreflight(config,async(url,init)=>{calls.push({url,init});return Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization_enabled:false,private:'not returned'});});
 config.shopId='changed';assert.equal(await probe(),undefined);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.yookassa.ru/v3/me');
 assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.cache,'no-store');
 assert.equal(calls[0].init.body,undefined);assert.ok(calls[0].init.signal instanceof AbortSignal);
 assert.equal(calls[0].init.headers.Authorization,`Basic ${Buffer.from(`${merchant.shopId}:${merchant.secretKey}`).toString('base64')}`);
});
test('wrong store, LIVE, missing TEST marker and disabled merchant refuse admission without reflecting provider data',async()=>{
 for(const payload of [null,[],{}, {account_id:merchant.shopId,test:false,status:'enabled'},
  {account_id:'other',test:true,status:'enabled'},{account_id:merchant.shopId,test:true,status:'disabled'},
  {account_id:merchant.shopId,test:'true',status:'enabled'}]){
  await assert.rejects(createRefundMerchantPreflight(merchant,async()=>Response.json(payload))(),{message:'Refund merchant preflight failed'});
 }
 for(const patch of [{isTest:false},{secretKey:'live_synthetic'},{shopId:'bad:shop'}])
  assert.throws(()=>createRefundMerchantPreflight({...merchant,...patch},async()=>assert.fail('No HTTP')));
 await assert.rejects(createRefundMerchantPreflight(merchant,async()=>Response.json({description:'private'},{status:401}))(),{message:'Refund merchant preflight failed'});
 for(const fiscalization_enabled of [undefined,true,'false',null])
  await assert.rejects(createRefundMerchantPreflight(merchant,async()=>Response.json({account_id:merchant.shopId,test:true,status:'enabled',fiscalization_enabled}))(),{message:'Refund merchant preflight failed'});
});
test('current fiscalization object is supported; conflicting legacy/current settings and unknown values refuse admission',async()=>{
 const base={account_id:merchant.shopId,test:true,status:'enabled'};
 for(const fiscal of [{fiscalization:{enabled:false}},{fiscalization:{enabled:false},fiscalization_enabled:false}])
  await createRefundMerchantPreflight(merchant,async()=>Response.json({...base,...fiscal}))();
 for(const fiscal of [{},{fiscalization:null},{fiscalization:[]},{fiscalization:{}},{fiscalization:{enabled:true}},
  {fiscalization:{enabled:'false'}},{fiscalization:{enabled:true},fiscalization_enabled:false},{fiscalization:{enabled:false},fiscalization_enabled:true}])
  await assert.rejects(createRefundMerchantPreflight(merchant,async()=>Response.json({...base,...fiscal}))(),{message:'Refund merchant preflight failed'});
});
