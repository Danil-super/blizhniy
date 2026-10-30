import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const ts=createRequire(import.meta.url)('typescript');
function load(name,deps={}){
 const exports={};
 const source=readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  if(!Object.hasOwn(deps,name))throw Error('Unapproved client-professions test dependency: '+name);return deps[name];
 },exports);return exports;
}
const fields=load('cabinet-field-validation');
const drafts=load('listing-draft-contract',{'./cabinet-field-validation.ts':fields});
const contract=load('profession-catalog-contract',{'./listing-draft-contract.ts':drafts,'./cabinet-field-validation.ts':fields});
const {loadProfessionCatalog}=load('client-professions',{'./profession-catalog-contract.ts':contract});
const row={id:'11111111-1111-4111-8111-111111111111',slug:'synthetic-master',name:'Синтетический мастер',parent:'Синтетические услуги',active:true};
const response=value=>Response.json(value);

test('client reads the public reference endpoint with bounded same-origin, no-store, nonredirecting transport',async()=>{
 const calls=[],items=[row,{...row,id:'22222222-2222-4222-8222-222222222222',slug:'synthetic-other'}];
 const result=await loadProfessionCatalog(async(...args)=>{calls.push(args);return response({items});});
 assert.deepEqual(result,items);assert.equal(calls.length,1);
 const [url,options]=calls[0];assert.equal(url,'/api/reference/professions');
 assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
 assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
 assert.equal(options.body,undefined);assert.equal(options.headers,undefined);
});

test('client rejects status, MIME, empty body, malformed JSON and invalid UTF-8 rather than supplying fallback options',async()=>{
 const replies=[new Response('{}',{status:503,headers:{'content-type':'application/json'}}),
  new Response(null,{status:204}),new Response('{}',{status:200,headers:{'content-type':'text/plain'}}),
  new Response(null,{status:200,headers:{'content-type':'application/json'}}),
  new Response('{broken',{headers:{'content-type':'application/json'}}),
  new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}})];
 for(const reply of replies){let calls=0;await assert.rejects(loadProfessionCatalog(async()=>{calls++;return reply;}));assert.equal(calls,1);}
 await assert.rejects(loadProfessionCatalog(async()=>{throw Error('synthetic network failure');}));
});

test('client accepts only the exact items envelope and strict active DTOs, retaining duplicate names with distinct identities',async()=>{
 for(const value of [null,[],{}, {items:[],nextCursor:null},{items:[],error:null},{items:{}},
  {items:[{...row,active:false}]},{items:[{...row,internal:'synthetic-private'}]},
  {items:[{...row,id:'invalid'}]},{items:[{...row,slug:'../unsafe'}]},
  {items:[{...row,name:'<b>synthetic</b>'}]},{items:[row,{...row,slug:'synthetic-other'}]},
  {items:[row,{...row,id:'22222222-2222-4222-8222-222222222222'}]},
 ])await assert.rejects(loadProfessionCatalog(async()=>response(value)));
 assert.deepEqual(await loadProfessionCatalog(async()=>response({items:[]})),[]);
 const many=Array.from({length:1001},(_,i)=>({...row,id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,slug:'synthetic-'+i}));
 await assert.rejects(loadProfessionCatalog(async()=>response({items:many})));
});

test('client cancels overlarge or excessively fragmented bodies and accepts the byte limit exactly',async()=>{
 const json=JSON.stringify({items:[row]});
 const exact=json+' '.repeat(2097152-Buffer.byteLength(json));
 assert.deepEqual(await loadProfessionCatalog(async()=>new Response(exact,{headers:{'content-type':'application/json'}})),[row]);
 for(const mode of ['bytes','chunks']){
  let cancelled=0;
  const stream=new ReadableStream({start(controller){
   if(mode==='bytes')controller.enqueue(new Uint8Array(2097153));
   else for(let i=0;i<4097;i++)controller.enqueue(new Uint8Array([32]));
  },cancel(){cancelled++;}});
  await assert.rejects(loadProfessionCatalog(async()=>new Response(stream,{headers:{'content-type':'application/json'}})));
  assert.equal(cancelled,1);assert.equal(stream.locked,false);
 }
});

test('client propagates external cancellation to fetch and refuses reads after abort',async()=>{
 const controller=new AbortController(),reason=Error('synthetic cancel');controller.abort(reason);
 let seen, cancelled=0;
 const stream=new ReadableStream({cancel(){cancelled++;}});
 await assert.rejects(loadProfessionCatalog(async(_url,options)=>{seen=options.signal;return new Response(stream,{headers:{'content-type':'application/json'}});},controller.signal),error=>error===reason);
 assert.equal(seen.aborted,true);assert.equal(seen.reason,reason);assert.equal(cancelled,1);assert.equal(stream.locked,false);
 const live=new AbortController();let signal;
 const promise=loadProfessionCatalog(async(_url,options)=>{signal=options.signal;return response({items:[]});},live.signal);
 live.abort(reason);await assert.rejects(promise,error=>error===reason);assert.equal(signal.aborted,true);
});
