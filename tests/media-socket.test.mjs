import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createMediaSocketClient} from '../src/lib/media-socket.ts';
import {encodeMediaReply,encodeMediaFailure,MEDIA_MAX_OUTPUT_BYTES,MEDIA_REPLY_HEADER_BYTES} from '../src/lib/media-worker-protocol.ts';

async function fixture(t,reply){
 const root=await mkdtemp(join(tmpdir(),'blizhniy-socket-')),path=join(root,'decoder.sock'),seen=[];
 const sockets=new Set();
 const server=createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  const chunks=[];socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>{seen.push(Buffer.concat(chunks));reply(socket);});
 });
 server.listen(path);await once(server,'listening');
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true});});
 let validated=0;return {path,seen,client:createMediaSocketClient(path,()=>{validated++;},1000),validated:()=>validated};
}
const bytes=Buffer.from('524946460400000057454250','hex');
const image={bytes,mimeType:'image/webp',width:1,height:1,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
test('socket normalizer half-closes only its request, snapshots input and validates the bounded binary reply',async t=>{
 const f=await fixture(t,socket=>socket.end(encodeMediaReply(image)));
 const input=Buffer.from([1,2,3]);const work=f.client.normalize(input,'image/png');input.fill(9);
 const actual=await work;assert.deepEqual(actual.bytes,bytes);assert.equal(f.validated(),1);assert.deepEqual(f.seen,[Buffer.from([1,1,2,3])]);
});
test('socket normalizer rejects invalid input, malformed/error/oversized replies, closed peers and timeout',async t=>{
 for(const [name,send,code] of [
  ['malformed',s=>s.end(Buffer.from('bad')),'MEDIA_UNAVAILABLE'],
  ['worker error',s=>s.end(encodeMediaFailure('INVALID_IMAGE')),'INVALID_IMAGE'],
  ['over cap',s=>s.end(Buffer.alloc(MEDIA_MAX_OUTPUT_BYTES+MEDIA_REPLY_HEADER_BYTES+1)),'MEDIA_UNAVAILABLE'],
  ['closed',s=>s.destroy(),'MEDIA_UNAVAILABLE'],['timeout',()=>{},'MEDIA_UNAVAILABLE']]){
  await t.test(name,async t=>{const f=await fixture(t,send);await assert.rejects(f.client.normalize(Buffer.from([1]),'image/jpeg'),error=>error.code===code);});
 }
 const f=await fixture(t,s=>s.end(encodeMediaReply(image)));
 await assert.rejects(f.client.normalize(Buffer.from([1]),'image/svg+xml'),error=>error.code==='UNSUPPORTED_IMAGE');assert.equal(f.validated(),0);
});
test('a socket job holds admission until close, and cancellation never reports successful decoding',async t=>{
 let socket;const f=await fixture(t,s=>{socket=s;});const abort=new AbortController();
 const work=f.client.normalize(Buffer.from([1]),'image/jpeg',abort.signal);await new Promise(resolve=>setTimeout(resolve,30));
 await assert.rejects(f.client.normalize(Buffer.from([2]),'image/jpeg'),error=>error.code==='MEDIA_BUSY');
 abort.abort();await assert.rejects(work,error=>error.code==='MEDIA_UNAVAILABLE');socket?.destroy();
});
