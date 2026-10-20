import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createPrimaryPaymentDispatcher} from '../src/lib/primary-payment-dispatch.ts';

const binding={id:'10000000-0000-4000-8000-000000000001',ownerId:'10000000-0000-4000-8000-000000000002',targetType:'listing',targetId:'10000000-0000-4000-8000-000000000003',targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:'fixture-shop',isTest:true};
const providerId='20000000-0000-4000-8000-000000000001';
const merchant={shopId:binding.shopId,isTest:true,secretKey:'test_synthetic_fixture_only'};
const requestBody=` ${JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/return'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId}})}\n`;
const payload=()=>({id:providerId,status:'pending',paid:false,test:true,recipient:{account_id:merchant.shopId},amount:{value:binding.amount,currency:'RUB'},metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId},confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout'}});
function fixture(){
 const state={provider:null,anchor:false,remaining:3600000,transactions:0,inside:false,failCommit:0,afterCommit:()=>{},hash:createHash('sha256').update(requestBody).digest('hex')};
 const db={transaction:async work=>{
  const number=++state.transactions;state.inside=true;
  try{
   const result=await work({query:async(sql,args)=>{
    let rows=[];
    if(sql.includes('from app.payment_checkout_intents'))rows=[{...binding,requestBody,sha256:state.hash}];
    else if(sql.startsWith('insert into app.payment_provider_links'))state.provider??=args[1];
    else if(sql.includes('from app.payment_provider_links'))rows=state.provider?[{id:state.provider}]:[];
    else if(sql.startsWith('insert into app.payment_dispatch_anchors'))state.anchor=true;
    else if(sql.includes('extract(epoch'))rows=[{remaining:String(state.remaining)}];
    else if(sql.includes('from app.payment_dispatch_anchors'))rows=state.anchor?[{intent_id:binding.id}]:[];
    else throw Error('Unapproved synthetic dispatch query');
    return{rows,rowCount:rows.length};
   }});
   state.afterCommit(number);
   if(state.failCommit===number)throw Error('Synthetic lost COMMIT');
   return result;
  }finally{state.inside=false;}
 }};
 return{state,db};
}
test('dispatch sends only committed original bytes and stable local key, validates then stores the known provider binding',async()=>{
 const {state,db}=fixture();let calls=0;
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(url,init)=>{
  calls++;assert.equal(state.inside,false);assert.equal(state.anchor,true);assert.equal(state.provider,null);
  assert.equal(url,'https://api.yookassa.ru/v3/payments');assert.equal(init.method,'POST');assert.equal(init.body,requestBody);
  assert.equal(init.headers['Idempotence-Key'],binding.id);assert.equal(init.headers['Content-Type'],'application/json');assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);return Response.json({...payload(),description:'PRIVATE_PROVIDER_TEXT',metadata:{...payload().metadata,unused:'PRIVATE_METADATA'}});
 });
 assert.deepEqual(await dispatcher.dispatch(binding),{providerPaymentId:providerId,confirmationUrl:'https://yoomoney.ru/checkout'});
 assert.equal(calls,1);assert.equal(state.provider,providerId);
});
test('unknown remote response retries only the same key and byte-exact request, never a replacement charge',async()=>{
 const {db,state}=fixture(),calls=[];
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(url,init)=>{
  calls.push([url,init.method,init.headers['Idempotence-Key'],init.body]);
  if(calls.length===1)throw Error('PRIVATE_NETWORK_TEXT');return Response.json(payload());
 });
 assert.equal((await dispatcher.dispatch(binding)).providerPaymentId,providerId);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(state.provider,providerId);
});
test('known provider IDs use GET even after the POST window; provider refusal never falls back to creating a payment',async()=>{
 const {db,state}=fixture();state.provider=providerId;state.remaining=-1;
 const calls=[],dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(url,init)=>{calls.push([url,init.method,init.body]);return Response.json(payload());});
 await dispatcher.dispatch(binding);assert.deepEqual(calls,[[`https://api.yookassa.ru/v3/payments/${providerId}`,'GET',undefined]]);
 let refusals=0;await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{refusals++;assert.equal(init.method,'GET');return Response.json({description:'PRIVATE_PROVIDER_TEXT'},{status:404});}).dispatch(binding),error=>!error.message.includes('PRIVATE_PROVIDER_TEXT'));
 assert.equal(refusals,1);
});
test('discovery of a concurrent provider link before an attempt switches to authoritative GET without a POST',async()=>{
 const {db,state}=fixture();state.afterCommit=n=>{if(n===1)state.provider=providerId;};
 const methods=[];await createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{methods.push(init.method);return Response.json(payload());}).dispatch(binding);
 assert.deepEqual(methods,['GET']);
});
test('POST to GET recovery shares the original three-attempt budget rather than starting a fresh retry sequence',async()=>{
 const {db,state}=fixture(),methods=[];
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{
  methods.push(init.method);state.provider=providerId;return Response.json({},{status:503});
 }).dispatch(binding));
 assert.deepEqual(methods,['POST','GET','GET']);
});
test('a shrinking authorization window is checked again after loading the body and before the first POST',async()=>{
 const {db,state}=fixture();state.afterCommit=n=>{if(n===1)state.remaining=-1;};let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch(binding));assert.equal(calls,0);
});
test('expiry discovered before a retry stops POST and leaves the outcome unknown rather than manufacturing success',async()=>{
 const {db,state}=fixture();let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;state.remaining=-1;return Response.json({},{status:503});}).dispatch(binding));
 assert.equal(calls,1);assert.equal(state.provider,null);
});
test('one shrinking deadline covers the POST body/backoff rather than granting a new budget to each attempt',{timeout:2000},async()=>{
 const {db,state}=fixture();state.remaining=40;let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json({},{status:503});}).dispatch(binding));
 assert.equal(calls,1);assert.equal(state.provider,null);
});
test('merchant/binding/hash and unvalidated provider replies cannot establish a provider link',async()=>{
 for(const patch of [{shopId:'other'},{isTest:false},{amount:'200.00'},{targetRevision:'2'}]){
  const {db,state}=fixture();let calls=0;await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch({...binding,...patch}));assert.equal(calls,0);assert.equal(state.provider,null);
 }
 const {db,state}=fixture();state.hash='0'.repeat(64);let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch(binding));assert.equal(calls,0);
 for(const bad of [{...payload(),metadata:{}},{...payload(),recipient:{account_id:'other'}},{...payload(),amount:{value:'200.00',currency:'RUB'}},{...payload(),confirmation:{type:'redirect',confirmation_url:'https://evil.example.invalid'}}]){
  const f=fixture();await assert.rejects(createPrimaryPaymentDispatcher(f.db,merchant,async()=>Response.json(bad)).dispatch(binding));assert.equal(f.state.provider,null);
 }
});
test('unknown local COMMIT is never retried internally; later readback recovers a committed provider link using GET only',async()=>{
 const first=fixture();first.state.failCommit=1;let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(first.db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch(binding),/Synthetic lost COMMIT/);
 assert.equal(calls,0);assert.equal(first.state.transactions,1);
 const {db,state}=fixture();state.failCommit=3;const methods=[];
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{methods.push(init.method);return Response.json(payload());});
 await assert.rejects(dispatcher.dispatch(binding),/Synthetic lost COMMIT/);assert.equal(state.provider,providerId);assert.deepEqual(methods,['POST']);
 assert.equal((await dispatcher.dispatch(binding)).providerPaymentId,providerId);assert.deepEqual(methods,['POST','GET']);
});
test('a lost immediate pre-POST authorization COMMIT causes zero network calls and no internal SQL retry',async()=>{
 const {db,state}=fixture();state.failCommit=2;let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch(binding),/Synthetic lost COMMIT/);
 assert.equal(calls,0);assert.equal(state.transactions,2);assert.equal(state.provider,null);
});
test('a conflicting concurrent provider link is never overwritten or silently adopted after a different POST response',async()=>{
 const {db,state}=fixture(),otherId='20000000-0000-4000-8000-000000000002';let calls=0;
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{
  calls++;assert.equal(init.method,'POST');state.provider=otherId;return Response.json(payload());
 }).dispatch(binding));
 assert.equal(calls,1);assert.equal(state.provider,otherId);
});
test('owner admission is rechecked before each POST attempt, and known-ID GET recovery does not require a new purchase admission',async()=>{
 const {db,state}=fixture();let admissions=0,calls=0;
 const dispatcher=createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json({},{status:503});});
 await assert.rejects(dispatcher.dispatch(binding,async()=>{if(++admissions===2)throw Error('Purchase admission revoked');}));
 assert.equal(admissions,2);assert.equal(calls,1);assert.equal(state.provider,null);
 state.provider=providerId;
 const result=await createPrimaryPaymentDispatcher(db,merchant,async(_url,init)=>{assert.equal(init.method,'GET');return Response.json(payload());}).dispatch(binding,async()=>assert.fail('Known payment cannot start a new purchase'));
 assert.equal(result.providerPaymentId,providerId);
});
test('a session revoked while final intent authorization waits cannot issue a POST after its stale admission',async()=>{
 const {db,state}=fixture();let valid=true,calls=0;
 state.afterCommit=number=>{if(number===2)valid=false;};
 await assert.rejects(createPrimaryPaymentDispatcher(db,merchant,async()=>{calls++;return Response.json(payload());}).dispatch(binding,async()=>{if(!valid)throw Error('Revoked admission');}));
 assert.equal(calls,0);assert.equal(state.provider,null);
});
