import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRefundActionDrafts} from '../src/lib/refund-action-draft.ts';
const actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const command={action:'approve',expectedAdminId:actor,input:{id,paymentIntentId:id,reason:'Возврат по обращению.'}};
function memory(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
test('uncertain refund IDs survive reload, are actor scoped and cannot be replaced until acknowledged',()=>{
 const storage=memory(),drafts=createRefundActionDrafts(storage);assert.equal(drafts.read(actor),null);assert.deepEqual(drafts.save(actor,command),command);
 assert.deepEqual(createRefundActionDrafts(storage).read(actor),command);assert.equal(drafts.read(other),null);
 assert.throws(()=>drafts.save(actor,{...command,input:{...command.input,id:other}}));assert.throws(()=>drafts.clear(actor,other));assert.deepEqual(drafts.read(actor),command);
 assert.deepEqual(drafts.save(actor,command),command);drafts.clear(actor,id);assert.equal(drafts.read(actor),null);
 assert.throws(()=>drafts.save(other,command));
});
test('blocked, malformed, failed or silently dropped browser storage does not permit new financial action',()=>{
 const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{},removeItem:()=>{}};assert.throws(()=>createRefundActionDrafts(blocked).save(actor,command));
 const dropped={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};assert.throws(()=>createRefundActionDrafts(dropped).save(actor,command));
 const storage=memory();storage.setItem('blizhniy-refund-action:'+actor,'{invalid');const drafts=createRefundActionDrafts(storage);assert.throws(()=>drafts.read(actor));assert.throws(()=>drafts.save(actor,command));
 storage.setItem('blizhniy-refund-action:'+actor,JSON.stringify({...command,expectedAdminId:other}));assert.throws(()=>drafts.read(actor));
});
