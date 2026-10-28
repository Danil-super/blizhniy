const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
class Access extends Error{}class Conflict extends Error{}class Eligibility extends Error{}class Busy extends Error{}
function fixture(failure){
 const exports={},intent={targetType:'application',shopId:'local-fixture-shop',isTest:true,durationDays:null,tariffId:'job-response',ownerId:'owner',providerPaymentId:'provider'};
 const tx={query:async sql=>sql.startsWith('select id,is_blocked')?{rows:[{id:'owner',blocked:false,verified:true}]}:sql.startsWith('select status from app.payment_orders')?{rows:[{status:'succeeded'}]}:sql.startsWith('select intent_id from local_primary')?{rowCount:0,rows:[]}:sql.startsWith('select status,captured_at')?{rows:[{status:'succeeded',capturedAt:'captured',providerId:'provider'}]}:assert.fail('Unexpected query')};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/postgres-application-fulfillment.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','process',code)(name=>{
  if(name==='./postgres-payment-intents')return{PostgresPaymentIntentStore:class{async lockKnownInTransaction(){return intent;}}};
  if(name==='./postgres-applications')return{PostgresApplicationStore:class{async inspectCheckoutInTransaction(){throw failure;}},ApplicationConflictError:Conflict,ApplicationAccessError:Access,ApplicationEligibilityError:Eligibility};
  if(name==='./postgres-public-work')return{PostgresPublicWorkStore:class{}};
  if(name==='./postgres-notification-inbox')return{enqueueNotificationInTransaction:()=>assert.fail('Must not enqueue')};
  if(name==='./listing-workflow-config')return{readPostmoderationEnabled:()=>true};
  if(name==='./listing-draft-contract.ts')return{parseListingDraftId:value=>value};
  throw Error('Unexpected dependency '+name);
 },exports,{env:{NODE_ENV:'test'}});
 return new exports.PostgresApplicationFulfillmentStore({transaction:work=>work(tx)});
}
for(const [label,ErrorType] of [['access',Access],['revision',Conflict],['eligibility',Eligibility]])test(`fulfillment reports a genuine ${label} conflict as unavailable content`,async()=>{
 assert.deepEqual(await fixture(new ErrorType()).fulfill('id'),{state:'blocked',reason:'application_or_target_changed'});
});
for(const failure of [new Busy(),Object.assign(new Error('Lock unavailable'),{code:'55P03'}),Object.assign(new Error('Database failed'),{code:'XX000'})])test(`fulfillment propagates retryable ${failure.constructor.name}/${failure.code||'busy'} instead of committing an aborted transaction`,async()=>{
 await assert.rejects(fixture(failure).fulfill('id'),error=>error===failure);
});
