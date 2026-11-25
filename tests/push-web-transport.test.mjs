import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import webPush from 'web-push';
import {createWebPushTransport} from '../src/lib/push-web-transport.ts';

const vapid={subject:'https://synthetic.example.invalid',...webPush.generateVAPIDKeys()};
const job={id:randomUUID(),endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-endpoint',
 p256dh:webPush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url'),ttl:180};

test('delivery revalidates stored addresses and keys and never follows a provider redirect',async()=>{
 const seen=[];
 const transport=createWebPushTransport(vapid,async(url,options)=>{
  seen.push({url,redirect:options.redirect});
  return new Response(null,{status:308,headers:{Location:'https://synthetic.example.invalid/other'}});
 });
 assert.deepEqual(await transport({...job,endpoint:'https://synthetic.example.invalid/other'}),{code:'gone',delay:0});
 assert.deepEqual(await transport({...job,auth:'malformed'}),{code:'gone',delay:0});
 assert.deepEqual(seen,[]);
 assert.deepEqual(await transport(job),{code:'rejected',delay:0});
 assert.deepEqual(seen,[{url:job.endpoint,redirect:'manual'}]);
 assert.throws(()=>createWebPushTransport({...vapid,publicKey:job.p256dh}),/Invalid Web Push configuration/);
});

test('only explicit throttling retries and expiry responses invalidate the exact device',async()=>{
 let response;
 const transport=createWebPushTransport(vapid,async()=>response);
 for(const [status,code] of [[201,'accepted'],[403,'rejected'],[404,'gone'],[410,'gone'],[503,'unknown']]){
  response=new Response(null,{status});
  assert.deepEqual(await transport(job),{code,delay:0});
 }
 response=new Response(null,{status:429,headers:{'Retry-After':'malformed'}});
 assert.deepEqual(await transport(job),{code:'retry',delay:60});
 response=new Response(null,{status:429,headers:{'Retry-After':'999999'}});
 assert.deepEqual(await transport(job),{code:'retry',delay:86400});
});
