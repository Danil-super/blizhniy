import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {parsePublicSearchInput,PublicSearchError} from '../src/lib/public-search-contract.ts';
const ts=createRequire(import.meta.url)('typescript'),input={query:'ремонт',page:1};
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
const failed=error=>error instanceof PublicSearchError;
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture({cold=false}={}){
 let now=0,sequence=0,peak=0;const timers=new Map(),calls={config:0,db:0,searches:[],factories:[]},out={};
 const clock={pending:()=>timers.size,jump:ms=>{now+=ms;},advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};
 const deps={
  'server-only':{},'./public-search-contract':{parsePublicSearchInput,PublicSearchError},'./listing-workflow-config':{readPostmoderationEnabled:()=>true},
  './production-auth-config':{readProductionAuthConfig:()=>{calls.config++;return{};}},
  './production-auth-runtime':{getProductionAccountDatabase:()=>{calls.db++;const next=deferred();calls.factories.push(next);if(!cold)next.resolve({db:{}});return next.promise;}},
  './postgres-public-search':{PostgresPublicSearchStore:class{search(value,options){const result=deferred();calls.searches.push({value,options,result,done:false});peak=Math.max(peak,calls.searches.filter(row=>!row.done).length);return result.promise;}}},
 };
 const code=ts.transpileModule(readFileSync(new URL('../src/lib/production-search-runtime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','performance','setTimeout','clearTimeout',code)(name=>{assert.ok(Object.hasOwn(deps,name));return deps[name];},out,{now:()=>now},(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id;},id=>timers.delete(id));
 return{calls,clock,search:out.searchPrimaryPublications,peak:()=>peak,finish(index){const row=calls.searches[index];row.done=true;row.options.onComplete();row.result.resolve({items:[row.value.query],hasMore:false});}};
}

test('public search drains 32 FIFO waiters behind two physical readers and refuses overflow before initialization',async()=>{
 const f=fixture(),pending=Array.from({length:34},(_,n)=>f.search({...input,query:'запрос '+n}).then(value=>({value}),error=>({error})));
 await flush();assert.equal(f.calls.db,2);await assert.rejects(f.search(input),failed);assert.equal(f.calls.config,2);
 for(let n=0;n<34;n++){assert.equal(f.calls.searches[n]?.value.query,'запрос '+n);f.finish(n);await flush();assert.ok(f.peak()<=2);}
 const results=await Promise.all(pending);assert.deepEqual(results.map(row=>row.value?.items[0]),Array.from({length:34},(_,n)=>'запрос '+n));
 assert.equal(f.calls.db,34);assert.equal(f.clock.pending(),0);
});

test('public search queue expiry does not initialize config/database or consume a physical lease',async()=>{
 const f=fixture(),a=f.search(input),b=f.search(input);await flush();
 const expired=assert.rejects(f.search(input),failed);f.clock.advance(750);await flush();await expired;assert.equal(f.calls.db,2);assert.equal(f.calls.config,2);
 f.finish(0);f.finish(1);await Promise.all([a,b]);const c=f.search(input);await flush();f.finish(2);await c;assert.equal(f.clock.pending(),0);
});

test('public search rechecks the monotonic wait deadline when a grant beats a delayed timer callback',async()=>{
 const f=fixture(),a=f.search(input),b=f.search(input);await flush();
 const expired=assert.rejects(f.search(input),failed);f.clock.jump(750);f.finish(0);await flush();await expired;assert.equal(f.calls.db,2);
 f.finish(1);await Promise.all([a,b]);assert.equal(f.clock.pending(),0);
});

test('public search includes queue time and cold initialization in the same original five-second deadline',async()=>{
 const f=fixture({cold:true}),a=f.search(input),b=f.search(input);await flush();const c=f.search({...input,query:'ожидающий'});
 f.clock.advance(700);f.calls.factories[0].resolve({db:{}});await flush();f.finish(0);await flush();assert.equal(f.calls.db,3);
 f.clock.advance(3000);f.calls.factories[2].resolve({db:{}});await flush();
 const row=f.calls.searches[1];assert.equal(row.value.query,'ожидающий');assert.equal(row.options.timeoutMs,1300);assert.equal(row.options.deadline,5000);
 f.finish(1);f.calls.factories[1].resolve({db:{}});await flush();f.finish(2);await Promise.all([a,b,c]);assert.equal(f.clock.pending(),0);
});

test('public search does not grant a physical lease until timed-out work has actually cleaned up, including duplicate cleanup',async()=>{
 const f=fixture(),a=f.search(input),b=f.search(input);await flush();
 const rejected=assert.rejects(a);f.calls.searches[0].result.reject(Error('synthetic store timeout'));await rejected;
 const waiting=f.search({...input,query:'после очистки'});await flush();assert.equal(f.calls.db,2);
 f.calls.searches[0].done=true;f.calls.searches[0].options.onComplete();f.calls.searches[0].options.onComplete();await flush();assert.equal(f.calls.db,3);assert.ok(f.peak()<=2);
 const expired=assert.rejects(f.search(input),failed);f.clock.advance(750);await expired;assert.equal(f.calls.db,3);
 f.finish(1);f.finish(2);await Promise.all([b,waiting]);assert.equal(f.clock.pending(),0);
});

test('public search bounds disconnected waiters while two expired cold initializers retain physical ownership',async()=>{
 const f=fixture({cold:true}),a=f.search(input),b=f.search(input);await flush();
 const expiresA=assert.rejects(a,failed),expiresB=assert.rejects(b,failed),queued=assert.rejects(f.search(input),failed);
 f.clock.advance(5000);await flush();await Promise.all([expiresA,expiresB,queued]);assert.equal(f.calls.db,2);assert.equal(f.calls.searches.length,0);
 f.calls.factories[0].resolve({db:{}});await flush();assert.equal(f.calls.searches.length,0);
 const next=f.search(input);await flush();assert.equal(f.calls.db,3);f.calls.factories[1].reject(Error('late initializer'));f.calls.factories[2].resolve({db:{}});await flush();
 f.finish(0);await next;assert.equal(f.clock.pending(),0);
});
