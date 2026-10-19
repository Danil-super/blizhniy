import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import * as http from '../src/lib/auth-http.ts';import {formModule} from './listing-form-module.mjs';
test('primary webhook defaults off before credentials/pool; separate TEST gate does not depend on admitting new checkouts',async()=>{
 let auth=0,pools=0;const observed=[];
 const {handlePrimaryPaymentWebhook}=formModule('primary-payment-webhook-runtime',{
  './auth-http':http,'./production-auth-config':{readProductionAuthConfig:()=>{auth++;return{origin:'https://site.example.invalid'};}},
  './production-auth-runtime':{getProductionAccountDatabase:async()=>{pools++;return{db:{}};}},
  './postgres-payment-reconciliation.ts':{PostgresPaymentReconciliationQueue:class{constructor(_db,scope){observed.push(scope);}}},
  './primary-payment-webhook.ts':{createPrimaryPaymentWebhook:(_config,runtime)=>async()=>{await runtime();return Response.json({ok:true});}},
 });
 const names=['BLIZHNIY_PAYMENT_WEBHOOK','BLIZHNIY_PAYMENT_SHOP_ID','BLIZHNIY_PAYMENT_MODE','BLIZHNIY_LISTING_CHECKOUT'],before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  delete process.env.BLIZHNIY_PAYMENT_WEBHOOK;assert.equal((await handlePrimaryPaymentWebhook(new Request('https://site.example.invalid'))).status,503);assert.equal(auth,0);assert.equal(pools,0);
  process.env.BLIZHNIY_PAYMENT_WEBHOOK='queued-test';process.env.BLIZHNIY_PAYMENT_SHOP_ID='fixture-shop';process.env.BLIZHNIY_PAYMENT_MODE='live';
  assert.equal((await handlePrimaryPaymentWebhook(new Request('https://site.example.invalid'))).status,503);assert.equal(pools,0);
  process.env.BLIZHNIY_PAYMENT_MODE='test';process.env.BLIZHNIY_LISTING_CHECKOUT='disabled';
  assert.equal((await handlePrimaryPaymentWebhook(new Request('https://site.example.invalid'))).status,200);assert.equal(pools,1);assert.deepEqual(observed,[{shopId:'fixture-shop',isTest:true}]);
 }finally{for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}}
});
test('old webhook refuses postgres/unknown auth modes before old storage or provider calls',async()=>{
 const ts=createRequire(import.meta.url)('typescript'),source=readFileSync(new URL('../src/app/api/payments/yookassa/webhook/route.ts',import.meta.url),'utf8');
 for(const mode of ['postgres','unknown']){
  const exports={};new Function('require','exports','process',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
   if(name==='next/server')return{NextResponse:{json:Response.json}};
   if(name==='@/lib/payment-provider')return{processYooKassaNotification:()=>assert.fail('legacy provider')};
   if(name==='@/lib/supabase-rest')return{isSupabaseServiceRoleConfigured:()=>assert.fail('legacy storage')};
   throw Error('Unapproved route test dependency');
  },exports,{env:{BLIZHNIY_AUTH_MODE:mode}});
  assert.equal((await exports.POST({json:()=>assert.fail('body must not be read')})).status,503);
 }
});
