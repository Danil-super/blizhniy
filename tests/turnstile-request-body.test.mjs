import assert from 'node:assert/strict';
import test from 'node:test';
import { readTurnstileJson } from '../src/lib/turnstile-request-body.ts';
const encode=value=>new TextEncoder().encode(value);
function request(body,headers={}) { return new Request('https://example.invalid/api/turnstile/verify',{method:'POST',headers,body,...(body instanceof ReadableStream?{duplex:'half'}:{})}); }
test('public CAPTCHA accepts ordinary and escaped maximum tokens without authentication headers',async()=>{
 for(const body of [JSON.stringify({token:'synthetic-token'}),'{"token":"'+String.raw`\u0061`.repeat(2048)+'"}']){
  const value=await readTurnstileJson(request(body,{'content-type':'application/json'}));
  assert.equal(typeof value.token,'string');assert.ok(value.token.length<=2048);
 }
 assert.deepEqual(await readTurnstileJson(request('{"token":"synthetic"}')), {token:'synthetic'});
});
test('declared or actual oversized bodies fail, including absent and understated Content-Length',async()=>{
 const body=JSON.stringify({token:'x'.repeat(17000)});
 for(const headers of [{},{'content-length':'1'},{'content-length':'17000'}]) await assert.rejects(readTurnstileJson(request(body,headers)),{status:413});
 const after=await readTurnstileJson(request('{"token":"ok"}'));assert.equal(after.token,'ok');
});
test('malformed JSON, malformed UTF8 and malformed length fail without echoing content',async()=>{
 for(const [body,headers] of [['{private-invalid',{}],[new Uint8Array([0xff]),{}],['{}',{'content-length':'abc'}]])
  await assert.rejects(readTurnstileJson(request(body,headers)),error=>[400,413].includes(error.status)&&!error.message.includes('private-invalid'));
});
test('small streamed chunks and split UTF8 preserve a legitimate token',async()=>{
 const bytes=encode('{"token":"'+ 'я'.repeat(100)+'"}');let offset=0;
 const stream=new ReadableStream({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.slice(offset,++offset));}});
 assert.equal((await readTurnstileJson(request(stream))).token,'я'.repeat(100));
});
test('a stalled or uncooperative cancellation cannot extend the absolute deadline',async()=>{
 for(const cancel of [()=>undefined,()=>new Promise(()=>{})]){
  const start=performance.now();
  await assert.rejects(readTurnstileJson(request(new ReadableStream({pull(){return new Promise(()=>{});},cancel})),25),{status:408});
  assert.ok(performance.now()-start<1000);
 }
 assert.deepEqual(await readTurnstileJson(request('{}')),{});
});
test('endless empty chunks are bounded even when the timer cannot win the microtask queue',async()=>{
 let count=0;let cancelled=false;
 const stream=new ReadableStream({pull(controller){count++;controller.enqueue(new Uint8Array());},cancel(){cancelled=true;}});
 await assert.rejects(readTurnstileJson(request(stream)),error=>[408,413].includes(error.status));
 assert.ok(count<=1026);assert.equal(cancelled,true);
});
test('only16 concurrent body readers are admitted and slots recover after failures',async()=>{
 const controls=[];const pending=Array.from({length:16},()=>readTurnstileJson(request(new ReadableStream({start(c){controls.push(c);}})),500));
 try { await assert.rejects(readTurnstileJson(request('{}')),{status:429}); }
 finally {for(const control of controls)control.error(new Error('synthetic read failure'));}
 for(const result of await Promise.allSettled(pending)){assert.equal(result.status,'rejected');assert.equal(result.reason.status,400);}
 assert.deepEqual(await readTurnstileJson(request('{}')),{});
});
