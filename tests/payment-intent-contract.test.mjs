import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePaymentIntent,PaymentIntentError,PostgresPaymentIntentStore} from '../src/lib/postgres-payment-intents.ts';

export const binding={id:'10000000-0000-4000-8000-000000000001',ownerId:'10000000-0000-4000-8000-000000000002',targetType:'listing',targetId:'10000000-0000-4000-8000-000000000003',targetRevision:'9007199254740993',tariffId:'listing-publication',amount:'199.99',durationDays:30,shopId:'fixture-shop',isTest:true};
export const requestBody=JSON.stringify({amount:{value:binding.amount,currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:'https://site.example.invalid/payment/return'},description:'Синтетическая услуга',metadata:{localPaymentId:binding.id,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId}});

test('payment intent preserves exact UTF-8 bytes, string money and SQL bigint revision',()=>{
 const value={...binding,requestBody:` ${requestBody}\n`};
 assert.deepEqual(parsePaymentIntent(value),value);
});
test('payment intent refuses forged economic bindings and unsafe provider requests',()=>{
 for(const patch of [{amount:199.99},{amount:'0.00'},{amount:'01.00'},{amount:'1.001'},{amount:'NaN'},{targetRevision:1},{targetRevision:'9223372036854775808'},
  {isTest:'true'},{shopId:'x\nAuthorization: secret'},{durationDays:0},{targetType:'unknown'},{ownerId:binding.id.toUpperCase().replace('1000','ZZZZ')},{extra:true}])
  assert.throws(()=>parsePaymentIntent({...binding,requestBody,...patch}),PaymentIntentError);
 for(const patch of [{capture:false},{amount:{value:'200.00',currency:'RUB'}},{amount:{value:'199.99',currency:'USD'}},{metadata:{}},
  {metadata:{localPaymentId:binding.ownerId,targetId:binding.targetId,targetType:binding.targetType,tariffId:binding.tariffId}},
  {confirmation:{type:'redirect',return_url:'http://site.example.invalid/return'}},{confirmation:{type:'redirect',return_url:'https://site.example.invalid/\ud800'}},{payment_method_data:{type:'bank_card'}},{receipt:{customer:{email:'bad'},items:[]}}])
  assert.throws(()=>parsePaymentIntent({...binding,requestBody:JSON.stringify({...JSON.parse(requestBody),...patch})}),PaymentIntentError);
 for(const body of ['',null,'[]','{bad',requestBody+' '.repeat(16384),requestBody.replace('Синтетическая','\ud800')])
  assert.throws(()=>parsePaymentIntent({...binding,requestBody:body}),PaymentIntentError);
});
test('a complete original receipt is retained byte-for-byte, while malformed VAT or receipt price is rejected',()=>{
 const receipt={customer:{email:'fixture@example.invalid'},internet:true,items:[{amount:{value:binding.amount,currency:'RUB'},description:'Услуга',payment_mode:'full_payment',payment_subject:'service',quantity:1,vat_code:1}]};
 const request={...JSON.parse(requestBody),receipt};
 const value={...binding,requestBody:JSON.stringify(request)};assert.deepEqual(parsePaymentIntent(value),value);
 for(const patch of [{vat_code:null},{vat_code:0},{vat_code:13},{quantity:2},{amount:{value:'200.00',currency:'RUB'}},{description:'\ud800'}])
  assert.throws(()=>parsePaymentIntent({...binding,requestBody:JSON.stringify({...request,receipt:{...receipt,items:[{...receipt.items[0],...patch}]}})}),PaymentIntentError);
});
test('expired remaining budget after commit never authorizes transport, and unknown commit is not retried',async()=>{
 let commits=0,transactions=0;
 const store=new PostgresPaymentIntentStore({transaction:async()=>{transactions++;await new Promise(resolve=>setTimeout(resolve,10));commits++;return {decision:'post',requestBody,remainingMs:1};}});
 await assert.rejects(store.authorize(binding),PaymentIntentError);assert.equal(commits,1);assert.equal(transactions,1);
 const lost=new PostgresPaymentIntentStore({transaction:async()=>{transactions++;throw new Error('Synthetic unknown COMMIT');}});
 await assert.rejects(lost.authorize(binding),/Synthetic unknown COMMIT/);assert.equal(transactions,2);
});
test('a corrupted database snapshot hash is rejected before it can become a dispatch request',async()=>{
 const store=new PostgresPaymentIntentStore({transaction:async()=>{throw new Error('Not used');}});
 const tx={query:async sql=>sql.startsWith('insert')?{rows:[],rowCount:1}:{rows:[{...binding,requestBody,sha256:'0'.repeat(64)}],rowCount:1}};
 await assert.rejects(store.persistInTransaction(tx,{...binding,requestBody}),PaymentIntentError);
});
test('trusted known-payment read validates the original bytes and refuses absent links before recovery',async()=>{
 const {createHash}=await import('node:crypto');
 const store=new PostgresPaymentIntentStore({transaction:async()=>{throw Error('Not used');}});
 const row={...binding,requestBody,sha256:createHash('sha256').update(requestBody).digest('hex')};
 const providerId='20000000-0000-4000-8000-000000000001';
 const tx=(snapshot,link)=>({query:async sql=>({rows:sql.includes('payment_provider_links')?(link?[{id:link}]:[]):snapshot?[snapshot]:[],rowCount:1})});
 assert.deepEqual(await store.lockKnownInTransaction(tx(row,providerId),binding.id),{...binding,requestBody,providerPaymentId:providerId});
 for(const [snapshot,link] of [[undefined,providerId],[row,undefined],[row,'../../me'],[{...row,sha256:'0'.repeat(64)},providerId]])
  await assert.rejects(store.lockKnownInTransaction(tx(snapshot,link),binding.id),PaymentIntentError);
 await assert.rejects(store.lockKnownInTransaction(tx(row,providerId),'wrong'),PaymentIntentError);
});
