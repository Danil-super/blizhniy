import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const actor='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),id='33333333-3333-4333-8333-333333333333';
test('refund journal requires a live administrator and matching actor before querying private payments',async()=>{
 const {PostgresAdminRefundJournal}=load('postgres-admin-refund-journal');let sourceReads=0;
 const db={transaction:async work=>work({query:async sql=>{
  if(sql.includes('from app.users u'))return{rows:[{id:actor,role:'user',isBlocked:false,verified:true,authVersion:'0'}]};
  sourceReads++;throw Error('Unexpected financial query');
 }})};
 const journal=new PostgresAdminRefundJournal(db,{shopId:'synthetic',isTest:true});
 await assert.rejects(journal.list(token,actor,null));assert.equal(sourceReads,0);
 assert.throws(()=>journal.list(token,'invalid',null));assert.equal(sourceReads,0);
 assert.throws(()=>journal.list(token,actor,'invalid'));assert.equal(sourceReads,0);
 assert.throws(()=>new PostgresAdminRefundJournal(db,{shopId:'synthetic',isTest:false}));
});
test('refund journal pages raw scoped rows without receipts/session/PII and rejects a foreign cursor',async()=>{
 const {PostgresAdminRefundJournal}=load('postgres-admin-refund-journal');const queries=[];
 const row={id,targetType:'listing',targetId:id,amount:'199.00',createdAt:'2026-11-12T10:00:00.000000Z',status:'succeeded',capturedAt:'2026-11-12T10:01:00Z',operationId:null,attempted:false,approvalId:null,reason:null,approvedAt:null,providerRefundId:null,refundStatus:null,appliedAt:null};
 let wrongCursor=false;
 const db={transaction:async work=>work({query:async(sql,args)=>{
  queries.push([sql,args]);
  if(sql.includes('from app.users u'))return{rows:[{id:actor,role:'admin',isBlocked:false,verified:true,authVersion:'0'}]};
  if(sql.includes('select token_hash'))return{rowCount:1,rows:[]};
  if(sql.includes('update app.sessions'))return{rowCount:1,rows:[]};
  if(sql.includes('as "createdAt" from app.payment_checkout_intents'))return{rows:wrongCursor?[]:[{createdAt:row.createdAt}]};
  return{rows:Array.from({length:51},(_,i)=>({...row,id: String(i+1).padStart(8,'0')+'-3333-4333-8333-333333333333'}))};
 }})};
 const journal=new PostgresAdminRefundJournal(db,{shopId:'synthetic',isTest:true});
 const page=await journal.list(token,actor,null);assert.equal(page.items.length,50);assert.equal(page.nextAfter,page.items.at(-1).id);
 const query=queries.find(([sql])=>sql.includes('limit 51'));assert.ok(query);assert.deepEqual(query[1],['synthetic',null,null]);
 for(const forbidden of ['request_body','token_hash','password','email','owner_id'])assert.equal(query[0].includes(forbidden),false);
 wrongCursor=true;await assert.rejects(journal.list(token,actor,id));
});
