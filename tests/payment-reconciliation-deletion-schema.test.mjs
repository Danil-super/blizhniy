import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBootstrapPlan} from '../scripts/postgres-migration-plan.mjs';
import {getCabinetMigrationPlan} from '../scripts/cabinet-release-plan.mjs';
import {getPaymentReconciliationRolePlan,verifyPaymentReconciliationDatabase} from '../scripts/payment-reconciliation-role.mjs';

const database='blizhniy_test';
const prefix=[...getBootstrapPlan({includeListingContactMethod:true}),...getCabinetMigrationPlan()].map(({name,sha256})=>({name,sha256}));
const deletion={name:'0033-account-deletion.sql',sha256:createHash('sha256').update(readFileSync(new URL('../database/migrations/0033-account-deletion.sql',import.meta.url))).digest('hex')};
const guardBody=getBootstrapPlan({includePaymentReconciliationRole:true}).at(-1).sql.match(/as \$\$([\s\S]*?)\$\$;/)[1];
function fixture(journal,extra=[],refundInstalled=false){
 const privileges=getPaymentReconciliationRolePlan(database,{cabinet:true}).grants.flatMap(sql=>{
  const grant=sql.match(/^grant (select|insert|update)\(([^)]+)\) on ([a-z_.]+) to /);
  return grant?grant[2].split(',').map(column=>({key:`${grant[3]}.${column}:${grant[1].toUpperCase()}`,grantable:false})):[];
 });
 return{transaction:async(work,options)=>{
  assert.deepEqual(options,{readOnly:true});
  return work({query:async sql=>{
   if(sql==='set local search_path=pg_catalog')return{rows:[]};
   if(sql==="set local statement_timeout='5s'"||sql==="set local lock_timeout='1s'")return{rows:[]};
   if(sql.includes('current_user as name'))return{rows:[{name:'blizhniy_payment_reconciler',login:'blizhniy_payment_reconciler',database,version:180006,readonly:'on',replication:'origin',rolcanlogin:true,rolconnlimit:4,connect:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false,rolreplication:false,rolbypassrls:false,membership:false,database_extra:false,replication_override:false,refund_installed:refundInstalled}]};
   if(sql==='select name,sha256 from blizhniy_meta.migrations order by name')return{rows:journal};
   if(sql.includes('select nspname as name'))return{rows:['app','blizhniy_meta','public'].map(name=>({name,usage:true,extra:false}))};
   if(sql.startsWith('select 1 from pg_parameter_acl')||sql.startsWith('with catalog_acl'))return{rows:[]};
   if(sql.includes("as key,"))return{rows:[...privileges,...extra]};
   if(sql.startsWith('select 1 from pg_class')||sql.startsWith('select 1 from pg_proc'))return{rows:[]};
   if(sql.includes('t.tgenabled,t.tgtype'))return{rows:['users','payment_checkout_intents','categories','cities','media_objects','listing_moderation'].map(name=>({name,tgenabled:'A',tgtype:19,tgnargs:0,attributes:'',unconditional:true,prosrc:guardBody,prosecdef:false,lanname:'plpgsql',proconfig:['search_path=""']}))};
   throw new Error('Unexpected verification query');
  }});
 }};
}
test('worker accepts exact32 and reviewed33 while retaining identical financial column authority',async()=>{
 assert.equal(prefix.length,32);
 assert.equal(deletion.sha256,'8d0159c6af65c4c66aabb123695110f402fd5eac268fa2a879d97c85e628ed2f');
 await verifyPaymentReconciliationDatabase(fixture(prefix),{database});
 await verifyPaymentReconciliationDatabase(fixture([...prefix,deletion]),{database});
});
test('reviewed33 does not admit changed hashes, truncated histories or a later schema',async()=>{
 const good=[...prefix,deletion];
 const cases=[good.map((row,index)=>index===32?{...row,sha256:'0'.repeat(64)}:row),good.map((row,index)=>index===0?{...row,sha256:'0'.repeat(64)}:row),good.slice(1),[...good,{name:'0034-checkout-edit-fence.sql',sha256:'1'.repeat(64)}]];
 for(const journal of cases)await assert.rejects(verifyPaymentReconciliationDatabase(fixture(journal),{database}),{message:'Payment reconciliation database preflight failed'});
});
test('reviewed33 still rejects reading deletion requests or gaining any additional financial grant',async()=>{
 for(const key of ['app.account_deletion_requests.id:SELECT','app.payment_orders.amount:UPDATE'])await assert.rejects(verifyPaymentReconciliationDatabase(fixture([...prefix,deletion],[{key,grantable:false}]),{database}),{message:'Payment reconciliation database preflight failed'});
});
test('legacy journal cannot hide installed refund objects behind the older admission branch',async()=>{
 for(const journal of [prefix,[...prefix,deletion]])await assert.rejects(verifyPaymentReconciliationDatabase(fixture(journal,[],true),{database}),{message:'Payment reconciliation database preflight failed'});
});
