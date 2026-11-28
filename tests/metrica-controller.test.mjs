import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMetricaController,metricaInitOptions as defaultMetricaInitOptions} from '../src/lib/metrica-controller.ts';
const first={url:'https://site.test/',referer:'https://search.test/',title:'Ближний'};
const next={url:'https://site.test/katalog',referer:'https://search.test/',title:'Ближний'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial={consent:false,page:first}){
 let state=initial,loads=0,resolve,reject;
 const calls=[],loading=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const controller=createMetricaController(12345678,{snapshot:()=>({viewKey:state.page?.url??'',...state}),load:()=>{loads++;return loading;}});
 return{controller,calls,get loads(){return loads;},set(value){state=value;},resolve(){resolve((...args)=>calls.push(args));},reject,};
}
test('unknown/denied and private pages never load the library; revoke before load microtask is safe',async()=>{
 const f=fixture();f.controller.refresh();await settle();assert.equal(f.loads,0);
 f.set({consent:true,page:null});f.controller.refresh();await settle();assert.equal(f.loads,0);
 f.set({consent:true,page:first});f.controller.refresh();f.set({consent:false,page:first});f.controller.refresh();await settle();assert.equal(f.loads,0);
});
test('one init/view, SPA deduplication, privacy stop and safe restart',async()=>{
 const metricaInitOptions={...defaultMetricaInitOptions,url:first.url,referrer:first.referer};
 const f=fixture({consent:true,page:first});f.controller.refresh();f.controller.refresh();await settle();assert.equal(f.loads,1);
 f.resolve();await settle();assert.deepEqual(f.calls,[ [12345678,'init',metricaInitOptions],[12345678,'hit',first.url,{referer:first.referer,title:first.title}] ]);
 f.controller.refresh();assert.equal(f.calls.length,2);
 f.set({consent:true,page:next});f.controller.refresh();assert.equal(f.calls.at(-1)[3].referer,first.url);
 f.set({consent:true,page:null});f.controller.refresh();assert.deepEqual(f.calls.at(-1),[12345678,'destruct']);
 const stopped=f.calls.length;f.controller.refresh();assert.equal(f.calls.length,stopped);
 f.set({consent:true,page:first});f.controller.refresh();assert.deepEqual(f.calls.at(-2),[12345678,'init',metricaInitOptions]);
 f.set({consent:false,page:first});f.controller.refresh();assert.deepEqual(f.calls.at(-1),[12345678,'destruct']);
});
test('late tag load uses current route/consent and never buffers a stale public view',async()=>{
 for(const state of [{consent:false,page:first},{consent:true,page:null}]){
  const f=fixture({consent:true,page:first});f.controller.refresh();await settle();f.set(state);f.resolve();await settle();assert.deepEqual(f.calls,[]);
 }
 const f=fixture({consent:true,page:first});f.controller.refresh();await settle();f.set({consent:true,page:next});f.resolve();await settle();assert.equal(f.calls[1][2],next.url);
 assert.deepEqual(f.calls[0],[12345678,'init',{...defaultMetricaInitOptions,url:next.url,referrer:next.referer}]);
});
test('distinct cards each count once while their local identity never reaches the provider',async()=>{
 const page={...first,url:'https://site.test/obyavlenie/card'};
 const f=fixture({consent:true,page,viewKey:'/obyavlenie/private-record-a'});
 f.controller.refresh();await settle();f.resolve();await settle();
 f.set({consent:true,page,viewKey:'/obyavlenie/private-record-b'});f.controller.refresh();f.controller.refresh();
 const hits=f.calls.filter(row=>row[1]==='hit');
 assert.equal(hits.length,2);assert.equal(hits[0][2],page.url);assert.equal(hits[1][2],page.url);
 assert.doesNotMatch(JSON.stringify(f.calls),/private-record/);
});
test('disposed/failed loaders stay harmless with no retry loop',async()=>{
 const f=fixture({consent:true,page:first});f.controller.refresh();await settle();f.controller.dispose();f.resolve();await settle();assert.deepEqual(f.calls,[]);
 const failed=fixture({consent:true,page:first});failed.controller.refresh();await settle();failed.reject(new Error('blocked by browser'));await settle();failed.controller.refresh();await settle();assert.equal(failed.loads,1);assert.deepEqual(failed.calls,[]);
});
test('init cannot deliver a hit if consent changes while the provider is initializing',async()=>{
 let consent=true;const calls=[];
 const controller=createMetricaController(1,{snapshot:()=>({consent,page:first,viewKey:'/'}),load:async()=>((...args)=>{calls.push(args);if(args[1]==='init')consent=false;})});
 controller.refresh();await settle();assert.deepEqual(calls.map(row=>row[1]),['init','destruct']);
});


test('an absent safe referrer cannot make the SDK fall back to the document referrer',async()=>{
 const page={...first,referer:''};
 const f=fixture({consent:true,page});f.controller.refresh();await settle();f.resolve();await settle();
 assert.deepEqual(f.calls,[
  [12345678,'init',{...defaultMetricaInitOptions,url:page.url,referrer:page.url}],
  [12345678,'hit',page.url,{referer:page.url,title:page.title}],
 ]);
});
