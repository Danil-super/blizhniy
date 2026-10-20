import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createPrimaryTestPaymentProbe} from '../src/lib/primary-test-payment-probe.ts';

const fixture={orderId:'10000000-0000-4000-8000-000000000001',ownerId:'10000000-0000-4000-8000-000000000002',listingId:'10000000-0000-4000-8000-000000000003',creationKey:'10000000-0000-4000-8000-000000000004'};
const merchant={shopId:'123456',isTest:true,secretKey:'test_synthetic_only',siteOrigin:'https://site.example.invalid'};
const providerId='20000000-0000-4000-8000-000000000001';
function setup(patch={}){
 const binding={id:fixture.orderId,ownerId:fixture.ownerId,targetType:'listing',targetId:fixture.listingId,targetRevision:'1',tariffId:'listing-publication',amount:'199.00',durationDays:30,shopId:merchant.shopId,isTest:true};
 const requestBody=JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:`${merchant.siteOrigin}/oplata/${binding.id}`},description:'Размещение объявления',receipt:{customer:{email:`checkout-${fixture.ownerId}@example.com`},internet:true,items:[{amount:{value:binding.amount,currency:'RUB'},description:'Размещение объявления',payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:1}]},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:'listing',tariffId:binding.tariffId}});
 const row={...binding,requestBody,syntheticEmail:`checkout-${fixture.ownerId}@example.com`,blocked:true,sessionCount:0,listingStatus:'draft',paid:false,publishedAt:null,expiresAt:null,listingRevision:'1',approvedRevision:'1',moderationState:'approved',creationKey:fixture.creationKey,orderStatus:'created',fulfillmentCount:0,linked:false,...patch};
 const state={provider:null,anchor:false,verification:null,status:'created',calls:[],row};
 const db={transaction:async work=>work({query:async(sql,args)=>{
  let rows=[];
  if(sql.includes('as "syntheticEmail"'))rows=[{...row,linked:state.provider!==null,orderStatus:state.status}];
  else if(sql.includes('from app.payment_checkout_intents'))rows=[{...binding,requestBody,sha256:createHash('sha256').update(requestBody).digest('hex')}];
  else if(sql.startsWith('insert into app.payment_dispatch_anchors'))state.anchor=true;
  else if(sql.includes('extract(epoch'))rows=[{remaining:'3600000'}];
  else if(sql.includes('from app.payment_dispatch_anchors'))rows=state.anchor?[{intent_id:binding.id}]:[];
  else if(sql.startsWith('insert into app.payment_provider_links'))state.provider??=args[1];
  else if(sql.includes('from app.payment_provider_links'))rows=state.provider?[{id:state.provider}]:[];
  else if(sql.startsWith('select status from app.payment_orders'))rows=[{status:state.status}];
  else if(sql.includes('from app.payment_verifications'))rows=state.verification?[state.verification]:[];
  else if(sql.startsWith('insert into app.payment_verifications'))state.verification={status:args[2],capturedAt:args[3]};
  else if(sql.startsWith('update app.payment_orders'))state.status=args[1];
  else throw Error('Unexpected probe query');
  return{rows,rowCount:rows.length};
 }})};
 const fetcher=async(url,init)=>{
  state.calls.push([url,init.method]);
  return Response.json({id:providerId,status:'pending',paid:false,test:true,recipient:{account_id:merchant.shopId},amount:{value:binding.amount,currency:'RUB'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:'listing',tariffId:binding.tariffId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
 };
 return{state,db,fetcher};
}

test('operator TEST probe dispatches one closed synthetic order, replays with GET and never grants a publication',async()=>{
 const {db,state,fetcher}=setup(),probe=createPrimaryTestPaymentProbe(db,merchant,fetcher);
 const first=await probe.dispatch(fixture);
 assert.deepEqual(first,{providerPaymentId:providerId,confirmationUrl:'https://yoomoney.ru/checkout',status:'pending',orderStatus:'pending'});
 const next=await probe.dispatch(fixture);assert.deepEqual(next,first);
 assert.deepEqual(state.calls.map(call=>call[1]),['POST','GET','GET','GET']);
 assert.equal(state.anchor,true);assert.equal(state.provider,providerId);assert.equal(state.row.paid,false);assert.equal(state.row.fulfillmentCount,0);
});

test('operator probe rejects LIVE credentials and mismatched configuration before SQL or network',()=>{
 const {db,fetcher}=setup();
 for(const patch of [{isTest:false},{secretKey:'live_synthetic'},{shopId:''},{siteOrigin:'http://site.example.invalid'},{siteOrigin:'https://site.example.invalid/path'}])
  assert.throws(()=>createPrimaryTestPaymentProbe(db,{...merchant,...patch},fetcher));
});

test('operator probe refuses a real, active, edited, fulfilled or misbound target before creating an anchor or sending anything',async()=>{
 for(const patch of [{syntheticEmail:'person@example.invalid'},{blocked:false},{sessionCount:1},{listingStatus:'published'},{paid:true},{publishedAt:'2026-10-20'},{expiresAt:'2026-10-20'},{listingRevision:'2'},{approvedRevision:'2'},{moderationState:'pending'},{fulfillmentCount:1},{isTest:false},{shopId:'654321'},{creationKey:'10000000-0000-4000-8000-000000000005'},{targetId:'10000000-0000-4000-8000-000000000005'}]){
  const {db,state,fetcher}=setup(patch);
  await assert.rejects(createPrimaryTestPaymentProbe(db,merchant,fetcher).dispatch(fixture));
  assert.deepEqual(state.calls,[]);assert.equal(state.anchor,false);assert.equal(state.provider,null);
 }
});

test('only a complete synthetic TEST receipt is allowed; personal data and a different return URL are refused',async()=>{
 for(const change of [body=>{delete body.receipt;},body=>{body.receipt.customer.email='private@example.invalid';},body=>{body.receipt.items[0].vat_code=2;},body=>{body.confirmation.return_url='https://other.example.invalid/return';},body=>{body.description='PRIVATE_TEXT';}]){
  const f=setup(),body=JSON.parse(f.state.row.requestBody);change(body);f.state.row.requestBody=JSON.stringify(body);
  await assert.rejects(createPrimaryTestPaymentProbe(f.db,merchant,f.fetcher).dispatch(fixture));assert.deepEqual(f.state.calls,[]);
 }
});

test('GET-only reconciliation never creates a missing provider payment and fixture IDs are all mandatory',async()=>{
 const f=setup(),probe=createPrimaryTestPaymentProbe(f.db,merchant,f.fetcher);
 await assert.rejects(probe.reconcile(fixture));assert.deepEqual(f.state.calls,[]);assert.equal(f.state.anchor,false);
 for(const key of Object.keys(fixture))await assert.rejects(probe.dispatch({...fixture,[key]:'invalid'}));
 assert.deepEqual(f.state.calls,[]);
});
