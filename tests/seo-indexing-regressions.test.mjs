import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require=createRequire(import.meta.url),ts=require('typescript');
function load(path,modules={}){
 const exports={};
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,URLSearchParams,process:{env:{}},require:name=>Object.hasOwn(modules,name)?modules[name]:require(name)});
 return exports;
}

test('requisites declare their own canonical rather than leaving Google to choose a duplicate',()=>{
 const page=load('src/app/rekvizity/page.tsx',{'@/components/BrandName':{},'@/components/SiteHeader':{}});
 assert.equal(page.metadata.alternates?.canonical,'/rekvizity');
});

test('each valid listing kind has distinct search metadata while canonical ignores tracking and invalid filters',async()=>{
 const {generateMetadata}=load('src/app/obyavleniya/page.tsx',{
  '@/components/HomeListings':{},'@/components/ListingEntryNav':{},'@/components/SiteHeader':{},
  '@/components/listings/ListingPages':{parseListingPage:value=>/^\d+$/.test(value??'')?Math.max(1,Number(value)):1},
 });
 const main=await generateMetadata({searchParams:Promise.resolve({})});
 const titles=new Set([main.title]);
 for(const [kind,label] of [['prodam','Продам'],['kuplyu','Куплю'],['otdam-darom','Отдам даром'],['arenda','Аренда']]){
  const metadata=await generateMetadata({searchParams:Promise.resolve({kind,utm_source:'synthetic'})});
  assert.ok(metadata.title.includes(label));
  assert.notEqual(metadata.description,main.description);
  assert.equal(metadata.alternates.canonical,`/obyavleniya?kind=${kind}`);
  titles.add(metadata.title);
 }
 assert.equal(titles.size,5);
 const unknown=await generateMetadata({searchParams:Promise.resolve({kind:'unknown',page:'2'})});
 assert.equal(unknown.title,main.title);
 assert.equal(unknown.alternates.canonical,'/obyavleniya?page=2');
});

test('filtered listing pages have a descriptive primary heading matching their selected kind',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {ListingEntryNav}=load('src/components/ListingEntryNav.tsx',{'next/link':{default:props=>React.createElement('a',props)}});
 for(const [kind,label] of [['prodam','Продам'],['kuplyu','Куплю'],['otdam-darom','Отдам даром'],['arenda','Аренда']]){
  const html=renderToStaticMarkup(React.createElement(ListingEntryNav,{activeKind:kind}));
  assert.match(html,new RegExp(`<h1[^>]*>[^<]*${label}[^<]*</h1>`));
 }
});

test('only the two known obsolete category addresses permanently redirect to their equivalent categories',async()=>{
 const {getPathMatch}=require('next/dist/shared/lib/router/utils/path-match');
 const {default:config}=load('next.config.ts'),redirects=await config.redirects();
 for(const [from,to] of [['/katalog/sad-i-rasteniya-0','/katalog/sad-i-rasteniya'],['/katalog/dlya-doma-i-dachi/для-дома-и-дачи','/katalog/dlya-doma-i-dachi']]){
  const redirect=redirects.find(item=>decodeURIComponent(item.source)===from);
  assert.equal(redirect?.destination,to);
  assert.equal(redirect?.permanent,true);
  assert.ok(getPathMatch(redirect.source)(encodeURI(from)),'redirect must match the actual encoded HTTP pathname');
 }
 assert.ok(!redirects.some(item=>item.source==='/obyavlenie/:path*'||item.source==='/prodavets/:path*'||item.source==='/&'||item.source==='/$'));
});

test('public animal category descriptions explain real content without leaking testing instructions',()=>{
 const source=readFileSync(new URL('../src/components/listings/ListingPages.tsx',import.meta.url),'utf8');
 const descriptions=source.match(/const animalListingDescriptions:[\s\S]*?(?=\nconst animalListingPrices)/)?.[0];
 const reader=source.match(/function subcategoryDescription\([\s\S]*?(?=\nfunction coverageTitle)/)?.[0];
 assert.ok(descriptions&&reader);
 const exports={};
 vm.runInNewContext(ts.transpileModule(descriptions+'\nexport '+reader,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
 for(const name of ['Домашние питомцы','Сельхоз животные','Экзотические животные']){
  const text=exports.subcategoryDescription('zhivotnye',name);
  assert.ok(text.length>50);
  assert.doesNotMatch(text,/провер[а-яё]*|контрол[а-яё]*|форма создания|тестов[а-яё]*/i);
 }
});

test('the exact www alias redirects every path to the HTTPS canonical host without matching other hosts',async()=>{
 const {default:config}=load('next.config.ts'),redirects=await config.redirects();
 const {matchHas}=require('next/dist/shared/lib/router/utils/prepare-destination');
 const rule=redirects.find(item=>item.has?.some(condition=>condition.type==='host'));
 assert.ok(rule,'www alias requires an explicit host redirect');
 assert.equal(rule.source,'/:path*');
 assert.equal(rule.destination,'https://xn----9sbphbgks4a4a.xn--p1ai/:path*');
 assert.equal(rule.permanent,true);
 const host='www.xn----9sbphbgks4a4a.xn--p1ai';
 assert.ok(matchHas({headers:{host},cookies:{}},{},rule.has));
 for(const other of ['xn----9sbphbgks4a4a.xn--p1ai','localhost','www.xn----9sbphbgks4a4a.xn--p1ai.evil.invalid','evilwww.xn----9sbphbgks4a4a.xn--p1ai']){
  assert.equal(matchHas({headers:{host:other},cookies:{}},{},rule.has),false);
 }
});
