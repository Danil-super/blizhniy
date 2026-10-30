import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const ts=createRequire(import.meta.url)('typescript');
const professionId='11111111-1111-4111-8111-111111111111',otherProfessionId='22222222-2222-4222-8222-222222222222';
const profession={id:professionId,slug:'synthetic-master',name:'Синтетический мастер',parent:'Синтетические услуги',active:true};
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text=node=>!node||typeof node!=='object'?String(node??''):[node.props?.children].flat(Infinity).map(text).join('');
function fixture({catalog=[profession],items=[],hasMore=false,error}={}){
 const calls={catalog:0,runtime:0,sql:[],legacy:0,mock:0,merge:0,fallback:0},notFoundError=Error('synthetic not-found');
 const jsx=(type,props)=>({type,props}),out={};
 const deps={
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
  'next/navigation':{notFound(){throw notFoundError;}},
  '@/components/BackLink':{BackLink:'back-link'},'@/components/SiteHeader':{SiteHeader:'site-header'},
  '@/components/SpecialistListCard':{SpecialistListCard:'specialist-card'},
  '@/components/listings/ListingPagination':{ListingPagination:'pagination'},
  '@/components/listings/ListingPages':{parseListingPage:value=>value===undefined?1:Number(value)},
  '@/lib/profession-store':{getPublicProfessions:async()=>{calls.catalog++;return catalog;}},
  '@/lib/mock-store':{listSpecialists(){calls.mock++;throw Error('Primary page must not load mock specialists');}},
  '@/lib/runtime-mode':{shouldShowFallbackContent(){calls.fallback++;return true;}},
  '@/lib/specialist-profile-store':{
   listStoredSpecialistProfiles(){calls.legacy++;throw Error('Primary page must not scan legacy specialists');},
   listSpecialistsWithStored(){calls.merge++;throw Error('Primary page must not merge legacy specialists');},
  },
  '@/lib/production-public-service-runtime':{getProductionPublicServiceStore:async()=>{calls.runtime++;return{professionPage:async(...args)=>{
   calls.sql.push(args);if(error)throw error;return{items,hasMore};
  }};}},
 };
 const source=readFileSync(new URL('../src/app/rabota/specialisty/[professionSlug]/page.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports','process',compiled)(name=>{
  if(!Object.hasOwn(deps,name))throw Error('Unapproved primary profession-page test dependency: '+name);return deps[name];
 },out,{env:{BLIZHNIY_AUTH_MODE:'postgres'}});
 const props=(slug=profession.slug,page)=>({params:Promise.resolve({professionSlug:slug}),...(page?{searchParams:Promise.resolve({page})}:{})});
 return{...out,calls,notFoundError,props};
}
function noLegacy(calls){assert.equal(calls.legacy,0);assert.equal(calls.mock,0);assert.equal(calls.merge,0);assert.equal(calls.fallback,0);}

test('actual primary profession page retains a renamed same-UUID specialist and excludes another UUID with an identical label',async()=>{
 const renamed={id:'33333333-3333-4333-8333-333333333333',professionId,profession:'Новое название после чтения каталога',status:'published',name:'Синтетический специалист'};
 const duplicateLabel={...renamed,id:'44444444-4444-4444-8444-444444444444',professionId:otherProfessionId,profession:profession.name};
 const unpublished={...renamed,id:'55555555-5555-4555-8555-555555555555',status:'draft'};
 const f=fixture({items:[renamed,duplicateLabel,unpublished]}),tree=await f.default(f.props());
 const cards=nodes(tree).filter(node=>node.type==='specialist-card');assert.equal(cards.length,1);assert.deepEqual(cards[0].props.specialist,renamed);
 assert.deepEqual(f.calls.sql,[[professionId,24,0]]);assert.equal(f.calls.runtime,1);noLegacy(f.calls);
 assert.match(text(nodes(tree).find(node=>node.type==='h1')),/Специалисты: Синтетический мастер/);
});

test('actual primary profession page uses bounded SQL pagination and forwards hasMore with the requested page',async()=>{
 const items=Array.from({length:24},(_,i)=>({id:`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`,professionId,profession:profession.name,status:'published'}));
 const f=fixture({items,hasMore:true}),tree=await f.default(f.props(profession.slug,'3'));
 assert.deepEqual(f.calls.sql,[[professionId,24,48]]);assert.equal(nodes(tree).filter(node=>node.type==='specialist-card').length,24);
 const pagination=nodes(tree).find(node=>node.type==='pagination');
 assert.equal(pagination.props.page,3);assert.equal(pagination.props.hasMore,true);assert.equal(pagination.props.baseHref,'/rabota/specialisty/synthetic-master');noLegacy(f.calls);
});

test('actual primary profession page leaves an empty first page empty even when fallback content is enabled',async()=>{
 const f=fixture(),tree=await f.default(f.props());assert.deepEqual(f.calls.sql,[[professionId,24,0]]);
 assert.equal(nodes(tree).filter(node=>node.type==='specialist-card').length,0);
 assert.equal(nodes(tree).find(node=>node.type==='pagination').props.hasMore,false);noLegacy(f.calls);
});

test('missing or inactive slugs are not-found before constructing the public SQL store',async()=>{
 // getPublicProfessions supplies active entries only; an inactive slug is absent from this public catalogue.
 for(const slug of ['missing-synthetic','inactive-synthetic']){
  const f=fixture({catalog:[profession]});await assert.rejects(f.default(f.props(slug)),error=>error===f.notFoundError);
  assert.equal(f.calls.catalog,1);assert.equal(f.calls.runtime,0);assert.deepEqual(f.calls.sql,[]);noLegacy(f.calls);
 }
});

test('empty later SQL page returns not-found and SQL failure never falls back to a different catalogue',async()=>{
 const empty=fixture();await assert.rejects(empty.default(empty.props(profession.slug,'2')),error=>error===empty.notFoundError);
 assert.deepEqual(empty.calls.sql,[[professionId,24,24]]);noLegacy(empty.calls);
 const failure=Error('synthetic public SQL failure'),failed=fixture({error:failure});
 await assert.rejects(failed.default(failed.props()),error=>error===failure);assert.deepEqual(failed.calls.sql,[[professionId,24,0]]);noLegacy(failed.calls);
});

test('actual metadata uses the current canonical profession name and slug without reading specialists',async()=>{
 const current={...profession,name:'Текущее синтетическое название',slug:'synthetic-renamed'},f=fixture({catalog:[current]});
 const first=await f.generateMetadata(f.props(current.slug));assert.equal(first.title,'Специалисты: Текущее синтетическое название');
 assert.deepEqual(first.alternates,{canonical:'/rabota/specialisty/synthetic-renamed'});
 const later=await f.generateMetadata(f.props(current.slug,'2'));assert.deepEqual(later.alternates,{canonical:'/rabota/specialisty/synthetic-renamed?page=2'});
 assert.equal(f.calls.catalog,2);assert.equal(f.calls.runtime,0);assert.deepEqual(f.calls.sql,[]);noLegacy(f.calls);
});
