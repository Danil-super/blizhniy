import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const scriptUrl=new URL('../scripts/apply-local-application-withdrawals.mjs',import.meta.url);
const extras=()=>['0026-listing-blocks.sql','0027-listing-owner-visibility.sql','0028-listing-restore-entitlement.sql','0029-listing-owner-removals.sql'].map(name=>{
 const source=readFileSync(new URL(`../database/migrations/${name}`,import.meta.url),'utf8');
 return{name,source,sha256:createHash('sha256').update(source).digest('hex')};
});

test('operator manifest reads 0030 bytes and deduplicates identical fixture registration',async()=>{
 const {getApplicationWithdrawalPlan}=await import(scriptUrl);
 const plan=getApplicationWithdrawalPlan(extras());
 assert.equal(plan.migrations.length,30);
 assert.equal(plan.migration.name,'0030-application-withdrawals.sql');
 assert.equal(plan.migration.sha256,createHash('sha256').update(plan.migration.source).digest('hex'));
 assert.deepEqual(getApplicationWithdrawalPlan([...extras(),plan.migration]),plan);
});

test('operator manifest rejects conflicting duplicate migration or unexpected history',async()=>{
 const {getApplicationWithdrawalPlan}=await import(scriptUrl);
 const plan=getApplicationWithdrawalPlan(extras());
 assert.throws(()=>getApplicationWithdrawalPlan([...extras(),{...plan.migration,sha256:'0'.repeat(64)}]));
 assert.throws(()=>getApplicationWithdrawalPlan(extras().slice(1)));
 assert.throws(()=>getApplicationWithdrawalPlan([...extras(),{name:'0031-unexpected.sql',sha256:'0'.repeat(64)}]));
});

test('operator validates private owned target and rejects runtime role escalation before mutation',()=>{
 const source=readFileSync(scriptUrl,'utf8');
 for(const required of ['readLocalPrimaryState(stateFile,process.cwd())','validateLocalPrimaryContainer','pg_auth_members','rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','begin read only','pg_advisory_xact_lock(187924,30)'])assert.ok(source.includes(required),required);
 assert.match(source,/journal\.length===29\|\|journal\.length===30/);
 assert.match(source,/assert\.deepEqual\(journal,plan\.migrations\.slice\(0,journal\.length\)\)/);
 assert.doesNotMatch(source,/prepareLocalPrimaryFixture|initializeLocalPrimarySchema|bootstrapPostgres\(/);
});

test('operator grants only marker read and three input columns inside apply transaction',()=>{
 const source=readFileSync(scriptUrl,'utf8');
 assert.match(source,/grant select on app\.application_withdrawals to blizhniy_runtime;grant insert\(application_id,owner_id,withdrawn_revision\) on app\.application_withdrawals to blizhniy_runtime/);
 assert.match(source,/if\(apply\)\{[\s\S]+pg_advisory_xact_lock\(187924,30\)/);
 assert.match(source,/if\(apply\)\{[\s\S]+owner\.query\(grants\)/);
 assert.match(source,/if\(!apply\)[\s\S]+willApply:false/);
 assert.match(source,/owner\.query\('rollback'\)/);
 assert.doesNotMatch(source,/grant\s+(?:update|delete|all|usage)|create role|alter role|grant[^\n]+payment_/i);
 assert.doesNotMatch(source,/console\.(?:log|error)\([^\n]*(?:state\.(?:ownerPassword|runtimePassword|rateSecret)|migration\.source)/);
});
