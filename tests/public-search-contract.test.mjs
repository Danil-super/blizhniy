import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {parsePublicSearchInput,publicSearchPattern,PublicSearchError} from '../src/lib/public-search-contract.ts';
import {encodePublicSearchCursor,decodePublicSearchCursor} from '../src/lib/public-search-cursor.ts';
import {buildPublicSearchSql} from '../src/lib/public-search-sql.ts';

const ts=createRequire(import.meta.url)('typescript');
const input={query:'Сантехник',cityName:'Краснодар',page:1};
const anchor={id:'11111111-1111-4111-8111-111111111111',rank:1,publishedAt:'2026-10-30T10:20:30.123456Z',createdAt:'2026-10-29T10:20:30.654321Z',sortOrder:0,parent:'',name:''};
const wire=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const unwire=text=>JSON.parse(Buffer.from(text,'base64url').toString('utf8'));
const publicError=error=>error instanceof PublicSearchError&&error.message==='Public search unavailable';
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

function clock(){
 let now=0,sequence=0;const timers=new Map();
 return{performance:{now:()=>now},setTimeout(fn,ms){const id=++sequence;timers.set(id,{at:now+ms,fn});return id;},clearTimeout(id){timers.delete(id);},
  advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;},
 };
}
function runtimeFixture({deferFactory=false,factoryError,synchronousFactoryError=false,config=null,configError,constructorError}={}){
 const timers=clock(),calls={config:0,db:0,constructors:[],searches:[],factories:[],sql:0},out={};
 const db={readTransaction(){calls.sql++;throw Error('Unexpected fake database SQL');}};
 class FakeSearchStore{
  constructor(received,options){calls.constructors.push({db:received,options});if(constructorError)throw constructorError;}
  search(received,options){const result=deferred();calls.searches.push({input:received,options,result});return result.promise;}
 }
 const deps={
  'server-only':{},
  './production-auth-config':{readProductionAuthConfig(){calls.config++;if(configError)throw configError;return config===false?null:config??{origin:'https://search.example.invalid'};}},
  './production-auth-runtime':{getProductionAccountDatabase(){
   calls.db++;if(factoryError&&synchronousFactoryError)throw factoryError;
   const pending=deferred();calls.factories.push(pending);
   if(factoryError)pending.reject(factoryError);else if(!deferFactory)pending.resolve({db});return pending.promise;
  }},
  './listing-workflow-config':{readPostmoderationEnabled:()=>true},
  './postgres-public-search':{PostgresPublicSearchStore:FakeSearchStore},
  './public-search-contract':{parsePublicSearchInput,PublicSearchError},
 };
 const source=readFileSync(new URL('../src/lib/production-search-runtime.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','performance','setTimeout','clearTimeout',compiled)(path=>{
  if(!Object.hasOwn(deps,path))throw Error('Unapproved public-search-runtime fixture dependency: '+path);return deps[path];
 },out,timers.performance,timers.setTimeout,timers.clearTimeout);
 const finish=(index,value={items:[],hasMore:false})=>{calls.searches[index].options.onComplete();calls.searches[index].result.resolve(value);};
 return{search:out.searchPrimaryPublications,calls,clock:timers,db,finish};
}

test('public search accepts only its bounded plain input shape without silently normalizing user values',()=>{
 assert.deepEqual(parsePublicSearchInput({query:'',page:1}),{query:'',page:1});
 const maximum={query:'Ж'.repeat(200),cityName:'Г'.repeat(200),page:1000,cursor:'a'.repeat(4096)};
 assert.deepEqual(parsePublicSearchInput(maximum),maximum);
 const plain=Object.assign(Object.create(null),input);assert.deepEqual(parsePublicSearchInput(plain),input);
 assert.deepEqual(parsePublicSearchInput({query:"O'Brien %_!\\",page:1}),{query:"O'Brien %_!\\",page:1});
 for(const invalid of [null,[],{},new(class{constructor(){Object.assign(this,input);}})(),{...input,extra:true},{...input,[Symbol('hidden')]:true},
  {...input,query:1},{...input,query:' Ж'},{...input,query:'Ж '},{...input,query:'Ж'.repeat(201)},
  {...input,query:'a\u0000b'},{...input,query:'a\nb'},{...input,query:'a\u007fb'},{...input,query:'a\u0085b'},{...input,query:'\ud800'},
  {...input,cityName:''},{...input,cityName:' Краснодар'},{...input,cityName:'Г'.repeat(201)},{...input,cityName:'\udfff'},{...input,cityName:'a\u0000b'},
  {...input,page:0},{...input,page:-1},{...input,page:1.1},{...input,page:1001},{...input,page:'1'},{...input,page:NaN},{...input,page:Infinity},
  {...input,cursor:''},{...input,cursor:null},{...input,cursor:[]},{...input,cursor:'a'.repeat(4097)},
 ])assert.throws(()=>parsePublicSearchInput(invalid),publicError);
});

test('LIKE patterns preserve literal wildcard, escape and backslash characters while applying the existing Unicode lowercase semantics',()=>{
 assert.equal(publicSearchPattern(''),null);
 assert.equal(publicSearchPattern('САНТЕХНИК'),'%'+'сантехник'+'%');
 assert.equal(publicSearchPattern('A!%_\\B'),'%a'+'!!'+'!%'+'!_'+'\\b%');
 assert.equal(publicSearchPattern('100% готово_!'),'%'+'100!% готово!_!!'+'%');
 assert.equal(publicSearchPattern('İΣ'),'%'+'İΣ'.toLowerCase()+'%');
});

test('publication cursors round-trip every rank/direction with exact microsecond timestamps and filter binding',()=>{
 for(let rank=1;rank<=5;rank++)for(const direction of ['next','previous']){
  const position={...anchor,rank},encoded=encodePublicSearchCursor(position,input,direction);
  assert.match(encoded,/^[A-Za-z0-9_-]+$/);assert.ok(encoded.length<=4096);
  const decoded=decodePublicSearchCursor(encoded,input);assert.deepEqual(decoded,{...position,direction});
  assert.equal(decoded.publishedAt,'2026-10-30T10:20:30.123456Z');assert.equal(decoded.createdAt,'2026-10-29T10:20:30.654321Z');
  assert.deepEqual(decodePublicSearchCursor(encoded,{...input,page:1000}),decoded,'page label does not grant authority or alter the public position');
  for(const changed of [{...input,query:'другой запрос'},{...input,cityName:'Армавир'},{query:input.query,page:1}])assert.throws(()=>decodePublicSearchCursor(encoded,changed),publicError);
 }
});

test('reference cursors retain category/profession sort metadata and carry no payment or account authority',()=>{
 const positions=[{...anchor,rank:6,publishedAt:null,createdAt:null,sortOrder:17,name:'Категория'},
  {...anchor,rank:7,publishedAt:null,createdAt:null,sortOrder:0,parent:'Услуги',name:'Профессия'}];
 for(const position of positions){
  const encoded=encodePublicSearchCursor(position,input,'next');assert.deepEqual(decodePublicSearchCursor(encoded,input),{...position,direction:'next'});
  const metadata=unwire(encoded);assert.deepEqual(Object.keys(metadata).sort(),['id','rank','publishedAt','createdAt','sortOrder','parent','name','direction','binding'].sort());
  // Cursors are unsigned positions over public rows, not entitlements. Forging a
  // different valid position is accepted; SQL still authorizes every result row.
  metadata.id='22222222-2222-4222-8222-222222222222';metadata.name="O'Brien public position";
  assert.equal(decodePublicSearchCursor(wire(metadata),input).id,metadata.id);
 }
});

test('cursor decoder rejects noncanonical base64url, wrong envelopes, invalid IDs and timestamps without exposing content',()=>{
 const encoded=encodePublicSearchCursor(anchor,input,'next'),value=unwire(encoded);
 for(const text of ['',encoded+'=',encoded+'==','+'+encoded,'/'+encoded,encoded+'\n','a'.repeat(4097),wire(null),wire([]),wire('text')])assert.throws(()=>decodePublicSearchCursor(text,input),publicError);
 for(const patch of [{extra:true},{id:'not-a-uuid'},{rank:0},{rank:8},{rank:1.5},{direction:'forward'},{binding:'f'.repeat(64)},
  {publishedAt:null},{createdAt:null},{publishedAt:'2026-10-30T10:20:30.123Z'},{createdAt:'2026-02-30T10:20:30.654321Z'},
  {publishedAt:'2026-10-30T10:20:30.123456+03:00'},{parent:'unexpected'},{name:'unexpected'},{sortOrder:1},{sortOrder:-1},
 ])assert.throws(()=>decodePublicSearchCursor(wire({...value,...patch}),input),publicError);
 const missing={...value};delete missing.binding;assert.throws(()=>decodePublicSearchCursor(wire(missing),input),publicError);
 for(const position of [{...anchor,rank:6,publishedAt:null,createdAt:null,name:''},
  {...anchor,rank:7,publishedAt:null,createdAt:null,name:'Мастер',parent:''},
  {...anchor,rank:7,publishedAt:null,createdAt:null,name:'Мастер',parent:'a\u0000b'},
  {...anchor,rank:7,publishedAt:null,createdAt:null,name:'Ж'.repeat(201),parent:'Услуги'},
  {...anchor,rank:6,publishedAt:null,createdAt:null,name:'Категория',parent:'Неиспользуемый родитель'},
  {...anchor,rank:7,publishedAt:null,createdAt:null,name:'Мастер',parent:'Услуги',sortOrder:3},
 ])assert.throws(()=>encodePublicSearchCursor(position,input,'next'),publicError);
 const reference=encodePublicSearchCursor({...anchor,rank:7,publishedAt:null,createdAt:null,name:'UNIQUEUTF8',parent:'Услуги'},input,'next');
 const invalidUtf8=Buffer.from(reference,'base64url'),at=invalidUtf8.indexOf(Buffer.from('UNIQUEUTF8'));assert.ok(at>=0);invalidUtf8[at]=255;
 assert.throws(()=>decodePublicSearchCursor(invalidUtf8.toString('base64url'),input),publicError);
});

test('malicious search and cursor strings remain literal SQL parameters rather than query syntax or identifiers',()=>{
 const malicious="UNIQUE_SEARCH_SENTINEL'); SELECT pg_sleep(9); -- %_!\\";
 const value=parsePublicSearchInput({query:malicious,cityName:malicious,page:1});
 const position={...anchor,rank:7,publishedAt:null,createdAt:null,name:malicious,parent:malicious};
 const encoded=encodePublicSearchCursor(position,value,'previous'),decoded=decodePublicSearchCursor(encoded,value);
 const scopes={listing:{source:'from synthetic_listing l',eligible:'synthetic_listing_live'},work:{source:'from synthetic_work w',eligible:'synthetic_work_live'},service:{source:'from synthetic_service s',eligible:'synthetic_service_live',profileIdentity:true}};
 for(const reverse of [false,true]){
  const built=buildPublicSearchSql(value,scopes,decoded,reverse);
  assert.equal(built.text.includes(malicious),false);assert.equal(built.text.includes('UNIQUE_SEARCH_SENTINEL'),false);
  assert.equal(built.values[0],publicSearchPattern(malicious));assert.equal(built.values[2],malicious);
  assert.equal(built.values[9],malicious);assert.equal(built.values[10],malicious);assert.equal(built.values[3],25);
  assert.match(built.text,/escape '!'/);assert.match(built.text,/limit \$4/);assert.equal(/\boffset\b/i.test(built.text),false);
 }
});

test('runtime admits exactly two leases and rejects a third before config or database initialization',async()=>{
 const f=runtimeFixture(),a=f.search(input),b=f.search({...input,page:2});await flush();
 assert.equal(f.calls.db,2);assert.equal(f.calls.searches.length,2);assert.equal(f.calls.config,2);
 await assert.rejects(f.search(input),publicError);assert.equal(f.calls.db,2);assert.equal(f.calls.config,2);
 assert.equal(f.calls.constructors[0].db,f.db);assert.deepEqual(f.calls.constructors[0].options,{postmoderation:true,specialistProfileIdentity:true});
 f.finish(0);f.finish(1);await Promise.all([a,b]);
 const c=f.search(input);await flush();assert.equal(f.calls.searches.length,3);f.finish(2);await c;
});

test('an expired store response retains its lease until physical cleanup and duplicate cleanup cannot overrelease',async()=>{
 const f=runtimeFixture(),a=f.search(input),b=f.search(input);await flush();
 const expiry=Error('Synthetic expired DB response');f.calls.searches[0].result.reject(expiry);await assert.rejects(a,error=>error===expiry);
 await assert.rejects(f.search(input),publicError);assert.equal(f.calls.db,2);
 f.calls.searches[0].options.onComplete();f.calls.searches[0].options.onComplete();
 const c=f.search(input);await flush();assert.equal(f.calls.db,3);assert.equal(f.calls.searches.length,3);
 await assert.rejects(f.search(input),publicError);assert.equal(f.calls.db,3,'duplicate cleanup must not create a third simultaneous lease');
 f.finish(1);f.finish(2);await Promise.all([b,c]);
});

test('invalid input does not acquire a runtime lease or initialize auth/database resources',async()=>{
 const f=runtimeFixture();
 for(const invalid of [{...input,query:'x'.repeat(201)},{...input,page:1001},{...input,cursor:'x'.repeat(4097)},{...input,unknown:true}])await assert.rejects(f.search(invalid),publicError);
 assert.equal(f.calls.config,0);assert.equal(f.calls.db,0);assert.equal(f.calls.searches.length,0);
 const a=f.search(input),b=f.search(input);await flush();assert.equal(f.calls.searches.length,2);
 await assert.rejects(f.search(input),publicError);f.finish(0);f.finish(1);await Promise.all([a,b]);
});

test('preflight failures release leases before delegation, preserving recovery without creating a store',async()=>{
 for(const synchronousFactoryError of [false,true]){
  const error=Error('Synthetic initializer failure'),f=runtimeFixture({factoryError:error,synchronousFactoryError});
  for(let n=0;n<3;n++)await assert.rejects(f.search(input),found=>found===error);
  assert.equal(f.calls.db,3);assert.equal(f.calls.config,3);assert.equal(f.calls.constructors.length,0);assert.equal(f.calls.searches.length,0);
 }
 for(const fixtureOptions of [{config:false},{configError:Error('Synthetic config failure')},{constructorError:Error('Synthetic constructor failure')}]){
  const f=runtimeFixture(fixtureOptions);for(let n=0;n<3;n++)await assert.rejects(f.search(input));
  assert.equal(f.calls.config,3,'failed preflight must not leave two permanently occupied search leases');
 }
});

test('cold initialization timeout returns on deadline but holds both leases until late initializers actually settle',async()=>{
 const f=runtimeFixture({deferFactory:true}),a=f.search(input),b=f.search(input);await flush();
 const expiredA=assert.rejects(a,publicError),expiredB=assert.rejects(b,publicError);
 f.clock.advance(5000);await flush();await Promise.all([expiredA,expiredB]);
 assert.equal(f.calls.db,2);assert.equal(f.calls.constructors.length,0);assert.equal(f.calls.searches.length,0);
 await assert.rejects(f.search(input),publicError);assert.equal(f.calls.db,2);
 f.calls.factories[0].resolve({db:f.db});await flush();assert.equal(f.calls.constructors.length,0,'late init must not create a store or issue SQL');assert.equal(f.calls.sql,0);
 const c=f.search(input);await flush();assert.equal(f.calls.db,3);
 await assert.rejects(f.search(input),publicError);assert.equal(f.calls.db,3);
 f.calls.factories[1].reject(Error('Synthetic late initializer failure'));await flush();assert.equal(f.calls.constructors.length,0);assert.equal(f.calls.sql,0);
 f.calls.factories[2].resolve({db:f.db});await flush();assert.equal(f.calls.searches.length,1);f.finish(0);await c;
});

test('initialization time consumes the same global budget passed to the SQL read transaction',async()=>{
 const f=runtimeFixture({deferFactory:true}),pending=f.search(input);await flush();f.clock.advance(3000);
 f.calls.factories[0].resolve({db:f.db});await flush();assert.equal(f.calls.searches.length,1);
 assert.equal(f.calls.searches[0].options.timeoutMs,2000);assert.equal(typeof f.calls.searches[0].options.onComplete,'function');
 f.finish(0);assert.deepEqual(await pending,{items:[],hasMore:false});
});
