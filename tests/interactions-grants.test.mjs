import assert from 'node:assert/strict';import {test} from 'node:test';
import {getInteractionGrantPlan} from '../scripts/grant-interactions.mjs';
import {applyRestrictedTableGrants} from '../scripts/operator-table-grants.mjs';
test('interaction grants pin eighteen migrations and never confer finance, identity or hard-deletion authority',()=>{
 const plan=getInteractionGrantPlan();assert.equal(plan.migrations.length,18);assert.equal(plan.tables.length,3);
 const [applications,bookings,notifications]=plan.tables;assert.equal(applications.name,'applications');assert.equal(bookings.name,'booking_requests');assert.equal(notifications.name,'notifications');
 for(const table of plan.tables){assert.equal(table.delete,false);for(const field of ['id','is_paid','sent_at','created_at','author_id','user_id','guest_id','applicant_id','work_publication_id','listing_id','creation_key'])assert.equal(table.update.includes(field),false);}
 for(const field of ['status','is_paid','sent_at','created_at'])assert.equal(applications.insert.includes(field),false);
 assert.deepEqual(bookings.update,['status','decided_at','revision','updated_at']);assert.deepEqual(notifications.update,['read_at','dismissed_at']);
});
test('operator grant helper rejects malformed SQL identifiers before any query',async()=>{
 let queries=0;const client={connectionParameters:{host:'127.0.0.1',database:'owned'},query:async()=>{queries++;throw Error('No query permitted');}},plan=getInteractionGrantPlan();
 for(const table of [{...plan.tables[0],name:'applications; select 1'}, {...plan.tables[0],insert:['bad)']},{...plan.tables[0],update:['status','status']}]){
  await assert.rejects(applyRestrictedTableGrants(client,'127.0.0.1:owned',{...plan,tables:[table]}));
 }
 assert.equal(queries,0);
});
