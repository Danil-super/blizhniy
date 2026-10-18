import assert from 'node:assert/strict';import {test} from 'node:test';
import {getWorkPublicationGrantPlan,grantWorkPublicationPermissions} from '../scripts/grant-work-publications.mjs';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
test('work grant plan is pinned to the complete migration journal and has no owner, payment, role or DDL writes',()=>{
 const plan=getWorkPublicationGrantPlan();assert.deepEqual(plan.migrations,getBootstrapPlan({includeWorkPublications:true}).map(({name,sha256})=>({name,sha256})));
 assert.equal(plan.tables.length,3);const forms=plan.tables.find(row=>row.name==='work_publications');
 assert.deepEqual(forms.update,['form','city_id','profession_id','revision','updated_at']);assert.equal(forms.delete,false);
 for(const row of plan.tables){assert.equal(row.insert.includes('is_paid'),false);assert.equal(row.update.includes('author_id'),false);assert.equal(row.update.includes('status'),false);}
});
test('work privilege operation refuses unconfirmed targets before connecting or running any SQL',async()=>{
 let calls=0;const client={connectionParameters:{host:'127.0.0.1',database:'synthetic_work'},query:async()=>{calls++;}};
 for(const target of [undefined,'','127.0.0.1:other','other:synthetic_work'])await assert.rejects(()=>grantWorkPublicationPermissions(client,target));assert.equal(calls,0);
});
