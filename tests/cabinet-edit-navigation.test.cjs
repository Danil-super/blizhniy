const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const ts=require('typescript');
const owner='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';

function load(relative,{openService=false}={}){
 let stateIndex=0;
 const out={};
 const code=ts.transpileModule(readFileSync(resolve(__dirname,'../src/components',relative),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
 }).outputText;
 const service={id,kind:'fair',revision:'1',status:'draft',paid:false,updatedAt:'2026-10-21T12:00:00.000001Z',form:{kind:'fair',title:'Керамика'},photos:[]};
 new Function('require','exports',code)(name=>{
  if(name==='react')return {...React,useEffect(){},useRef:value=>({current:value}),useState:value=>{
   const index=stateIndex++;
   if(openService&&index===2)return [{items:[service],nextCursor:null},()=>{}];
   if(openService&&index===3)return [service,()=>{}];
   return [typeof value==='function'?value():value,()=>{}];
  }};
  if(name.endsWith('/TwoRowCardViewport'))return require('./load-two-row-viewport.cjs')(require('react/jsx-runtime'));
  if(name==='next/link')return {__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}};
  if(name.endsWith('/AccountAuthProvider'))return {usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})};
  if(name.endsWith('/CookieCabinetProfileProvider'))return {CookieCabinetProfileProvider:({children})=>React.createElement('div',{'data-profile-provider':true},children)};
  if(name.endsWith('/ListingWorkflowProvider'))return {useListingPostmoderation:()=>true,useLocalPaymentSimulation:()=>true,useWorkOwnerActions:()=>false,useDraftRemovals:()=>false};
  if(name.endsWith('/ListingOwnerRemoveButton'))return {ListingOwnerRemoveButton:()=>null};
  if(name==='./WorkOwnerActions')return {WorkOwnerActions:()=>null};
  if(name.endsWith('/PrivateDraftEditor'))return {draftButton:'button'};
  if(name.endsWith('/local-account'))return {notifyAccountSessionChange(){}};
  if(name.endsWith('/client-work-publications'))return {productionWorkPublications:{}};
  if(name.endsWith('/client-work-cabinet'))return {workCabinet:{}};
  if(name.endsWith('/client-service-publications'))return {servicePublications:{}};
  if(name.endsWith('/work-cabinet-contract'))return {parseWorkCabinetStatus:value=>value};
  if(name.endsWith('/service-publication-navigation'))return {servicePublicationNavigation:{fair:{form:'/yarmarka-masterov/zayavka',cabinet:'/cabinet/fair-applications',create:'Новая заявка на ярмарку'}}};
  if(name==='./WorkPublicationForm')return {WorkPublicationForm:()=>React.createElement('form',{'data-editable-form':true})};
  if(name==='./ServicePublicationForm')return {serviceFormLabels:{fair:'Заявка на ярмарку',specialist:'Анкета специалиста',marquee:'Рекламный текст'},ServicePublicationForm:()=>React.createElement('form',{'data-editable-form':true})};
  if(name==='./WorkModerationStatus')return {WorkModerationStatus:()=>null};
  if(name==='./ServiceModerationStatus')return {ServiceModerationStatus:()=>null};
  if(name==='./SpecialistApplicationStatus')return {SpecialistApplicationStatus:()=>null};
  if(name==='./SpecialistProfilePanel')return {SpecialistProfilePanel:()=>React.createElement('section',{'data-single-questionnaire':true})};
  if(name==='./WorkCabinetCard')return {WorkCabinetCard:()=>null};
  if(name==='./ServicePublicationsPanel')return {ServicePublicationsPanel:()=>React.createElement('section',{'data-cabinet-list':true})};
  if(name==='./PrimaryServicePublicationEditor')return {PrimaryServicePublicationEditor:()=>React.createElement('section',{'data-standalone-editor':true})};
  if(name==='./PrimaryWorkPublicationEditor')return {PrimaryWorkPublicationEditor:()=>React.createElement('section',{'data-standalone-editor':true})};
  return require(name);
 },out);
 return out;
}

for(const kind of ['vacancy','workRequest'])test(`${kind} edit workspace never offers creation of another publication`,()=>{
 const {WorkPublicationsPanel}=load('work/WorkPublicationsPanel.tsx');
 const html=renderToStaticMarkup(React.createElement(WorkPublicationsPanel,{kind,initialId:id}));
 assert.doesNotMatch(html,/Создать вакансию|Создать заказ/);
 assert.match(html,/data-standalone-editor/);
});

for(const kind of ['fair','specialist','marquee'])test(`${kind} original placement page uses a standalone editor, not the cabinet list`,()=>{
 const {PrimaryServicePublicationPage}=load('services/PrimaryServicePublicationPage.tsx');
 const html=renderToStaticMarkup(React.createElement(PrimaryServicePublicationPage,{kind}));
 assert.doesNotMatch(html,/data-cabinet-list/);
 assert.match(html,/data-standalone-editor/);
 assert.match(html,/data-profile-provider/);
});

test('service cabinet selected Details stays read-only instead of embedding a second edit form',()=>{
 const {ServicePublicationsPanel}=load('services/ServicePublicationsPanel.tsx',{openService:true});
 const html=renderToStaticMarkup(React.createElement(ServicePublicationsPanel,{kind:'fair'}));
 assert.doesNotMatch(html,/data-editable-form/);
});
