import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formModule} from './listing-form-module.mjs';
const owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002';
const {PostgresListingOwnerActions}=formModule('postgres-listing-owner-actions');
function fixture({blocked=false,live=true,status='published',revision='1',financial='succeeded'}={}){
 const calls=[];
 const db={transaction:async work=>work({query:async(sql,values)=>{
  calls.push(sql);
  if(sql.startsWith('select u.id'))return{rows:[{id:owner,role:'user',isBlocked:false,verified:true,authVersion:'1'}],rowCount:1};
  if(sql.startsWith('select token_hash')||sql.startsWith('update app.sessions'))return{rows:[],rowCount:1};
  if(sql.includes('from app.payment_checkout_intents'))return{rows:[{id}],rowCount:1};
  if(sql.includes('from app.payment_orders'))return{rows:[{status:financial}],rowCount:1};
  if(sql.includes('from app.listings'))return{rows:[{id,revision,status,live,blocked}],rowCount:1};
  if(sql.startsWith('update app.listings'))return{rows:[{id,revision:'2',status:values[3]}],rowCount:1};
  throw Error('Unexpected owner action SQL');
 }})};return{store:new PostgresListingOwnerActions(db),calls};
}
test('owner can withdraw and restore without changing payment or expiry',async()=>{
 for(const [status,action,expected] of [['published','withdraw','archived'],['archived','restore','published']]){
  const f=fixture({status});assert.deepEqual(await f.store.change('a'.repeat(64),owner,id,'1',action),{id,revision:'2',status:expected});
  const update=f.calls.find(sql=>sql.startsWith('update app.listings'));
  assert.ok(update);assert.equal(/set[^]*\b(is_paid|expires_at|published_at)\s*=/.test(update),false);
 }
});
test('a historical receipt never restores a refunded order',async()=>{
 await assert.rejects(fixture({status:'archived',financial:'refunded'}).store.change('a'.repeat(64),owner,id,'1','restore'));
});
test('foreign owner, stale revision, block, expiry and unsupported transition are denied',async()=>{
 await assert.rejects(fixture().store.change('a'.repeat(64),id,id,'1','withdraw'));
 for(const input of [{blocked:true},{live:false},{status:'draft'},{revision:'2'}])await assert.rejects(fixture(input).store.change('a'.repeat(64),owner,id,'1','withdraw'));
 await assert.rejects(fixture().store.change('a'.repeat(64),owner,id,'1','publish-free'));
});
