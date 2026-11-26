import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import {analyticsConsentName,analyticsConsentCookie,readAnalyticsConsent} from '../src/lib/analytics-consent.ts';

const require=createRequire(import.meta.url),ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(new URL('../src/lib/analytics-consent.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function load(globals={}){const exports={};vm.runInNewContext(compiled,{exports,...globals});return exports;}
function fixture({jar=new Map(),channels=new Set(),broadcast=true}={}){
 const document=new EventTarget(),window=new EventTarget(),control={write:'normal',readBlocked:false,beforeWrite:null};
 document.visibilityState='visible';
 Object.defineProperty(document,'cookie',{
  get(){if(control.readBlocked)throw new Error('Storage unavailable');return [...jar].map(([key,value])=>key+'='+value).join('; ');},
  set(value){control.beforeWrite?.();if(control.write==='throw')throw new Error('Storage unavailable');if(control.write==='ignore')return;
   const pair=value.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));},
 });
 class Channel{
  constructor(name){this.name=name;this.onmessage=null;channels.add(this);}
  postMessage(data){for(const peer of [...channels])if(peer!==this&&peer.name===this.name)peer.onmessage?.({data});}
  close(){channels.delete(this);}
 }
 if(broadcast)window.BroadcastChannel=Channel;
 const api=load({window,document});
 return{api,document,window,control,jar,channels,Channel};
}

test('analytics choice is separate from acknowledgement/auth and accepts exactly one versioned value',()=>{
 for(const value of ['', '__Host-blizhniy_cookie_notice=v1', '__Host-blizhniy_session=synthetic',
  analyticsConsentName+'=granted',analyticsConsentName+'=v1.unknown',analyticsConsentName+'=v2.granted',
  analyticsConsentName+'=v1.grantedjunk',analyticsConsentName+'=v1.granted; '+analyticsConsentName+'=v1.denied']){
  assert.equal(readAnalyticsConsent(value),'unknown',value);
 }
 assert.equal(readAnalyticsConsent('other=synthetic; '+analyticsConsentName+'=v1.granted'),'granted');
 assert.equal(readAnalyticsConsent(analyticsConsentName+'=v1.denied; other=synthetic'),'denied');
});
test('both choices use a host-only HTTPS preference for one year without account data',()=>{
 for(const choice of ['granted','denied']){
  const cookie=analyticsConsentCookie(choice,Date.UTC(2026,10,26));
  assert.ok(cookie.startsWith(analyticsConsentName+'=v1.'+choice+';'));
  for(const value of ['Path=/','Secure','SameSite=Lax','Max-Age=31536000','Expires=Fri, 26 Nov 2027 00:00:00 GMT'])assert.ok(cookie.includes(value),value);
  assert.doesNotMatch(cookie,/Domain=|HttpOnly|session=|token=|userId/i);
 }
 assert.throws(()=>analyticsConsentCookie('granted; Domain=bad.invalid'));
 assert.throws(()=>analyticsConsentCookie('granted',NaN));
});
test('server reads are unknown and cannot save or create a browser subscription',()=>{
 const api=load(),seen=[];
 assert.equal(api.getAnalyticsConsent(),'unknown');assert.equal(api.saveAnalyticsConsent('granted'),false);
 const stop=api.subscribeAnalyticsConsent(value=>seen.push(value));stop();assert.deepEqual(seen,['unknown']);
});
test('a confirmed choice notifies subscribers and preserves required cookies and old acknowledgement',()=>{
 const f=fixture({jar:new Map([['__Host-blizhniy_session','synthetic'],['__Host-blizhniy_cookie_notice','v1']])}),seen=[];
 const stop=f.api.subscribeAnalyticsConsent(value=>seen.push(value));
 assert.equal(f.api.getAnalyticsConsent(),'unknown');assert.equal(f.api.saveAnalyticsConsent('granted'),true);
 assert.equal(f.api.getAnalyticsConsent(),'granted');assert.deepEqual(seen,['unknown','granted']);
 assert.equal(f.jar.get('__Host-blizhniy_session'),'synthetic');assert.equal(f.jar.get('__Host-blizhniy_cookie_notice'),'v1');
 assert.equal(f.api.saveAnalyticsConsent('denied'),true);assert.equal(seen.at(-1),'denied');
 stop();assert.equal(f.channels.size,0,'the last subscriber closes its channel');
});
test('denial notifies before storage and remains effective when a previous grant cannot be overwritten',()=>{
 const f=fixture({jar:new Map([[analyticsConsentName,'v1.granted']])}),seen=[];
 const stop=f.api.subscribeAnalyticsConsent(value=>seen.push(value));
 f.control.write='throw';f.control.beforeWrite=()=>assert.equal(seen.at(-1),'denied','revoke before attempting storage');
 assert.equal(f.api.saveAnalyticsConsent('denied'),false);assert.equal(f.jar.get(analyticsConsentName),'v1.granted');
 f.window.dispatchEvent(new Event('focus'));f.window.dispatchEvent(new Event('pageshow'));f.document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.api.getAnalyticsConsent(),'denied');assert.deepEqual(seen,['granted','denied']);
 f.control.beforeWrite=null;assert.equal(f.api.saveAnalyticsConsent('granted'),false);assert.equal(f.api.getAnalyticsConsent(),'denied');
 f.control.write='normal';assert.equal(f.api.saveAnalyticsConsent('granted'),true);assert.equal(f.api.getAnalyticsConsent(),'granted');stop();
});
test('silent cookie rejection and unreadable cookies never turn a new grant into effective consent',()=>{
 const f=fixture(),seen=[];const stop=f.api.subscribeAnalyticsConsent(value=>seen.push(value));
 f.control.write='ignore';assert.equal(f.api.saveAnalyticsConsent('granted'),false);assert.equal(f.api.getAnalyticsConsent(),'unknown');
 f.control.write='normal';f.control.readBlocked=true;assert.equal(f.api.saveAnalyticsConsent('granted'),false);
 assert.equal(f.api.getAnalyticsConsent(),'unknown');assert.deepEqual(seen,['unknown']);stop();
});
test('tabs share confirmed choices but a broadcast never grants consent without the cookie',()=>{
 const jar=new Map(),channels=new Set(),a=fixture({jar,channels}),b=fixture({jar,channels}),seen=[];
 const stopA=a.api.subscribeAnalyticsConsent(()=>{}),stopB=b.api.subscribeAnalyticsConsent(value=>seen.push(value));
 assert.equal(a.api.saveAnalyticsConsent('granted'),true);assert.equal(seen.at(-1),'granted');
 assert.equal(a.api.saveAnalyticsConsent('denied'),true);assert.equal(seen.at(-1),'denied');
 const sender=new a.Channel('blizhniy-analytics-consent-v1');sender.postMessage({choice:'granted'});
 assert.equal(b.api.getAnalyticsConsent(),'denied');sender.postMessage({choice:'unexpected'});assert.equal(seen.at(-1),'denied');
 assert.equal(a.api.saveAnalyticsConsent('granted'),true);assert.equal(seen.at(-1),'granted');
 a.control.write='ignore';assert.equal(a.api.saveAnalyticsConsent('denied'),false);assert.equal(b.api.getAnalyticsConsent(),'denied');
 b.window.dispatchEvent(new Event('focus'));assert.equal(b.api.getAnalyticsConsent(),'denied','a stale persisted grant cannot reverse a failed revocation');
 sender.close();stopA();stopB();assert.equal(channels.size,0);
});
test('focus, pageshow and visibility reread storage when BroadcastChannel is unavailable; cleanup detaches them',()=>{
 const f=fixture({broadcast:false}),seen=[];const stop=f.api.subscribeAnalyticsConsent(value=>seen.push(value));
 f.jar.set(analyticsConsentName,'v1.granted');f.window.dispatchEvent(new Event('focus'));assert.equal(seen.at(-1),'granted');
 f.jar.set(analyticsConsentName,'v1.denied');f.window.dispatchEvent(new Event('pageshow'));assert.equal(seen.at(-1),'denied');
 f.jar.delete(analyticsConsentName);f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(seen.at(-1),'unknown');
 stop();const count=seen.length;f.jar.set(analyticsConsentName,'v1.granted');f.window.dispatchEvent(new Event('focus'));assert.equal(seen.length,count);
});
