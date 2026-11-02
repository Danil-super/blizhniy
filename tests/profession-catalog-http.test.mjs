import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require=createRequire(import.meta.url),ts=require('typescript');
// Execute only checked-in TypeScript; the repository is the sole substituted boundary.
function load(name,deps={}){
 const exports={};
 const source=readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',compiled)(path=>{
  if(!Object.hasOwn(deps,path))throw Error('Unapproved profession-catalog test dependency: '+path);
  return deps[path];
 },exports);
 return exports;
}
const boundary=load('auth-http',{'node:crypto':require('node:crypto'),'node:net':require('node:net')});
const fields=load('cabinet-field-validation');
const drafts=load('listing-draft-contract',{'./cabinet-field-validation.ts':fields});
const contract=load('profession-catalog-contract',{'./listing-draft-contract.ts':drafts,'./cabinet-field-validation.ts':fields});
const {createProfessionCatalogHandler}=load('profession-catalog-http',{
 './profession-catalog-contract':contract,'./profession-catalog-contract.ts':contract,
 './auth-http':boundary,'./auth-http.ts':boundary,'node:crypto':require('node:crypto'),
});
const origin='https://professions.example.invalid';
const first={id:'11111111-1111-4111-8111-111111111111',slug:'synthetic-profession',name:'Синтетический мастер',parent:'Синтетические услуги',active:true};
const second={...first,id:'22222222-2222-4222-8222-222222222222',slug:'synthetic-profession-other'};
function fixture({items=[first],repositoryError,factoryError,asyncFactory=false}={}){
 const calls=[],events=[];let factories=0;
 const repository={listActive:async(...args)=>{calls.push(args);if(repositoryError)throw repositoryError;return items;}};
 const getRepository=()=>{factories++;if(factoryError)throw factoryError;return asyncFactory?Promise.resolve(repository):repository;};
 const handle=createProfessionCatalogHandler({origin},getRepository,event=>events.push(event));
 const request=({method='GET',query='',headers={}}={})=>new Request(origin+'/api/professions'+query,{method,headers:{host:new URL(origin).host,...headers}});
 return{handle,request,calls,events,get factories(){return factories;}};
}
function headersArePublicJson(response){
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.match(response.headers.get('content-type'),/^application\/json(?:;|$)/);
 assert.equal(response.headers.get('set-cookie'),null);
}
async function genericError(response,status){
 assert.equal(response.status,status);headersArePublicJson(response);
 const body=await response.json();assert.deepEqual(Object.keys(body),['error']);
 assert.deepEqual(Object.keys(body.error),['code']);assert.equal(typeof body.error.code,'string');
 assert.match(body.error.code,/^[A-Z][A-Z0-9_]+$/);
 return body;
}

test('profession catalog is a public GET without cookies, origin, proxy IP or client authority',async()=>{
 for(const headers of [{},{authorization:'Bearer synthetic-ignored',cookie:'synthetic=ignored'},
  {origin:'https://foreign.example.invalid','sec-fetch-site':'cross-site','x-forwarded-for':'192.0.2.5'}]){
  const f=fixture({items:[first,second],asyncFactory:true});assert.equal(f.factories,0);
  const response=await f.handle(f.request({headers}));assert.equal(response.status,200);headersArePublicJson(response);
  assert.deepEqual(await response.json(),{items:[first,second]});assert.equal(f.factories,1);assert.deepEqual(f.calls,[[]]);
 }
});

test('profession catalog rejects unsupported methods before constructing the repository',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){
  const f=fixture(),response=await f.handle(f.request({method}));await genericError(response,405);
  assert.equal(response.headers.get('allow'),'GET');assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
});

test('profession catalog rejects query/body and forged Host before constructing the repository',async()=>{
 for(const [input,status] of [
  [{query:'?active=false'},400],[{query:'?owner=11111111-1111-4111-8111-111111111111'},400],
  [{query:'?limit=1001'},400],[{headers:{'content-length':'1'}},400],
  [{headers:{host:''}},403],[{headers:{host:'foreign.example.invalid'}},403],
  [{headers:{host:'professions.example.invalid:443'}},403],
  [{headers:{host:'foreign.example.invalid','x-forwarded-host':'professions.example.invalid',forwarded:'host=professions.example.invalid'}},403],
 ]){
  const f=fixture(),response=await f.handle(f.request(input));await genericError(response,status);
  assert.equal(f.factories,0);assert.deepEqual(f.calls,[]);
 }
 const f=fixture({items:[]}),response=await f.handle(f.request({headers:{'content-length':'0'}}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{items:[]});assert.deepEqual(f.calls,[[]]);
});

test('profession catalog never returns inactive, malformed or unknown repository fields',async()=>{
 const malformed=[null,{},'not-a-list',[null],[{...first,active:false}],[{...first,active:'true'}],
  [{...first,id:'not-a-uuid'}],[{...first,slug:'../unsafe'}],[{...first,slug:'язык'}],
  [{...first,slug:'x'.repeat(151)}],[{...first,name:''}],[{...first,name:'x'.repeat(201)}],
  [{...first,name:'<script>synthetic()</script>'}],[{...first,parent:'x'.repeat(201)}],
  [{...first,parent:'Синтетический\u0000родитель'}],[{...first,internal_note:'synthetic-private-field'}],
  [{id:first.id,slug:first.slug,name:first.name,active:true}],
  [first,{...second,id:first.id}],[first,{...second,slug:first.slug}],
 ];
 for(const items of malformed){
  const f=fixture({items}),response=await f.handle(f.request());await genericError(response,503);
  assert.equal(f.factories,1);assert.deepEqual(f.calls,[[]]);
 }
});

test('profession catalog allows its exact size boundary and refuses an oversized repository result',async()=>{
 const items=Array.from({length:1000},(_,i)=>({...first,id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,slug:'synthetic-'+i}));
 const f=fixture({items}),response=await f.handle(f.request());assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{items});assert.deepEqual(f.calls,[[]]);
 const tooMany=fixture({items:[...items,{...second,slug:'synthetic-overflow'}]});
 await genericError(await tooMany.handle(tooMany.request()),503);assert.deepEqual(tooMany.calls,[[]]);
});

test('profession catalog maps repository and lazy initialization failures to redacted unavailability without retries',async()=>{
 const detail='synthetic SQL failure /private/synthetic-db host=synthetic.internal';
 for(const options of [{repositoryError:Error(detail)},{factoryError:Error(detail)}]){
  const f=fixture(options),response=await f.handle(f.request());const body=await genericError(response,503);
  assert.equal(f.factories,1);assert.equal(f.calls.length,options.repositoryError?1:0);
  assert.equal(JSON.stringify({body,events:f.events}).includes(detail),false);
  assert.equal(JSON.stringify(f.events).includes(first.id),false);
 }
});

test('profession wire capability preserves modern UUIDs and recursively removes only legacy professionId keys without mutation',()=>{
 const value={items:[{id:first.id,professionId:second.id,profession:first.name,form:{professionId:second.id,professionName:first.name,price:'1500.00',contactPhone:'+79990000000'}}],
  nextCursor:null,professionId:second.id,active:false};
 const before=structuredClone(value);
 assert.equal(contract.professionWireView(value,true),value);
 assert.deepEqual(contract.professionWireView(value,false),{
  items:[{id:first.id,profession:first.name,form:{professionName:first.name,price:'1500.00',contactPhone:'+79990000000'}}],nextCursor:null,active:false,
 });
 assert.deepEqual(value,before);
 for(const primitive of [null,undefined,false,0,'Синтетическая подпись'])assert.equal(contract.professionWireView(primitive,false),primitive);
 assert.deepEqual(contract.professionWireView([{professionId:first.id},null],false),[{},null]);
});

test('same profession form ignores only a changed derived label when the selected UUID is stable',()=>{
 const form={professionId:first.id,professionName:first.name,title:'Синтетическая анкета',price:'1500.00',contactPhone:'+79990000000',contactName:'Синтетический мастер',photoIds:[second.id]};
 const renamed={...form,professionName:'Переименованная синтетическая профессия'};
 assert.equal(contract.sameProfessionForm(form,renamed),true);
 assert.equal(contract.sameProfessionForm(renamed,form),true);
 assert.equal(contract.sameProfessionForm(form,{...renamed,price:'1500.01'}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,professionId:second.id}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,contactPhone:'+79990000001'}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,contactName:'Другой синтетический мастер'}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,title:'Изменённая анкета'}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,photoIds:[]}),false);
 assert.equal(contract.sameProfessionForm(form,{...renamed,extra:'synthetic'}),false);
 assert.deepEqual(form.professionName,first.name);
});

test('same profession form keeps legacy labels authoritative and rejects invalid stable UUID rename shortcuts',()=>{
 const legacy={professionName:first.name,price:'1500.00'};
 assert.equal(contract.sameProfessionForm(legacy,{...legacy}),true);
 assert.equal(contract.sameProfessionForm(legacy,{...legacy,professionName:'Другая профессия'}),false);
 assert.equal(contract.sameProfessionForm({...legacy,professionId:null},{...legacy,professionId:null,professionName:'Другая профессия'}),false);
 assert.equal(contract.sameProfessionForm({...legacy,professionId:'invalid-synthetic-id'},{...legacy,professionId:'invalid-synthetic-id',professionName:'Другая профессия'}),false);
 assert.equal(contract.sameProfessionForm({...legacy,professionId:first.id},legacy),false);
});
