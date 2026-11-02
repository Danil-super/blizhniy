import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const id='11111111-1111-4111-8111-111111111111',file='22222222-2222-4222-8222-222222222222';
function fixture(source){
 let retried=0,index=0;const timers=new Map(),out={},delays=[];
 new Function('exports','setTimeout','clearTimeout','Math',ts.transpileModule(readFileSync(new URL('../src/lib/public-photo-retry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,(fn,delay)=>{const key=++index;timers.set(key,fn);delays.push(delay);return key;},id=>timers.delete(id),{...Math,floor:Math.floor,random:()=>.5});
 const retry=out.createPublicPhotoRetry(source,()=>retried++);
 return{retry,timers,delays,count:()=>retried,fire(){const [key,fn]=timers.entries().next().value;timers.delete(key);fn();}};
}
test('same-origin public image GET retries exactly twice with delayed jitter and no source mutation',()=>{
 for(const kind of ['listings','work-publications','service-publications']){
  const f=fixture(`/api/${kind}/${id}/photos/${file}`);assert.equal(f.retry.failed(),true);assert.equal(f.retry.failed(),true);assert.equal(f.timers.size,1);
  assert.ok(f.delays[0]>=1000&&f.delays[0]<=1250);f.fire();assert.equal(f.count(),1);
  assert.equal(f.retry.failed(),true);assert.ok(f.delays[1]>=2000&&f.delays[1]<=2250);f.fire();assert.equal(f.count(),2);
  assert.equal(f.retry.failed(),false);assert.equal(f.timers.size,0);
 }
});
test('external, private, static, local blob/data, malformed and query-bearing image sources never receive automatic retries',()=>{
 for(const source of ['',`https://other.invalid/api/listings/${id}/photos/${file}`,`//other.invalid/api/listings/${id}/photos/${file}`,'/api/account/media/read','/images/logo.webp','blob:synthetic','data:image/webp;base64,AAAA',`/api/listings/invalid/photos/${file}`,`/api/listings/${id}/photos/${file}?retry=1`]){
  const f=fixture(source);assert.equal(f.retry.failed(),false);assert.equal(f.timers.size,0);
 }
});
test('success cancels a pending retry without resetting its finite budget',()=>{
 const f=fixture(`/api/listings/${id}/photos/${file}`);f.retry.failed();f.retry.loaded();assert.equal(f.timers.size,0);assert.equal(f.count(),0);
 assert.equal(f.retry.failed(),true);f.fire();assert.equal(f.retry.failed(),false);
});
test('unmount or source replacement disposes the retry and no delayed callback can fire afterwards',()=>{
 const f=fixture(`/api/listings/${id}/photos/${file}`);f.retry.failed();const stale=[...f.timers.values()][0];f.retry.dispose();assert.equal(f.timers.size,0);stale();assert.equal(f.count(),0);assert.equal(f.retry.failed(),false);f.retry.dispose();
});
