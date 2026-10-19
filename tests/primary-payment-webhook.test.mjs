import assert from 'node:assert/strict';import {test} from 'node:test';
import {createPrimaryPaymentWebhook,isYooKassaNotificationIp} from '../src/lib/primary-payment-webhook.ts';
const origin='https://webhook.example.invalid',id='11111111-1111-4111-8111-111111111111',payload={type:'notification',event:'payment.succeeded',object:{id,status:'succeeded',amount:{value:'999.99',currency:'RUB'},metadata:{role:'admin'},receipt:{email:'private@example.invalid'}}};
function request(body=payload,headers={},method='POST',query=''){return new Request(origin+'/api/payments/yookassa/primary-webhook'+query,{method,headers:{host:'webhook.example.invalid','x-real-ip':'185.71.76.1','content-type':'application/json',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});}
test('webhook sender allowlist covers documented IPv4/IPv6 boundaries, never XFF, CF headers, private or adjacent addresses',()=>{
 for(const ip of ['185.71.76.0','185.71.76.31','185.71.77.31','77.75.153.127','77.75.156.11','77.75.156.35','77.75.154.128','77.75.154.255','2a02:5180::1','2a02:5180:ffff:ffff:ffff:ffff:ffff:ffff','::ffff:185.71.76.1'])assert.equal(isYooKassaNotificationIp(ip),true,ip);
 for(const ip of ['',undefined,'127.0.0.1','192.168.0.1','185.71.76.32','185.71.75.255','77.75.153.128','77.75.154.127','77.75.156.12','2a02:5181::1','2a02:517f:ffff::1','185.71.76.1, 192.0.2.1','[2a02:5180::1]','2a02:5180::1%lo'])assert.equal(isYooKassaNotificationIp(ip),false,String(ip));
});
test('webhook admits only a bounded provider-ID hint from trusted ingress; malformed input never opens runtime',async()=>{
 let calls=0;const handle=createPrimaryPaymentWebhook({origin},()=>{calls++;assert.fail();},()=>{});
 for(const [body,headers,method,status,query] of [[payload,{},'GET',405],[payload,{'x-real-ip':'192.0.2.1','x-forwarded-for':'185.71.76.1','cf-connecting-ip':'185.71.76.1'},'POST',403],[payload,{host:'foreign.invalid'},'POST',403],[payload,{},'POST',400,'?key=secret'],[payload,{'content-length':'65537'},'POST',413],[payload,{'content-type':'text/plain'},'POST',415],['{',{},'POST',400],[{...payload,event:'refund.succeeded'}, {},'POST',400],[{...payload,event:['payment.succeeded']},{},'POST',400],[{...payload,object:{id:'https://evil.invalid'}},{},'POST',400]]){
  const response=await handle(request(body,headers,method,query));assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 }assert.equal(calls,0);
});
test('webhook bounds bytes/chunks/UTF8 and a hanging reader including non-settling cancellation',{timeout:5000},async()=>{
 const handle=createPrimaryPaymentWebhook({origin},()=>assert.fail('body must fail before runtime'),()=>{});
 for(const [body,status] of [[new Uint8Array([255]),400],['x'.repeat(65537),413]]){
  const response=await handle(new Request(origin,{method:'POST',headers:{host:'webhook.example.invalid','x-real-ip':'185.71.76.1','content-type':'application/json'},body}));assert.equal(response.status,status);
 }
 let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}});
 const streaming=new Request(origin,{method:'POST',headers:{host:'webhook.example.invalid','x-real-ip':'185.71.76.1','content-type':'application/json'},body:stream,duplex:'half'});
 assert.equal((await handle(streaming)).status,413);assert.equal(cancelled,true);
 const hanging=new Request(origin,{method:'POST',headers:{host:'webhook.example.invalid','x-real-ip':'185.71.76.1','content-type':'application/json'},body:new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),duplex:'half'});
 assert.equal((await handle(hanging)).status,408);
});
test('webhook200 means durable queue admission, not sender-provided payment truth; unknown/failed COMMIT returns503 and never retries',async()=>{
 const calls=[],events=[],handle=createPrimaryPaymentWebhook({origin},()=>({enqueue:async value=>{calls.push(value);return true;}}),event=>events.push(event));
 assert.deepEqual(await (await handle(request())).json(),{ok:true});assert.deepEqual(calls,[id]);assert.equal(events.length,1);
 for(const secret of [id,'999.99','private@example.invalid','admin'])assert.equal(JSON.stringify(events).includes(secret),false);
 for(const result of [false,Error('private SQL password')]){
  let attempts=0;const handle=createPrimaryPaymentWebhook({origin},()=>({enqueue:async()=>{attempts++;if(result instanceof Error)throw result;return result;}}),()=>{});
  const response=await handle(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:{code:'WEBHOOK_UNAVAILABLE'}});assert.equal(attempts,1);
 }
});
