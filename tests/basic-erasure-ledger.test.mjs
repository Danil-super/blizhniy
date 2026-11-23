import assert from'node:assert/strict';import{test}from'node:test';import{randomBytes,randomUUID,createHash}from'node:crypto';
import{sealBasicErasureLedger,verifyBasicErasureLedger,reapplyBasicErasureLedger}from'../scripts/basic-erasure-ledger.mjs';
const key=randomBytes(32),sourceId=randomUUID();
const record=()=>({operationId:randomUUID(),requestId:randomUUID(),subjectId:randomUUID(),actorId:randomUUID(),authVersion:'0',requestRevision:'1',completedAt:'2026-11-17T10:00:00.000Z'});
const checkpoint=document=>({sourceId,sha256:createHash('sha256').update(document).digest('hex')});
test('signed ledger binds the exact canonical document to an independently trusted source/checkpoint',()=>{
 const row=record(),sealed=sealBasicErasureLedger([row],key,sourceId),payload=verifyBasicErasureLedger(sealed,key,checkpoint(sealed));assert.deepEqual(payload.records,[row]);assert.equal(payload.sourceId,sourceId);
 assert.equal(sealed.includes(key.toString('hex')),false);
 for(const [document,secret,head]of [[sealed,randomBytes(32),checkpoint(sealed)],[sealed,key,{...checkpoint(sealed),sourceId:randomUUID()}],[sealed+'\n',key,checkpoint(sealed)],['{}',key,checkpoint('{}')]])assert.throws(()=>verifyBasicErasureLedger(document,secret,head));
});
test('tampering, duplicate fields, old valid snapshots and record truncation cannot reuse the current checkpoint',()=>{
 const a=record(),b=record(),old=sealBasicErasureLedger([a],key,sourceId),current=sealBasicErasureLedger([a,b],key,sourceId),head=checkpoint(current);
 assert.throws(()=>verifyBasicErasureLedger(old,key,head));
 const forged=JSON.parse(current);forged.payload.records[0].subjectId=randomUUID();const text=JSON.stringify(forged);assert.throws(()=>verifyBasicErasureLedger(text,key,checkpoint(text)));
 const duplicate=current.replace('"version":1','"version":1,"version":1');assert.throws(()=>verifyBasicErasureLedger(duplicate,key,checkpoint(duplicate)));
 const privateText='private@example.invalid';assert.throws(()=>verifyBasicErasureLedger(privateText,key,checkpoint(privateText)),error=>error.name==='ErasureLedgerValidationError'&&!error.message.includes(privateText));
});
test('ledger rejects duplicate identities, invalid counts/versions, unknown fields and unbounded inputs',()=>{
 const a=record();for(const rows of [Array(1),[a,a],[a,{...record(),subjectId:a.subjectId}],[a,{...record(),requestId:a.requestId}],[{...a,email:'private@example.invalid'}],[{...a,authVersion:'01'}],[{...a,completedAt:'yesterday'}],Array.from({length:1001},record)])assert.throws(()=>sealBasicErasureLedger(rows,key,sourceId));
 assert.throws(()=>sealBasicErasureLedger([a],Buffer.alloc(1),sourceId));assert.throws(()=>verifyBasicErasureLedger('x'.repeat(2097153),key,checkpoint('x')));
});
test('version 2 signs the exact set of retired photos for each operation',()=>{
 const mediaIds=[randomUUID(),randomUUID()].sort(),row={...record(),mediaIds:[...mediaIds].reverse()};
 const sealed=sealBasicErasureLedger([row],key,sourceId,2),head=checkpoint(sealed);
 assert.deepEqual(verifyBasicErasureLedger(sealed,key,head).records,[{...row,mediaIds}]);
 const forged=sealed.replace(mediaIds[0],randomUUID());
 assert.throws(()=>verifyBasicErasureLedger(forged,key,checkpoint(forged)));
 for(const records of [[{...row,mediaIds:[mediaIds[0],mediaIds[0]]}],[row,{...record(),mediaIds}],[record()]]){
  assert.throws(()=>sealBasicErasureLedger(records,key,sourceId,2));
 }
 assert.throws(()=>sealBasicErasureLedger([row],key,sourceId));
});
test('replay authenticates the entire ledger and all actor sessions before opening the database',async()=>{
 let touched=false;const db={transaction:async()=>{touched=true;throw Error('Do not connect');}},row=record(),sealed=sealBasicErasureLedger([row],key,sourceId),old=process.env.NODE_ENV;process.env.NODE_ENV='test';
 try{await assert.rejects(reapplyBasicErasureLedger(db,sealed,key,checkpoint(sealed),new Map(),'0'.repeat(64)));assert.equal(touched,false);await assert.rejects(reapplyBasicErasureLedger(db,sealed,key,{...checkpoint(sealed),sha256:'0'.repeat(64)},new Map([[row.actorId,'a'.repeat(64)]]),'0'.repeat(64)));assert.equal(touched,false);}finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});
test('a well-formed but invalid second actor session fails read-only preflight before either erasure',async()=>{
 const rows=[record(),record()],document=sealBasicErasureLedger(rows,key,sourceId),ordered=verifyBasicErasureLedger(document,key,checkpoint(document)).records;let writes=0,checks=0;
 const db={readTransaction:work=>work({query:async(sql,values)=>({rows:sql.includes('current_database')?[{database:'blizhniy_erasure_test',readonly:'on',isolation:'repeatable read'}]:[{allowed:++checks===1&&values[1]===ordered[0].actorId}]})}),transaction:async()=>{writes++;}};
 const before=process.env.NODE_ENV;process.env.NODE_ENV='test';try{await assert.rejects(reapplyBasicErasureLedger(db,document,key,checkpoint(document),new Map(ordered.map(row=>[row.actorId,'a'.repeat(64)])),'0'.repeat(64)));assert.equal(checks,2);assert.equal(writes,0);}finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;}
});
