import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {encodeFileRetirement,decodeFileRetirement} from '../src/lib/media-file-retirement-protocol.ts';
const record={id:randomUUID(),mimeType:'image/webp',width:16,height:9,size:128,sha256:'a'.repeat(64)};
test('retirement frame binds exact metadata and nullable attempt with a distinct bounded operation',()=>{
 for(const attemptId of [null,randomUUID()]){const frame=encodeFileRetirement(record,attemptId);assert.equal(frame.length,116);assert.deepEqual(decodeFileRetirement(frame),{record,attemptId});}
 const valid=encodeFileRetirement(record,null);
 for(const frame of [valid.subarray(1),Buffer.concat([valid,Buffer.from([0])]),Buffer.from(valid)]){
  if(frame.length===116)frame.write('BFI1');assert.throws(()=>decodeFileRetirement(frame));
 }
 const mixed=Buffer.from(valid);mixed[40]=49;assert.throws(()=>decodeFileRetirement(mixed));
 for(const bad of [{...record,id:'../escape'},{...record,size:2097153},{...record,ownerId:randomUUID()}])assert.throws(()=>encodeFileRetirement(bad,null));
});
