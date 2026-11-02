import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts=createRequire(import.meta.url)('typescript');
const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
function load(path,modules={},env={}){
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env},URLSearchParams,Date,console,require:name=>{
  assert.ok(Object.hasOwn(modules,name),'Unexpected module '+name);return modules[name];
 }});
 return exports;
}
const stamp='2026-10-20T10:00:00.000001Z';

for(const kind of ['listing','work','service']){
 test(kind+' sitemap page advances past rejected public rows and exposes only public IDs and dates',async()=>{
  const calls=[],batches=[[{valid:false},{valid:false}],[{valid:true,id:'public-id',profession:'Сантехник',publishedAt:stamp,phone:'private-phone',form:{description:'private-form'}}]];
  const db={query:async(sql,params)=>{calls.push({sql,params});return{rows:batches.shift()};}};
  const mapper=row=>row.valid?row:null;
  const modules={
   './listing-draft-contract.ts':{parseListingDraftId:value=>value,ListingDraftInputError:Error},
   './media-limits.ts':{maxListingMediaTotalSize:1000000},
   './listing-workflow-config':{readPostmoderationEnabled:()=>false},
   './profession-reference':loadLocalPrimaryModule('profession-reference'),
   './public-listings':{mapPublicListing:mapper},
   './public-work-publications.ts':{mapPublicWorkPublication:mapper},
   './public-service-publications.ts':{mapPublicServicePublication:mapper},
   './listing-public-eligibility':{publicListingSource:'from app.listings l',publicListingLive:'live',publicListingPhotos:'photos'},
  };
  const file={listing:'postgres-public-listings',work:'postgres-public-work',service:'postgres-public-service'}[kind];
  const name={listing:'PostgresPublicListingStore',work:'PostgresPublicWorkStore',service:'PostgresPublicServiceStore'}[kind];
  const store=new (load('src/lib/'+file+'.ts',modules)[name])(db);
  const read=offset=>kind==='work'?store.sitemapPage('workRequest',2,offset):store.sitemapPage(2,offset);
  const first=await read(0),second=await read(2);
  assert.equal(first.entries.length,0);
  assert.equal(first.hasMore,true,'a full SQL batch must advance even if all public projections reject it');
  assert.equal(second.hasMore,false);
  assert.deepEqual(JSON.parse(JSON.stringify(second.entries)),[{id:'public-id',publishedAt:stamp}]);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.sql.includes('limit')&&call.params.includes(2)));
  assert.ok(!JSON.stringify(second).includes('private-'));
 });
}

test('primary sitemap includes every public publication type across batches without old backend reads',async()=>{
 const calls=[];
 const factory=kind=>({sitemapPage:async(...args)=>{
  const [limit,offset]=kind==='work'?args.slice(1):args,type=kind==='work'?args[0]:kind;
  calls.push([type,limit,offset]);
  return{entries:offset===0?[{id:type+'-first',publishedAt:stamp}]:[{id:type+'-later',publishedAt:stamp}],hasMore:offset===0};
 }});
 const listing=factory('listing'),work=factory('work'),service=factory('specialist');
 const {listPrimarySitemapEntries}=load('src/lib/production-sitemap-runtime.ts',{
  'server-only':{},'./production-public-listing-runtime':{getProductionPublicListingStore:async()=>listing},
  './production-public-work-runtime':{getProductionPublicWorkStore:async()=>work},
  './production-public-service-runtime':{getProductionPublicServiceStore:async()=>service},
 });
 const result=await listPrimarySitemapEntries('https://example.test');
 for(const [kind,prefix] of [['listing','/obyavlenie'],['vacancy','/vakansiya'],['workRequest','/rabota/zakazy'],['specialist','/specialist']]){
  assert.ok(result.some(row=>row.url===`https://example.test${prefix}/${kind}-first`));
  assert.ok(result.some(row=>row.url===`https://example.test${prefix}/${kind}-later`));
 }
 assert.equal(result.length,8);
 assert.ok(result.every(row=>row.lastModified.toISOString()==='2026-10-20T10:00:00.000Z'));
 assert.equal(calls.length,8);
});

test('primary sitemap failures propagate instead of silently falling back or returning an empty successful sitemap',async()=>{
 const fail=async()=>{throw Error('Synthetic primary unavailable');};
 const {listPrimarySitemapEntries}=load('src/lib/production-sitemap-runtime.ts',{
  'server-only':{},'./production-public-listing-runtime':{getProductionPublicListingStore:fail},
  './production-public-work-runtime':{getProductionPublicWorkStore:fail},
  './production-public-service-runtime':{getProductionPublicServiceStore:fail},
 });
 await assert.rejects(listPrimarySitemapEntries('https://example.test'),/Synthetic primary unavailable/);
});

test('sitemap route uses primary publication readers before leftover legacy settings and includes requisites',async()=>{
 let primary=0,legacy=0;
 const sitemap=load('src/app/sitemap.ts',{
  '@/components/listings/ListingPages':{slugifySubcategory:value=>value},'@/lib/category-store':{getPublicCategories:async()=>[]},
  '@/lib/profession-store':{getPublicProfessions:async()=>[]},
  '@/lib/data':{professions:[]},'@/lib/instrument-subcategories':{instrumentSubcategories:[]},'@/lib/posuda-subcategories':{posudaSubcategories:[]},
  '@/lib/site-url':{getPublicSiteUrl:()=> 'https://example.test'},
  '@/lib/supabase-rest':{isSupabaseRestConfigured:()=>{legacy++;return true;},supabaseRest:async()=>{throw Error('Forbidden legacy request');}},
  '@/lib/production-sitemap-runtime':{listPrimarySitemapEntries:async base=>{primary++;return[{url:base+'/obyavlenie/public-id'}];}},
 },{BLIZHNIY_AUTH_MODE:'postgres'}).default;
 const result=await sitemap();
 assert.equal(primary,1);
 assert.equal(legacy,0);
 assert.ok(result.some(entry=>entry.url==='https://example.test/rekvizity'));
 assert.ok(result.some(entry=>entry.url==='https://example.test/obyavlenie/public-id'));
});
