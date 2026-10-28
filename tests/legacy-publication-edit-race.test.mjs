import assert from 'node:assert/strict';import test from 'node:test';import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
function fixture(kind,race){
 const row={id,author_id:owner,status:'published',is_paid:true,published_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',listing_type:'sell',title:'Старое название',description:'Описание',show_exact_address:false,organization_name:'Организация',listing_images:[],vacancy_images:[],cities:{name:'Краснодар',slug:'krasnodar'},categories:{name:'Разное',slug:'raznoe'}};
 const calls=[];let raced=false;
 const rest=async(path,options={})=>{
  const url=new URL(path,'https://example.invalid'),method=options.method??'GET';calls.push({url,method,body:options.body});
  if(url.pathname==='/rest/v1/categories') return [{id:owner,name:'Разное',slug:'raznoe',parent_id:null}];
  if(url.pathname==='/rest/v1/cities') {if(!raced){raced=true;race?.(row);}return[{id:owner,name:'Краснодар',slug:'krasnodar',region_id:owner}];}
  if(url.pathname==='/rest/v1/'+kind){
   if(url.searchParams.get('author_id')&&url.searchParams.get('author_id')!=='eq.'+row.author_id)return[];
   if(method==='PATCH'){
    if(url.searchParams.get('status')!=='eq.'+row.status)return[];
    Object.assign(row,options.body);return[{...row}];
   }return[{...row}];
  }
  if(url.pathname==='/rest/v1/listing_images'||url.pathname==='/rest/v1/vacancy_images')return[];
  throw Error('Unexpected REST '+method+' '+path);
 };
 const dependencies={
  '@/lib/data':{region:{slug:'krasnodar'},vacancies:[]},
  '@/lib/booking-details':{formatBookingPrice:()=>''},
  '@/lib/map-location':{hasMapCoordinates:()=>false},
  '@/lib/publication-time':{effectivePublicationStatus:status=>status},
  '@/lib/storage-upload':{publicMediaUrl:path=>path},
  '@/lib/runtime-mode':{shouldShowFallbackContent:()=>false},
  '@/lib/supabase-rest':{isSupabaseRestConfigured:()=>true,isUuid:()=>true,supabaseRest:rest},
 };
 const module={exports:{}};const name=kind==='listings'?'listing':'vacancy';
 const js=ts.transpileModule(readFileSync(new URL('../src/lib/'+name+'-store.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(key=>{assert.ok(key in dependencies,key);return dependencies[key];},module,module.exports);
 const save=module.exports[kind==='listings'?'saveStoredListingForUser':'saveStoredVacancyForUser'];
 return{row,calls,save:(user=owner)=>save(id,user,{authorId:owner,title:'Новое название',description:'Описание работы',kind:'prodam',categorySlug:'raznoe',city:'Краснодар',organization:'Организация',mediaPaths:[],price:'100',salary:'100'})};
}
for(const kind of ['listings','vacancies']){
 test(kind+': concurrent administrative rejection wins over stale owner save and photo replacement',async()=>{
  for(const status of ['rejected','archived']){const f=fixture(kind,row=>{row.status=status;});assert.equal(await f.save(),undefined);assert.equal(f.row.status,status);assert.equal(f.row.title,'Старое название');assert.equal(f.calls.some(c=>/images$/.test(c.url.pathname)),false);}
 });
 test(kind+': steady owner edits succeed, keep payment and dates, and retain owner predicate',async()=>{
  const f=fixture(kind);assert.ok(await f.save());assert.equal(f.row.title,'Новое название');assert.equal(f.row.published_at,'2026-10-01T00:00:00Z');assert.equal(f.row.is_paid,true);
  const patch=f.calls.find(c=>c.method==='PATCH');assert.equal(patch.url.searchParams.get('author_id'),'eq.'+owner);assert.equal(patch.url.searchParams.get('status'),'eq.published');assert.equal('is_paid'in patch.body,false);assert.equal('published_at'in patch.body,false);
  const foreign=fixture(kind);assert.equal(await foreign.save(id),undefined);assert.equal(foreign.calls.some(c=>c.method==='PATCH'),false);
 });
 test(kind+': concurrent payment revocation never becomes paid again through content save',async()=>{
  const f=fixture(kind,row=>{row.is_paid=false;});await f.save();assert.equal(f.row.is_paid,false);
 });
}
