import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const ts=createRequire(import.meta.url)('typescript');
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text=node=>!node||typeof node!=='object'?String(node??''):[node.props?.children].flat(Infinity).map(text).join('');
const cards=tree=>nodes(tree).filter(node=>node.type==='search-link'&&node.props.className?.includes('group grid'));
const pager=tree=>nodes(tree).find(node=>node.type==='nav'&&node.props['aria-label']==='Страницы результатов');
const links=tree=>nodes(tree).filter(node=>node.type==='search-link');
const parsePage=value=>{const page=Number(value);return Number.isSafeInteger(page)&&page>=1&&page<=1000?page:1;};
function fixture({items=[],hasMore=false,nextCursor,previousCursor,error,catalogSize=0,fallback=true}={}){
 const calls={primary:[],reads:[],transferred:0,fallback:0,mock:0,legacyProbe:0,categories:0,professions:0,conversion:0};
 const rows=Array.from({length:catalogSize},(_,index)=>({
  id:String(index),slug:'synthetic-'+index,title:'Синтетическая публикация '+index,status:'published',city:'Краснодар',
  description:'Описание товара или работы.',categoryName:'Товары',subcategoryName:'Мастерская',kind:'prodam',
  organization:'Синтетическая организация',profession:'Сантехник',salary:'10 000 ₽',author:'Заказчик',budget:'1000 ₽',
  name:'Синтетический специалист',skills:'Ремонт',price:'1000 ₽',participantName:'Синтетическая ярмарка',category:'Посуда',
 }));
 const read=(family,limit,offset)=>{
  const page=rows.slice(offset,offset+limit);calls.reads.push({family,limit,offset});calls.transferred+=page.length;return Promise.resolve(page);
 };
 const mock=()=>{calls.mock++;return[];},jsx=(type,props)=>({type,props}),out={};
 const deps={
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
  'next/link':{__esModule:true,default:'search-link'},'lucide-react':{ArrowRight:'arrow',Search:'search',UserRound:'person'},
  '@/components/SiteHeader':{SiteHeader:'site-header'},'@/components/VacancyMedia':{VacancyThumbnail:'vacancy-thumbnail'},
  '@/components/listings/ListingPages':{parseListingPage:parsePage,listPublicDemoListings:mock,toDemoListing:item=>{calls.conversion++;return item;}},
  '@/lib/data':{cities:[{slug:'krasnodar',name:'Краснодар'},{slug:'armavir',name:'Армавир'}],region:{name:'Краснодарский край'}},
  '@/lib/category-store':{getPublicCategories:async()=>{calls.categories++;return[];}},
  '@/lib/profession-store':{getPublicProfessions:async()=>{calls.professions++;return[];}},
  '@/lib/mock-store':{listFairApplications:mock,listSpecialists:mock,listWorkRequests:mock},
  '@/lib/runtime-mode':{shouldShowFallbackContent(){calls.fallback++;return fallback;}},
  '@/lib/supabase-rest':{isSupabaseRestConfigured(){calls.legacyProbe++;return true;}},
  '@/lib/specialist-profile-store':{listSpecialistsWithStored:mock,listStoredSpecialistProfiles:(limit,offset)=>read('specialist',limit,offset)},
  '@/lib/fair-application-store':{listStoredFairApplications:(status,{limit,offset})=>read('fair',limit,offset)},
  '@/lib/vacancy-store':{listVacanciesWithStored:mock,listStoredVacancies:(limit,offset)=>read('vacancy',limit,offset)},
  '@/lib/work-request-store':{listStoredWorkRequests:(limit,offset)=>read('workRequest',limit,offset)},
  '@/lib/listing-store':{listStoredListings:(limit,{offset})=>read('listing',limit,offset)},
  '@/lib/production-search-runtime':{searchPrimaryPublications:async input=>{calls.primary.push(input);if(error)throw error;return{items,hasMore,nextCursor,previousCursor};}},
 };
 const source=readFileSync(new URL('../src/app/poisk/page.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports','process',compiled)(name=>{
  if(!Object.hasOwn(deps,name))throw Error('Unapproved primary search-page test dependency: '+name);return deps[name];
 },out,{env:{BLIZHNIY_AUTH_MODE:'postgres'}});
 return{...out,calls,run:params=>out.default({searchParams:Promise.resolve(params)})};
}
function noScans(calls){
 assert.deepEqual(calls.reads,[],'primary search must not scan former publication list readers');
 assert.equal(calls.transferred,0);assert.equal(calls.conversion,0);
 assert.equal(calls.fallback,0);assert.equal(calls.mock,0);assert.equal(calls.legacyProbe,0);
 assert.equal(calls.categories,0);assert.equal(calls.professions,0);
}
const result=index=>({title:'Синтетический результат '+index,description:'Публичное описание '+index,href:'/obyavlenie/synthetic-'+index,type:'Объявление'});

test('negative primary search reads a bounded SQL result instead of transferring every publication',async t=>{
 const f=fixture({catalogSize:2401}),tree=await f.run({q:'несуществующая-фраза-из-аудита'});
 t.diagnostic(JSON.stringify({catalogPerType:2401,types:5,oldReadCalls:f.calls.reads.length,oldRowsTransferred:f.calls.transferred,primaryCalls:f.calls.primary.length}));
 assert.equal(f.calls.primary.length,1);
 assert.deepEqual(f.calls.primary[0],{query:'несуществующая-фраза-из-аудита',cityName:undefined,page:1});
 noScans(f.calls);assert.equal(cards(tree).length,0);assert.match(text(tree),/Ничего не найдено/);
});

test('primary search forwards trimmed case-preserving query, selected city and bounded page exactly once',async()=>{
 const f=fixture({items:[result(1)],hasMore:true}),tree=await f.run({q:'  СаНТеХнИк %_  ',city:'armavir',page:'3'});
 assert.deepEqual(f.calls.primary,[{query:'СаНТеХнИк %_',cityName:'Армавир',page:3}]);noScans(f.calls);
 assert.equal(cards(tree).length,1);assert.equal(text(cards(tree)[0]).includes(result(1).title),true);
 assert.equal(text(nodes(tree).find(node=>node.type==='h1')),'Результаты: СаНТеХнИк %_');
 const navigation=pager(tree);assert.ok(navigation);
 const previous=links(navigation).find(node=>text(node)==='Назад'),next=links(navigation).find(node=>text(node)==='Далее');
 assert.equal(previous.props.href,'/poisk?q='+encodeURIComponent('СаНТеХнИк %_').replace(/%20/g,'+')+'&city=armavir&page=2');
 assert.equal(next.props.href,'/poisk?q='+encodeURIComponent('СаНТеХнИк %_').replace(/%20/g,'+')+'&city=armavir&page=4');
});

test('primary search renders one full result page and uses hasMore without an extra sentinel card',async()=>{
 const items=Array.from({length:24},(_,index)=>result(index)),f=fixture({items,hasMore:true}),tree=await f.run({q:'мастер'});
 assert.equal(cards(tree).length,24);assert.deepEqual(cards(tree).map(card=>card.props.href),items.map(item=>item.href));
 assert.equal(links(pager(tree)).filter(node=>text(node)==='Далее').length,1);assert.equal(links(pager(tree)).filter(node=>text(node)==='Назад').length,0);
 noScans(f.calls);
});

test('last primary result page retains back navigation without inventing another result page',async()=>{
 const items=Array.from({length:24},(_,index)=>result(index+24)),f=fixture({items,hasMore:false}),tree=await f.run({q:'мастер',city:'krasnodar',page:'2'});
 assert.equal(cards(tree).length,24);assert.equal(links(pager(tree)).filter(node=>text(node)==='Далее').length,0);
 assert.equal(links(pager(tree)).find(node=>text(node)==='Назад').props.href,'/poisk?q='+encodeURIComponent('мастер')+'&city=krasnodar');
 noScans(f.calls);
});

test('empty primary search stays empty when demo fallback is enabled and does not read static catalogues',async()=>{
 const f=fixture({items:[],hasMore:false,fallback:true}),tree=await f.run({});
 assert.deepEqual(f.calls.primary,[{query:'',cityName:undefined,page:1}]);noScans(f.calls);
 assert.equal(cards(tree).length,0);assert.equal(pager(tree),undefined);assert.match(text(tree),/Ничего не найдено/);
});

test('a primary SQL failure propagates instead of becoming a successful empty or fallback search',async()=>{
 const error=Error('Synthetic SQL search failure'),f=fixture({error,fallback:true});
 await assert.rejects(f.run({q:'мастер'}),found=>found===error);
 assert.equal(f.calls.primary.length,1);noScans(f.calls);
});

test('search preserves existing URL input bounds and ignores an unknown city slug',async()=>{
 for(const page of ['0','-1','1.5','1001','not-a-page']){
  const f=fixture(),query='Ж'.repeat(201);
  await f.run({q:'  '+query+'  ',city:'unknown-synthetic-city',page});
  assert.deepEqual(f.calls.primary,[{query:'Ж'.repeat(200),cityName:undefined,page:1}]);noScans(f.calls);
 }
 const deep=fixture();await deep.run({q:'',page:'1000'});assert.deepEqual(deep.calls.primary,[{query:'',cityName:undefined,page:1000}]);noScans(deep.calls);
});

test('primary rendering uses only public search fields and keeps vacancy media specific to its result',async()=>{
 const publicVacancy={title:'Синтетическая вакансия',description:'Публичная организация, город и сумма',href:'/vakansiya/fixture',images:['/api/work-publications/fixture/photos/cover'],type:'Вакансия',contactPhone:'PRIVATE-PHONE-SENTINEL',ownerId:'PRIVATE-OWNER-SENTINEL'};
 const f=fixture({items:[publicVacancy,result(1)]}),tree=await f.run({q:'вакансия'}),rendered=cards(tree);
 assert.equal(rendered.length,2);assert.equal(rendered[0].props.href,publicVacancy.href);
 const thumbnail=nodes(rendered[0]).find(node=>node.type==='vacancy-thumbnail');assert.deepEqual(thumbnail.props,{images:publicVacancy.images,title:publicVacancy.title});
 assert.equal(nodes(rendered[1]).some(node=>node.type==='vacancy-thumbnail'),false);
 assert.equal(rendered[0].props.href.startsWith('/vakansiya/'),true);assert.equal(JSON.stringify(tree).includes('PRIVATE-PHONE-SENTINEL'),false);assert.equal(JSON.stringify(tree).includes('PRIVATE-OWNER-SENTINEL'),false);noScans(f.calls);
});


test('primary navigation forwards the public cursor and replaces it with returned next/previous anchors',async()=>{
 const f=fixture({items:[result(1)],hasMore:true,nextCursor:'next-public-anchor',previousCursor:'previous-public-anchor'});
 const tree=await f.run({q:'мастер',city:'krasnodar',page:'2',cursor:'incoming-public-anchor'});
 assert.deepEqual(f.calls.primary,[{query:'мастер',cityName:'Краснодар',page:2,cursor:'incoming-public-anchor'}]);
 const navigation=links(pager(tree)),previous=navigation.find(node=>text(node)==='Назад'),next=navigation.find(node=>text(node)==='Далее');
 const before=new URL(previous.props.href,'https://example.invalid'),after=new URL(next.props.href,'https://example.invalid');
 assert.equal(before.searchParams.get('cursor'),'previous-public-anchor');assert.equal(before.searchParams.has('page'),false);
 assert.equal(after.searchParams.get('cursor'),'next-public-anchor');assert.equal(after.searchParams.get('page'),'3');
 for(const url of [before,after]){assert.equal(url.searchParams.get('q'),'мастер');assert.equal(url.searchParams.get('city'),'krasnodar');}
 noScans(f.calls);
});

test('the last allowed search page never generates an unsupported page1001 link',async()=>{
 const f=fixture({items:[result(1)],hasMore:true,nextCursor:'next-public-anchor',previousCursor:'previous-public-anchor'});
 const tree=await f.run({q:'мастер',page:'1000',cursor:'incoming-public-anchor'});
 assert.equal(links(pager(tree)).some(node=>text(node)==='Далее'),false);
 assert.equal(new URL(links(pager(tree)).find(node=>text(node)==='Назад').props.href,'https://example.invalid').searchParams.get('page'),'999');
 noScans(f.calls);
});
