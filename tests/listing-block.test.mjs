import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as contract from '../src/lib/listing-block-contract.ts';
import {blockModule} from './listing-block-module.mjs';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
test('blocking requires a bounded explicit reason, including unicode safety',()=>{
 for(const value of [null,undefined,'','  ',' reason','reason ','line\nbreak','x'.repeat(1001),'\ud800'])assert.throws(()=>contract.parseListingBlockReason(value),contract.ListingBlockInputError);
 assert.equal(contract.parseListingBlockReason('Нарушение правил: запрещённый товар'),'Нарушение правил: запрещённый товар');
});
test('management status cannot hide missing block reason or accept privileged extra fields',()=>{
 const row={id,revision:'9007199254740993',title:'Комод',status:'published',paid:true,blocked:true,blockReason:'Нарушение правил',blockedAt:'2026-10-20T10:00:00.000000Z'};
 assert.deepEqual(contract.parseListingManagementItem(row),row);
 for(const value of [{...row,blockReason:null},{...row,blocked:false},{...row,role:'admin'},{...row,revision:1},{...row,blockedAt:'bad'}])assert.throws(()=>contract.parseListingManagementItem(value));
});
test('admin listing management checks CSRF, exact actor, reason and cookie before operations',async()=>{
 const {createAdminListingManagementHandler}=blockModule('admin-listing-management-http');let calls=0;
 const handle=createAdminListingManagementHandler({origin:'https://app.example.invalid'},()=>{calls++;assert.fail('unexpected runtime');},()=>{});
 const input={action:'block',expectedAdminId:actor,listingId:id,expectedRevision:'1',reason:'Нарушение правил'};
 const request=(body=input,headers={})=>new Request('https://app.example.invalid/api/admin/listing-management',{method:'POST',headers:{host:'app.example.invalid',origin:'https://app.example.invalid','content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+'a'.repeat(64),...headers},body:JSON.stringify(body)});
 for(const [body,headers,status] of [[input,{origin:'https://evil.invalid'},403],[input,{cookie:'',authorization:'Bearer legacy'},401],[{...input,reason:''},{},422],[{...input,ownerId:id},{},422],[{...input,expectedRevision:1},{},422]])assert.equal((await handle(request(body,headers))).status,status);
 assert.equal(calls,0);
});
test('block request has one uncertain write, safe private response and PII-free audit',async()=>{
 const {createAdminListingManagementHandler}=blockModule('admin-listing-management-http');let calls=0;const events=[];
 const handle=createAdminListingManagementHandler({origin:'https://app.example.invalid'},()=>({limiter:{allowProduction:async()=>true},store:{block:async(...args)=>{assert.deepEqual(args,['a'.repeat(64),actor,id,'1','Нарушение правил']);calls++;throw Error('private-database-secret');}}}),event=>events.push(event));
 const response=await handle(new Request('https://app.example.invalid/api/admin/listing-management',{method:'POST',headers:{host:'app.example.invalid',origin:'https://app.example.invalid','content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+'a'.repeat(64)},body:JSON.stringify({action:'block',expectedAdminId:actor,listingId:id,expectedRevision:'1',reason:'Нарушение правил'})}));
 assert.equal(calls,1);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{error:{code:'MANAGEMENT_UNAVAILABLE'}});
 for(const secret of [actor,id,'a'.repeat(64),'Нарушение правил','private-database-secret'])assert.equal(JSON.stringify(events).includes(secret),false);
});
