import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {readTelegramPhoneConfig} from '../src/lib/telegram-phone-config.ts';
import {createTelegramPhoneOidc} from '../src/lib/telegram-phone-oidc.ts';
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const env={BLIZHNIY_TELEGRAM_PHONE:'enabled',BLIZHNIY_TELEGRAM_CLIENT_ID:'12345678',BLIZHNIY_TELEGRAM_CLIENT_SECRET:'synthetic-client-secret-long-value',BLIZHNIY_TELEGRAM_CALLBACK_URL:origin+'/api/account/phone/telegram/callback'};
const config=()=>readTelegramPhoneConfig(env);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256',use:'sig'};
function jwt(patch={}){const now=Math.floor(Date.now()/1000);const h=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'https://oauth.telegram.org',aud:'12345678',sub:'1234123412341234123',iat:now,exp:now+3600,nonce:'synthetic-nonce',phone_number:'79991234567',phone_number_verified:true,...patch})).toString('base64url');return h+'.'+b+'.'+createSign('RSA-SHA256').update(h+'.'+b).sign(privateKey).toString('base64url');}
function provider(patch={},mutate=x=>x){const seen=[];return{seen,fetch:async(input,init)=>{const url=String(input);seen.push({url,method:init?.method});if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});assert.equal(url,'https://oauth.telegram.org/token','token endpoint');assert.equal(init.redirect,'error','redirect policy');const basic=new Headers(init.headers).get('authorization');assert.match(basic,/^Basic /);assert.deepEqual(Buffer.from(basic.slice(6),'base64').toString().split(':').map(value=>decodeURIComponent(value.replaceAll('+',' '))),['12345678',env.BLIZHNIY_TELEGRAM_CLIENT_SECRET],'HTTP Basic auth');const form=new URLSearchParams(init.body);assert.equal(form.get('code_verifier'),'v'.repeat(43),'PKCE verifier');assert.equal(form.get('redirect_uri'),env.BLIZHNIY_TELEGRAM_CALLBACK_URL,'fixed callback URI');return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600,id_token:mutate(jwt(patch))});}};}
const callback=()=>new URL(env.BLIZHNIY_TELEGRAM_CALLBACK_URL+'?code=synthetic-code&state=synthetic-state');
const attempt={state:'synthetic-state',nonce:'synthetic-nonce',verifier:'v'.repeat(43)};
test('Telegram is disabled by default and rejects partial config, unsafe callback and secret exposure',()=>{
 assert.equal(readTelegramPhoneConfig({}),null);
 for(const patch of [{BLIZHNIY_TELEGRAM_CLIENT_SECRET:''},{BLIZHNIY_TELEGRAM_CALLBACK_URL:'https://evil.invalid/callback'},{BLIZHNIY_TELEGRAM_CALLBACK_URL:origin+'/api/account/phone/telegram/callback?x=1'},{BLIZHNIY_TELEGRAM_PHONE:'typo'}])assert.throws(()=>readTelegramPhoneConfig({...env,...patch}));
 const local=readTelegramPhoneConfig({...env,BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045',BLIZHNIY_TELEGRAM_CALLBACK_URL:'https://127.0.0.1:3045/api/account/phone/telegram/callback'});assert.equal(local.callbackUrl,'https://127.0.0.1:3045/api/account/phone/telegram/callback');
});
test('authorization uses official code flow, phone scope, state nonce and S256 without secret',()=>{
 const url=new URL(createTelegramPhoneOidc(config()).authorization(attempt));assert.equal(url.origin,'https://oauth.telegram.org');assert.equal(url.pathname,'/auth');assert.equal(url.searchParams.get('scope'),'openid phone');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('nonce'),attempt.nonce);assert.equal(url.searchParams.get('state'),attempt.state);assert.equal(url.searchParams.get('response_type'),'code');assert.ok(!url.href.includes(env.BLIZHNIY_TELEGRAM_CLIENT_SECRET));assert.ok(!url.searchParams.has('telegram:bot_access'));
});
test('server exchanges code and cryptographically verifies Telegram phone claims against JWKS',async()=>{
 const p=provider();const result=await createTelegramPhoneOidc(config(),p.fetch).exchange(callback(),attempt);assert.equal(result.phone,'+79991234567');assert.equal(result.subject,'1234123412341234123');assert.match(result.tokenHash,/^[a-f0-9]{64}$/);assert.ok(p.seen.some(r=>r.url.endsWith('jwks.json')));
});
test('signature, expiry, issuer, audience, nonce, missing phone and unverified phone fail closed',async()=>{
 for(const patch of [{iss:'https://evil.invalid'},{aud:'other-client'},{exp:1},{iat:Math.floor(Date.now()/1000)+120},{nonce:'wrong'},{phone_number:undefined},{phone_number_verified:false},{phone_number:'7999<script>'}]){const p=provider(patch);await assert.rejects(createTelegramPhoneOidc(config(),p.fetch).exchange(callback(),attempt));}
 const p=provider({},token=>{const [h,b,s]=token.split('.');return[h,b,s[0]==='A'?'B'+s.slice(1):'A'+s.slice(1)].join('.')});await assert.rejects(createTelegramPhoneOidc(config(),p.fetch).exchange(callback(),attempt));
});
test('wrong state, callback origin/path, duplicate parameters and cancellation never exchange a code',async()=>{
 for(const url of [new URL('https://evil.invalid/?code=c&state=synthetic-state'),new URL(origin+'/wrong?code=c&state=synthetic-state'),new URL(env.BLIZHNIY_TELEGRAM_CALLBACK_URL+'?code=c&state=wrong'),new URL(env.BLIZHNIY_TELEGRAM_CALLBACK_URL+'?code=c&code=d&state=synthetic-state'),new URL(env.BLIZHNIY_TELEGRAM_CALLBACK_URL+'?error=access_denied&state=synthetic-state')]){const p=provider();await assert.rejects(createTelegramPhoneOidc(config(),p.fetch).exchange(url,attempt));assert.equal(p.seen.length,0);}
});
