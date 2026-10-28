const assert=require('node:assert/strict'),test=require('node:test'),{readFileSync}=require('node:fs'),ts=require('typescript');
function metadata(specialist){
 const out={},deps={
  'next/navigation':{},'react/jsx-runtime':{},'@/components/SiteHeader':{},'@/components/SpecialistProfileDetail':{},'@/components/listings/ListingViewTracker':{},'@/lib/map-location':{},
  '@/lib/mock-store':{listSpecialists:()=>[]},'@/lib/runtime-mode':{shouldShowFallbackContent:()=>false},'@/lib/specialist-profile-store':{getStoredSpecialistProfileById:async()=>specialist},
 };
 new Function('exports','require',ts.transpileModule(readFileSync('src/app/specialist/[slug]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];});
 return out.generateMetadata({params:Promise.resolve({slug:'test'})});
}
test('single-about specialist metadata uses profession when the obsolete skills field is empty',async()=>{
 assert.equal((await metadata({name:'Анна',profession:'Сантехник',skills:'',city:'Краснодар'})).description,'Сантехник. Краснодар.');
 assert.equal((await metadata({name:'Анна',profession:'Сантехник',skills:'Монтаж',city:'Краснодар'})).description,'Монтаж. Краснодар.');
});
