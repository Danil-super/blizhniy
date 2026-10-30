const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),ts=require('typescript');
const {loadLocalPrimaryModule}=require('../scripts/local-primary-modules.cjs');
function tree(kind,profile,initial){
 const jsx=(type,props)=>({type,props}),out={},deps={react:{useId:()=>'',useRef:()=>({current:null}),useState:x=>[x,()=>{}]},'react/jsx-runtime':{jsx,jsxs:jsx},
  '@/components/FormPanel':{Field:'field',PhotoField:'photos',TextAreaField:'textarea'},'@/components/listings/ListingFormControls':{ListingLocationFields:'location'},
  '@/components/LegalConsentCheckbox':{LegalConsentCheckbox:'legal',LegalLink:'link'},'@/components/cabinet/CookieCabinetProfileProvider':{useCookieCabinetProfile:()=>({ownerId:'owner',profile})},
  '@/lib/data':{professions:[],fairCategories:[]},'@/components/listings/PrivateDraftEditor':{draftButton:''},'@/components/PublicationPhotoEditor':{PublicationPhotoEditor:'savedPhotos'},'@/components/StoredMedia':{StoredMediaImage:'img'},
  '@/components/work/ProfessionSelect':{ProfessionSelect:'professionSelect'},'@/components/CabinetFormValidation':{CabinetFormValidation:'validation'},
  '@/components/work/PrimaryProfessionSelect':{PrimaryProfessionSelect:'professionSelect'},
  '@/lib/specialist-application-profile':loadLocalPrimaryModule('specialist-application-profile'),
  './useServicePublicationSave':{useServicePublicationSave:()=>({})}};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/components/services/ServicePublicationForm.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},out);
 const result=out.ServicePublicationForm({owner:'owner',kind,initial,onSaved(){}}),nodes=[];
 function visit(n){if(!n||typeof n!=='object')return;nodes.push(n);[n.props?.children].flat(Infinity).forEach(visit);}visit(result);return nodes;
}
test('specialist has catalogue profession, readonly profile identity and no duplicate name, district, video or media editor',()=>{
 const nodes=tree('specialist',{name:'Анна',avatarDataUrl:'data:image/png;base64,AAAA'});
 assert.ok(nodes.some(n=>n.type==='professionSelect'));
 assert.ok(nodes.some(n=>n.type==='img'&&n.props.src==='data:image/png;base64,AAAA'));
 assert.ok(nodes.some(n=>n.type==='input'&&n.props.type==='hidden'&&n.props.name==='title'&&n.props.value==='Анна'));
 assert.ok(!nodes.some(n=>['field','textarea'].includes(n.type)&&['title','district','videoUrl'].includes(n.props.name)));
 assert.ok(!nodes.some(n=>['photos','savedPhotos'].includes(n.type)));
 assert.ok(nodes.some(n=>n.type==='a'&&n.props.href==='/cabinet?settings=1'));
});
test('specialist has a single about field and saves for applications without a moderation submit control',()=>{
 const nodes=tree('specialist',{name:'Анна'},{form:{kind:'specialist',description:'Ремонт сантехники.',skills:'Монтаж',experience:'5 лет'}});
 const fields=nodes.filter(n=>n.type==='textarea');assert.equal(fields.length,1);assert.equal(fields[0].props.label,'О себе');
 assert.equal(fields[0].props.name,'description');assert.match(fields[0].props.defaultValue,/Ремонт сантехники/);assert.match(fields[0].props.defaultValue,/Монтаж/);assert.match(fields[0].props.defaultValue,/5 лет/);
 assert.ok(nodes.some(n=>n.type==='button'&&n.props.type==='submit'&&n.props.children==='Сохранить анкету'));
 assert.ok(!nodes.some(n=>n.type==='button'&&n.props.children==='Отправить на модерацию'));
});
test('fair keeps its own title/media but district is not a separate field',()=>{
 const nodes=tree('fair',{});assert.ok(nodes.some(n=>n.type==='field'&&n.props.name==='title'));assert.ok(nodes.some(n=>n.type==='photos'));
 assert.ok(!nodes.some(n=>n.type==='field'&&n.props?.name==='district'));
});
