import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const {createTelegramPhoneHandler}=load('telegram-phone-http');const {PhoneVerificationError}=load('phone-verification-contract');
const {canonicalTelegramCallback}=load('telegram-phone-http');
const origin='https://example.invalid',owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',state='a'.repeat(64);
const config={origin,clientId:'12345678',clientSecret:'synthetic-secret',callbackUrl:origin+'/api/account/phone/telegram/callback'};
function request(action,body={expectedOwnerId:owner},headers={}){return new Request(origin+'/api/account/phone/'+action,{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'127.0.0.1',cookie:'__Host-blizhniy_session='+'b'.repeat(64),...headers},body:JSON.stringify(body)});}
function fixture(options={}){const calls=[];const store={status:async(...a)=>{calls.push(['status',...a]);return{available:true,required:false,verified:false,phone:'',verifiedPhone:null}},start:async(...a)=>{calls.push(['start',...a]);return{id,state,nonce:'c'.repeat(64),verifier:'v'.repeat(43)}},claim:async(...a)=>{calls.push(['claim',...a]);if(options.rejectClaim)throw new PhoneVerificationError('INVALID_ATTEMPT');return{id,state,nonce:'c'.repeat(64),verifier:'v'.repeat(43)}},finishExchange:async(...a)=>{calls.push(['finish',...a]);return{id}},review:async()=>({id,phone:'+79991234567',currentPhone:'',replaceRequired:false,profileRevision:null,confirmed:false,returnTo:'/cabinet'}),confirm:async()=>{if(options.conflict)throw new PhoneVerificationError('PHONE_CONFLICT');return{confirmed:true,phone:'+79991234567',returnTo:'/cabinet'}},unlink:async()=>({confirmed:false})};const runtime={store,limiter:{allowProduction:async()=>options.allow!==false,allowPhoneVerification:async()=>options.allow!==false},policy:async()=>({available:true,required:false}),oidc:{authorization:()=> 'https://oauth.telegram.org/auth?state='+state,exchange:async(url)=>{calls.push(['exchange',url.href]);return{phone:'+79991234567',subject:'synthetic-sub',tokenHash:'d'.repeat(64)}}}};return{calls,handle:createTelegramPhoneHandler({origin},options.disabled?null:config,async()=>runtime)}};
test('all mutations require same-origin CSRF header, cookie and strict body allowlist',async()=>{
 const f=fixture();for(const [headers,status]of [[{origin:'https://evil.invalid'},403],[{'x-blizhniy-request':'0'},403],[{cookie:''},401]])assert.equal((await f.handle(request('start',{expectedOwnerId:owner,returnTo:'/cabinet'},headers),'start')).status,status);
 assert.equal((await f.handle(request('confirm',{expectedOwnerId:owner,attemptId:id,phone:'+79991234567',verified:true}),'confirm')).status,422);assert.equal(f.calls.length,0);
});
test('disabled configuration is explicit and never creates a confirmation attempt',async()=>{const f=fixture({disabled:true});const r=await f.handle(request('status'),'status');assert.equal(r.status,200);assert.equal((await r.json()).available,false);assert.equal((await f.handle(request('start',{expectedOwnerId:owner,returnTo:'/cabinet'}),'start')).status,503);assert.equal(f.calls.length,0)});
test('start passes the cookie owner to storage and returns only an official authorization URL',async()=>{const f=fixture();const r=await f.handle(request('start',{expectedOwnerId:owner,returnTo:'/cabinet/obyavleniya'}),'start');assert.equal(r.status,200);assert.deepEqual(Object.keys(await r.json()).sort(),['attemptId','authorizationUrl']);assert.equal(f.calls[0][0],'start');assert.equal(f.calls[0][2],owner);assert.match(r.headers.get('cache-control'),/no-store/)});
test('callback claims session-bound state before network and uses the configured callback URI',async()=>{const f=fixture();const r=await f.handle(new Request(origin+'/api/account/phone/telegram/callback?code=code&state='+state,{headers:{host:new URL(origin).host,cookie:'__Host-blizhniy_session='+'b'.repeat(64),'x-real-ip':'127.0.0.1'}}),'callback');assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/cabinet/phone?attempt='+id);assert.deepEqual(f.calls.map(c=>c[0]),['claim','exchange','finish']);assert.equal(f.calls[1][1],config.callbackUrl+'?code=code&state='+state);assert.equal(f.calls[2][3].subject,'synthetic-sub');assert.match(r.headers.get('referrer-policy'),/no-referrer/)});
test('replayed/foreign state does not reach provider and cancellation never stages a phone',async()=>{
 const rejected=fixture({rejectClaim:true});const req=()=>new Request(config.callbackUrl+'?code=code&state='+state,{headers:{host:new URL(origin).host,cookie:'__Host-blizhniy_session='+'b'.repeat(64),'x-real-ip':'127.0.0.1'}});assert.equal((await rejected.handle(req(),'callback')).headers.get('location'),'/cabinet/phone?error=invalid');assert.deepEqual(rejected.calls.map(c=>c[0]),['claim']);
 const f=fixture();await f.handle(new Request(config.callbackUrl+'?error=access_denied&state='+state,{headers:{host:new URL(origin).host,cookie:'__Host-blizhniy_session='+'b'.repeat(64),'x-real-ip':'127.0.0.1'}}),'callback');assert.deepEqual(f.calls.map(c=>c[0]),['claim','finish']);assert.equal(f.calls[1][3],null);
});
test('phone uniqueness conflicts are neutral and do not reveal a different account',async()=>{const f=fixture({conflict:true});const r=await f.handle(request('confirm',{expectedOwnerId:owner,attemptId:id,expectedRevision:null,acceptReplacement:true}),'confirm');assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:{code:'PHONE_CONFLICT'}});});
test('callback rejects an unrelated Host before claiming state or contacting Telegram',async()=>{const f=fixture();const response=await f.handle(new Request(config.callbackUrl+'?code=code&state='+state,{headers:{host:'evil.invalid',cookie:'__Host-blizhniy_session='+'b'.repeat(64),'x-real-ip':'127.0.0.1'}}),'callback');assert.equal(response.headers.get('location'),'/cabinet/phone?error=invalid');assert.deepEqual(f.calls,[]);});

test('production loopback callback preserves exact session/state checks behind the HTTPS ingress',async()=>{
 const f=fixture(),input=new Request('https://127.0.0.1:3000/api/account/phone/telegram/callback?error=access_denied&state='+state,
  {headers:{host:new URL(origin).host,'x-real-ip':'203.0.113.10','x-forwarded-proto':'https',cookie:'__Host-blizhniy_session='+'b'.repeat(64)}});
 const request=canonicalTelegramCallback(input,origin);
 assert.equal(new URL(request.url).origin,origin);assert.equal(request.headers.get('cookie'),input.headers.get('cookie'));
 assert.equal((await f.handle(request,'callback')).headers.get('location'),'/cabinet/phone?error=cancelled');
 assert.deepEqual(f.calls.map(call=>call[0]),['claim','finish']);
});
test('callback ingress does not canonicalize arbitrary URLs, forged host, forwarded lists or mutation requests',()=>{
 const path='/api/account/phone/telegram/callback?state='+state;
 const headers={host:new URL(origin).host,'x-real-ip':'203.0.113.10','x-forwarded-proto':'https'};
 for(const [url,patch,method] of [
  ['https://evil.invalid'+path,{},'GET'],['https://127.0.0.1:3046'+path,{},'GET'],
  ['http://127.0.0.1:3000'+path,{},'GET'],['https://127.0.0.1:3000/api/account/phone/confirm',{},'GET'],
  ['https://127.0.0.1:3000'+path,{host:'evil.invalid'},'GET'],['https://127.0.0.1:3000'+path,{'x-real-ip':'203.0.113.10, 192.0.2.1'},'GET'],
  ['https://127.0.0.1:3000'+path,{'x-forwarded-proto':'http'},'GET'],['https://127.0.0.1:3000'+path,{},'POST'],
 ]){
  const request=new Request(url,{method,headers:{...headers,...patch}});assert.equal(canonicalTelegramCallback(request,origin),request);
 }
});
