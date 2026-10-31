import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
function fixture(){
 let now=0,next=0;const timers=new Map(),shared={};
 const tick=ms=>{const target=now+ms;for(;;){const first=[...timers].filter(([,t])=>t.when<=target).sort((a,b)=>a[1].when-b[1].when)[0];if(!first)break;now=first[1].when;timers.delete(first[0]);first[1].fn();}now=target;};
 const load=()=>{
  const out={},source=readFileSync(new URL('../src/lib/media-read-admission.ts',import.meta.url),'utf8');
  new Function('exports','globalThis','setTimeout','clearTimeout','performance',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,shared,(fn,ms)=>{const id=++next;timers.set(id,{when:now+ms,fn});return id;},id=>timers.delete(id),{now:()=>now});
  return out.acquireMediaReadSlot;
 };
 return{acquire:load(),load,tick,elapse:ms=>now+=ms,timers,admission:{reads:0},signal:new AbortController().signal};
}
const flush=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};
async function occupy(f){return Promise.all(Array.from({length:4},(_,index)=>f.acquire(f.admission,'active-'+index,f.signal)));}

test('four active reads are shared by separately loaded bundles; release grants the waiting fifth exactly once',async()=>{
 const f=fixture(),slots=await occupy(f);assert.equal(f.admission.reads,4);
 const other=f.load();let resolved=false;
 const fifth=other(f.admission,'waiting',f.signal).then(value=>{resolved=true;return value;});await flush();assert.equal(resolved,false);
 slots[0]();const release=await fifth;assert.equal(typeof release,'function');assert.equal(f.admission.reads,4);
 slots[0]();assert.equal(f.admission.reads,4,'duplicate cleanup must not allow a fifth physical read');
 release();slots.slice(1).forEach(fn=>fn());assert.equal(f.admission.reads,0);assert.equal(f.timers.size,0);
});

test('client queues are FIFO and rotate between independent streams instead of draining one entire gallery first',async()=>{
 const f=fixture(),slots=await occupy(f),order=[];
 const job=(client,label)=>f.acquire(f.admission,client,f.signal).then(release=>{order.push(label);return release;});
 const a=job('gallery-a','a1'),a2=job('gallery-a','a2'),a3=job('gallery-a','a3'),b=job('gallery-b','b1'),c=job('gallery-c','c1');
 slots[0]();const ar=await a;assert.deepEqual(order,['a1']);ar();const br=await b;assert.deepEqual(order,['a1','b1']);br();const cr=await c;assert.deepEqual(order,['a1','b1','c1']);cr();
 const ar2=await a2;ar2();const ar3=await a3;ar3();slots.slice(1).forEach(fn=>fn());assert.equal(f.admission.reads,0);assert.equal(f.timers.size,0);
});

test('queue bounds are global64 and per-client24; another client can still enter before the global bound',async()=>{
 const f=fixture(),slots=await occupy(f),pending=[];
 for(let i=0;i<24;i++)pending.push(f.acquire(f.admission,'one',f.signal));
 assert.equal(await f.acquire(f.admission,'one',f.signal),undefined);assert.equal(f.timers.size,24);
 for(let i=0;i<24;i++)pending.push(f.acquire(f.admission,'two',f.signal));
 for(let i=0;i<16;i++)pending.push(f.acquire(f.admission,'three',f.signal));
 assert.equal(await f.acquire(f.admission,'four',f.signal),undefined);assert.equal(f.timers.size,64);assert.equal(f.admission.reads,4);
 f.tick(1500);assert.deepEqual(await Promise.all(pending),Array(64).fill(undefined));assert.equal(f.timers.size,0);
 slots.forEach(fn=>fn());assert.equal(f.admission.reads,0);
 const fresh=await f.acquire(f.admission,'one',f.signal);assert.equal(typeof fresh,'function');fresh();
});

test('deadline removes queued reads without freeing an active read or leaving a timer',async()=>{
 const f=fixture(),slots=await occupy(f);let result='pending';const waiting=f.acquire(f.admission,'waiting',f.signal).then(value=>result=value);
 f.tick(1499);await flush();assert.equal(result,'pending');f.tick(1);await waiting;assert.equal(result,undefined);assert.equal(f.admission.reads,4);assert.equal(f.timers.size,0);
 slots.forEach(fn=>fn());assert.equal(f.admission.reads,0);
});

test('aborted queued requests are removed, cannot consume a later slot and do not release active operations',async()=>{
 const f=fixture(),slots=await occupy(f),controller=new AbortController(),reason=Error('Synthetic cancellation');
 const waiting=f.acquire(f.admission,'cancelled',controller.signal),rejected=assert.rejects(waiting,error=>error===reason);controller.abort(reason);await rejected;
 assert.equal(f.timers.size,0);assert.equal(f.admission.reads,4);
 const pre=new AbortController();pre.abort(reason);await assert.rejects(f.acquire(f.admission,'already-cancelled',pre.signal),error=>error===reason);
 slots[0]();const active=await f.acquire(f.admission,'survivor',f.signal);assert.equal(f.admission.reads,4);active();slots.slice(1).forEach(fn=>fn());assert.equal(f.admission.reads,0);
});

test('aborting an acquired read retains capacity until its owner physically finishes',async()=>{
 const f=fixture(),controller=new AbortController(),release=await f.acquire(f.admission,'active',controller.signal);controller.abort();assert.equal(f.admission.reads,1);release();assert.equal(f.admission.reads,0);
});


test('an overdue waiter cannot start when a delayed timer loses the race to slot release',async()=>{
 const f=fixture(),slots=await occupy(f);let state='waiting';const pending=f.acquire(f.admission,'expired',f.signal).then(value=>state=value);
 f.elapse(1501);slots[0]();await pending;assert.equal(state,undefined);assert.equal(f.admission.reads,3);assert.equal(f.timers.size,0);slots.slice(1).forEach(fn=>fn());assert.equal(f.admission.reads,0);
});
