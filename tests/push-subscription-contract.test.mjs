import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {parsePushSubscription,parsePushVapidPublicKey} from '../src/lib/push-subscription-contract.ts';

const p256dh=createECDH('prime256v1').generateKeys().toString('base64url');
const auth=randomBytes(16).toString('base64url');
const endpoint='https://fcm.googleapis.com/fcm/send/synthetic_device-a';
const input={endpoint,keys:{p256dh,auth},expirationTime:null};

test('browser push accepts canonical public provider routes, real P-256 keys and optional future expiration',()=>{
 for(const value of [endpoint,'https://updates.push.services.mozilla.com/wpush/v2/synthetic-a',
  'https://web.push.apple.com/synthetic-a']){
  const expirationTime=Date.now()+10_000;
  assert.deepEqual(parsePushSubscription({...input,endpoint:value,expirationTime}),{endpoint:value,p256dh,auth,expirationTime});
 }
 assert.equal(parsePushSubscription(input).expirationTime,null);
 assert.equal(parsePushVapidPublicKey(p256dh),p256dh);
});

test('registration refuses off-provider URLs, malformed points, additional fields and expired subscriptions',()=>{
 for(const value of ['http://fcm.googleapis.com/fcm/send/a','https://fcm.googleapis.com.evil.invalid/fcm/send/a',
  'https://fcm.googleapis.com:443/fcm/send/a','https://fcm.googleapis.com/fcm/send/a?test=1',
  'https://fcm.googleapis.com/fcm/send/a#x','https://user@fcm.googleapis.com/fcm/send/a',
  'https://fcm.googleapis.com/fcm/send/a%2fb','https://fcm.googleapis.com/fcm/send/../a',
  'https://updates.push.services.mozilla.com/metrics/a','https://127.0.0.1/a','https://web.push.apple.com/a/b']){
  assert.throws(()=>parsePushSubscription({...input,endpoint:value}),{name:'PushSubscriptionInputError'});
 }
 for(const invalid of [{...input,id:'forged'},{...input,keys:{...input.keys,owner:'forged'}},
  {...input,keys:{auth:auth+'=',p256dh}},{...input,keys:{auth,p256dh:Buffer.alloc(65,4).toString('base64url')}},
  {...input,expirationTime:Date.now()-1000},{...input,expirationTime:Infinity}]){
  assert.throws(()=>parsePushSubscription(invalid),{name:'PushSubscriptionInputError'});
 }
});
