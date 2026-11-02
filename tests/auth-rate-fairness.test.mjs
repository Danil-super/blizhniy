import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {AuthRateLimiter} from '../src/lib/auth-http.ts';
import * as cookies from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import {loadProductionAuth} from './production-auth-module.mjs';

const settings=loadProductionAuth('production-auth-config');
const {createProductionAccountHandler}=loadProductionAuth('production-account-http',{
 './account-cookie':cookies,'./trusted-proxy-ip':proxy,'./production-auth-config':settings,
});
const secret='f'.repeat(64),origin=settings.productionAuthOrigin;
function fixture(){
 const counters=new Map();
 const db={query:async(_sql,[key,limit])=>{
  const attempts=Math.min((counters.get(key)??0)+1,limit+1);
  counters.set(key,attempts);return {rows:[{allowed:attempts<=limit}]};
 }};
 return new AuthRateLimiter(db,secret);
}
function account(limiter,rememberedCaptcha){
 return createProductionAccountHandler({origin,rateSecret:secret,mailKeyFile:'/synthetic/key.bin',rememberedCaptcha},()=>({
  limiter,verifyCaptcha:async token=>token==='valid-synthetic-proof',
  recovery:{requestRecovery:async()=>null},identity:{resolveSession:async()=>null},
 }),()=>{});
}
function request(action,ip,captchaToken='invalid-synthetic-proof'){
 return new Request(`${origin}/api/account/${action}`,{method:'POST',headers:{host:new URL(origin).host,origin,
  'x-blizhniy-request':'1','content-type':'application/json','x-real-ip':ip,
  ...(action==='session'?{cookie:'__Host-blizhniy_session='+'a'.repeat(64)}:{}),
 },body:JSON.stringify(action==='session'?{}:{email:`fairness-${action}@example.invalid`,captchaToken,
  ...(action==='login'?{password:'Synthetic fairness passphrase!'}:{})})});
}
for(const remembered of [false,true])test(`IP-denied login traffic leaves recovery available to another IP (remembered CAPTCHA=${remembered})`,async()=>{
 const handle=account(fixture(),remembered);
 const statuses=[];
 for(let i=0;i<620;i++)statuses.push((await handle(request('login','192.0.2.1'),'login')).status);
 assert.ok(statuses.includes(403));assert.equal(statuses.at(-1),429);
 assert.equal((await handle(request('recover','192.0.2.2','valid-synthetic-proof'),'recover')).status,202);
});
test('fabricated-session flood denied per IP leaves another session request available',async()=>{
 const handle=account(fixture(),true);
 for(let i=0;i<2020;i++)assert.equal((await handle(request('session','192.0.2.1'),'session')).status,i<300?401:429);
 assert.equal((await handle(request('session','192.0.2.2'),'session')).status,401,'Independent request reaches session authentication instead of aggregate throttling');
});
test('phone verification flood denied per IP leaves another phone verification available',async()=>{
 const limiter=fixture();
 for(let i=0;i<120;i++)assert.equal(await limiter.allowPhoneVerification('192.0.2.1'),i<10);
 assert.equal(await limiter.allowPhoneVerification('192.0.2.2'),true);
});
test('email-denied credential traffic leaves aggregate capacity for another email',async()=>{
 const limiter=fixture();
 for(let i=0;i<620;i++)assert.equal(await limiter.allowProduction('credential',`2001:db8::${(i+1).toString(16)}`,'same@example.invalid'),i<5);
 assert.equal(await limiter.allowProduction('credential','192.0.2.2','other@example.invalid'),true);
});
for(const [scope,limit]of [['credential',600],['session',2000]])test(`distributed concurrent ${scope} requests retain the global cap of ${limit}`,async()=>{
 const limiter=fixture();
 const outcomes=await Promise.all(Array.from({length:limit+20},(_,i)=>limiter.allowProduction(scope,`2001:db8::${(i+1).toString(16)}`)));
 assert.equal(outcomes.filter(Boolean).length,limit);
 assert.equal(await limiter.allowProduction(scope,'192.0.2.3'),false);
});
test('distributed phone verification retains its independent global cap',async()=>{
 const limiter=fixture();
 const outcomes=await Promise.all(Array.from({length:120},(_,i)=>limiter.allowPhoneVerification(`2001:db8::${(i+1).toString(16)}`)));
 assert.equal(outcomes.filter(Boolean).length,100);
 assert.equal(await limiter.allowProductionAttempt('recover','192.0.2.3'),true);
});
test('real Telegram HTTP start flood cannot exhaust phone or session capacity for an independent source',async()=>{
 const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
 const {createTelegramPhoneHandler}=load('telegram-phone-http');
 const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 const handle=createTelegramPhoneHandler({origin},{clientId:'12345678'},async()=>({
  limiter:fixtureLimiter,store:{start:async()=>({id})},oidc:{authorization:()=> 'https://oauth.telegram.org/auth'},
 }));
 const fixtureLimiter=fixture();
 const start=ip=>handle(new Request(origin+'/api/account/phone/start',{method:'POST',headers:{
  host:new URL(origin).host,origin,'x-blizhniy-request':'1','content-type':'application/json','x-real-ip':ip,
  cookie:'__Host-blizhniy_session='+'a'.repeat(64),
 },body:JSON.stringify({expectedOwnerId:owner,returnTo:'/cabinet'})}),'start');
 for(let i=0;i<2020;i++)assert.equal((await start('192.0.2.1')).status,i<10?200:429);
 assert.equal((await start('192.0.2.2')).status,200);
});
