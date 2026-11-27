const assert=require('node:assert/strict'),test=require('node:test'),{readFileSync}=require('node:fs'),ts=require('typescript');
function metadata(specialist){
 const out={},deps={
  '@/lib/publication-open-graph':require('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('publication-open-graph'),
  'next/navigation':{},'react/jsx-runtime':{},'@/components/SiteHeader':{},'@/components/SpecialistProfileDetail':{},'@/components/PublicationComplaintLink':{},'@/components/listings/ListingViewTracker':{},'@/lib/map-location':{},
  '@/lib/mock-store':{listSpecialists:()=>[]},'@/lib/runtime-mode':{shouldShowFallbackContent:()=>false},'@/lib/specialist-profile-store':{getStoredSpecialistProfileById:async()=>specialist},
 };
 new Function('exports','require',ts.transpileModule(readFileSync('src/app/specialist/[slug]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];});
 return out.generateMetadata({params:Promise.resolve({slug:'test'})});
}
test('single-about specialist metadata uses profession when the obsolete skills field is empty',async()=>{
 assert.equal((await metadata({name:'Анна',profession:'Сантехник',skills:'',city:'Краснодар'})).description,'Сантехник. Краснодар.');
 assert.equal((await metadata({name:'Анна',profession:'Сантехник',skills:'Монтаж',city:'Краснодар'})).description,'Монтаж. Краснодар.');
});
test('a public TEST specialist card is noindex and retains its canonical URL',async()=>{
 const profile={name:'Тестовый специалист',profession:'Сантехник',skills:'',city:'Краснодар'};
 const testCard=await metadata({...profile,testPublication:true});
 assert.deepEqual(testCard.robots,{index:false,follow:true});
 assert.equal(testCard.alternates.canonical,'/specialist/test');
 assert.equal((await metadata(profile)).robots,undefined);
});
