import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {parseListingOwnerRemovalRequest,parseListingOwnerRemovalResult} from '../src/lib/listing-owner-removal-contract.ts';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000003',token='a'.repeat(64);
function fixture({actor=owner,blocked=true,revision='7',existing=null,lost=false}={}){
 const calls=[];let removed=existing;
 const db={transaction:async work=>{const result=await work({query:async(sql,values=[])=>{
  calls.push(sql);
  if(sql.startsWith('select u.id'))return{rows:[{id:actor,role:'user',isBlocked:false,verified:true,authVersion:'1'}],rowCount:1};
  if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rows:[],rowCount:1};
  if(sql.includes('from app.listings'))return{rows:values[1]===owner?[{id,revision,blocked}]:[],rowCount:values[1]===owner?1:0};
  if(sql.startsWith('select removed_revision'))return{rows:removed?[{revision:removed}]:[],rowCount:removed?1:0};
  if(sql.startsWith('insert into app.listing_owner_removals')){assert.equal(removed,null);removed=values[2];return{rows:[],rowCount:1};}
  throw Error('Unexpected owner-removal SQL');
 }});if(lost)throw Error('Synthetic lost acknowledgement');return result;}};
 return{store:new(load('postgres-listing-owner-removals').PostgresListingOwnerRemovalStore)(db),calls,removed:()=>removed};
}
test('owner removal request and result reject extra authority or mismatched identity/revision',()=>{
 const request={action:'remove',expectedOwnerId:owner,listingId:id,expectedRevision:'7'};
 assert.deepEqual(parseListingOwnerRemovalRequest(request),request);
 for(const input of [{...request,isPaid:false},{...request,action:'restore'},{...request,expectedRevision:7}])assert.throws(()=>parseListingOwnerRemovalRequest(input));
 assert.deepEqual(parseListingOwnerRemovalResult({id,revision:'7',removed:true},id,'7'),{id,revision:'7',removed:true});
 for(const output of [{id:other,revision:'7',removed:true},{id,revision:'8',removed:true},{id,revision:'7',removed:true,status:'draft'}])assert.throws(()=>parseListingOwnerRemovalResult(output,id,'7'));
});
test('owner removes blocked listing without changing listing, block, photo, notice or financial records',async()=>{
 const value=fixture();assert.deepEqual(await value.store.remove(token,owner,id,'7'),{id,revision:'7',removed:true});assert.equal(value.removed(),'7');
 assert.equal(value.calls.filter(sql=>sql.startsWith('insert into app.listing_owner_removals')).length,1);
 assert.doesNotMatch(value.calls.join('\n'),/(?:insert into|update|delete from) app\.(?:listings|listing_blocks|listing_photos|listing_block_mail|notifications|payment_\w+)\b/);
});
test('foreign owner, nonblocked listing and stale revision cannot be removed',async()=>{
 await assert.rejects(fixture().store.remove(token,other,id,'7'),{name:'ListingDraftAccessError'});
 await assert.rejects(fixture({actor:other}).store.remove(token,other,id,'7'),{name:'ListingDraftAccessError'});
 await assert.rejects(fixture({blocked:false}).store.remove(token,owner,id,'7'),{name:'ListingDraftAccessError'});
 await assert.rejects(fixture().store.remove(token,owner,id,'6'),{name:'ListingDraftConflictError'});
});
test('same intent is idempotent and readback after lost reply never writes again',async()=>{
 const value=fixture({lost:true});await assert.rejects(value.store.remove(token,owner,id,'7'),/Synthetic lost/);assert.equal(value.removed(),'7');
 const readback=fixture({existing:value.removed(),revision:'8'});
 assert.deepEqual(await readback.store.read(token,owner,id,'7'),{id,revision:'7',removed:true});
 assert.deepEqual(await readback.store.remove(token,owner,id,'7'),{id,revision:'7',removed:true});
 await assert.rejects(readback.store.remove(token,owner,id,'8'),{name:'ListingDraftConflictError'});
 assert.equal(readback.calls.some(sql=>sql.startsWith('insert into app.listing_owner_removals')),false);
});
test('read confirms an unapplied intent without mutating anything',async()=>{
 const value=fixture();assert.deepEqual(await value.store.read(token,owner,id,'7'),{id,revision:'7',removed:false});assert.equal(value.removed(),null);
});
