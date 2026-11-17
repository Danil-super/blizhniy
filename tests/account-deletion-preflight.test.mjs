import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deletionPreflightFields,classifyDeletionPreflight,inspectAccountDeletionCase} from '../src/lib/account-deletion-preflight.ts';

const empty=()=>Object.fromEntries(deletionPreflightFields.map(key=>[key,'0']));
test('an empty operational plan never authorizes deletion or assigns a retention period',()=>{
 const result=classifyDeletionPreflight(empty(),'user');
 assert.equal(result.decision,'no-operational-blocker');assert.equal(result.executionAuthorized,false);
 assert.deepEqual(result.blockers,[]);assert.deepEqual(result.retentionReview,[]);
});
test('every unfinished operation routes the case to manual review independently of storage categories',()=>{
 for(const field of ['openPayments','openRefunds','openCompensations','openBookings','openUploads','openMail']){
  const result=classifyDeletionPreflight({...empty(),[field]:'1',payments:'1'},'user');
  assert.equal(result.decision,'manual-review');assert.equal(result.blockers.length,1);assert.equal(result.blockers[0].count,'1');assert.equal(result.executionAuthorized,false);
 }
 assert.equal(classifyDeletionPreflight(empty(),'admin').decision,'manual-review');
});
test('finished financial, cross-party, publication, media and audit records still require a storage decision',()=>{
 for(const field of ['payments','refunds','compensations','applications','bookings','publications','media','externalAudit']){
  const result=classifyDeletionPreflight({...empty(),[field]:'2'},'user');assert.equal(result.decision,'storage-policy-review');assert.equal(result.retentionReview.length,1);
 }
 assert.equal(classifyDeletionPreflight({...empty(),profiles:'1',sessions:'2',caseAudit:'1',authRecords:'3'},'user').decision,'no-operational-blocker');
});
test('unknown or inexact counts never produce an empty successful plan',()=>{
 for(const value of [null,{},[],{...empty(),extra:'1'},{...empty(),payments:1},{...empty(),payments:'-1'},{...empty(),payments:'01'},{...empty(),payments:'9223372036854775808'}])assert.throws(()=>classifyDeletionPreflight(value,'user'));
 assert.throws(()=>classifyDeletionPreflight(empty(),'other'));
 assert.throws(()=>classifyDeletionPreflight(empty(),{toString:()=> 'user'}));
 assert.equal(classifyDeletionPreflight({...empty(),payments:'9223372036854775807'},'user').decision,'storage-policy-review');
});
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
test('inspection refuses a writable/nonrepeatable transaction and changed or unavailable cases before counting data',async()=>{
 for(const context of [{readonly:'off',isolation:'repeatable read'},{readonly:'on',isolation:'read committed'}]){
  let calls=0;await assert.rejects(inspectAccountDeletionCase({query:async()=>{calls++;return{rows:[context]};}},id,'1'));assert.equal(calls,1);
 }
 for(const row of [null,{id,revision:'2',status:'requested',subjectId:owner},{id,revision:'1',status:'resolved',subjectId:owner}]){
  let calls=0;const tx={query:async()=>({rows:++calls===1?[{readonly:'on',isolation:'repeatable read'}]:row?[row]:[]})};
  await assert.rejects(inspectAccountDeletionCase(tx,id,'1'));assert.equal(calls,2);
 }
 let calls=0;await assert.rejects(inspectAccountDeletionCase({query:async()=>{calls++;}},id+'\n','1'));assert.equal(calls,0);
});
