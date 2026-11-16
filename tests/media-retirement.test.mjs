import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {loadMediaModule} from './media-module.mjs';
const {LocalMediaRetirement}=loadMediaModule('media-retirement');
const record={id:randomUUID(),mimeType:'image/webp',width:1,height:1,size:12,sha256:'a'.repeat(64)},operationId=randomUUID();
test('completion is never called when the fenced file operation has no verified close',async()=>{
 let transactions=0;
 const db={transaction:async()=>{transactions++;return{record,operationId,attemptId:null};}};
 const cleanup=new LocalMediaRetirement(db,{retire:async claim=>{await claim();throw Error('lost child ACK');}});
 await assert.rejects(cleanup.retire(record.id),{code:'MEDIA_RETIREMENT_UNAVAILABLE'});assert.equal(transactions,1);
});
test('lost completion outcome remains unknown without a retry or accounting compensation',async()=>{
 let transactions=0;
 const db={transaction:async()=>{if(++transactions===1)return{record,operationId,attemptId:null};throw Error('lost completion COMMIT');}};
 const cleanup=new LocalMediaRetirement(db,{retire:claim=>claim()});
 await assert.rejects(cleanup.retire(record.id),error=>error.code==='MEDIA_RETIREMENT_UNAVAILABLE'&&error.message==='Media retirement unavailable'&&!error.cause);assert.equal(transactions,2);
});
test('invalid identifiers and non-test runtimes cannot acquire cleanup authority',async()=>{
 let entered=0;const cleanup=new LocalMediaRetirement({transaction:()=>assert.fail('no database access')},{retire:async()=>{entered++;}});
 for(const id of ['../escape','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',null])await assert.rejects(cleanup.retire(id),{code:'INVALID_MEDIA_RETIREMENT'});assert.equal(entered,0);
 for(const environment of [{env:{NODE_ENV:'production'}},{env:{}},{browser:true},{platform:'win32'}])assert.throws(()=>new(loadMediaModule('media-retirement',environment).LocalMediaRetirement)({},{}),{code:'MEDIA_RETIREMENT_UNAVAILABLE'});
});
