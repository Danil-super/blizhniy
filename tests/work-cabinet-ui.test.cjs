const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const ts=require('typescript');
const owner='11111111-1111-4111-8111-111111111111';
const item={id:owner,kind:'vacancy',revision:'2',status:'published',paid:true,title:'Сантехник',updatedAt:'2026-10-21T12:00:00.123456Z',
 amount:'65000.00',organization:'Мастер',city:'Сочи',district:'Центральный',profession:'Сантехник',schedule:'Полный день',workFormat:'На месте',coverPhotoId:null};
function load(file){
 const exports={};
 const code=ts.transpileModule(readFileSync(resolve(__dirname,'../src/components/work/',file+'.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
 }).outputText;
 new Function('require','exports',code)(name=>{
  if(name==='next/link')return {__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}};
  if(name==='./WorkCabinetPhoto')return {WorkCabinetPhoto:()=>React.createElement('span',{'data-photo-frame':true,className:'aspect-[4/3]'})};
  if(name==='./WorkCabinetCard')return load('WorkCabinetCard');
  if(name.endsWith('/TwoRowCardViewport'))return require('./load-two-row-viewport.cjs')(require('react/jsx-runtime'));
  if(name.endsWith('/ListingBadges'))return load('../listings/ListingBadges');
  if(name.endsWith('/PrivateDraftEditor'))return {draftButton:'min-h-11'};
  if(name.endsWith('/AccountAuthProvider'))return {usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})};
  if(name.endsWith('/ListingWorkflowProvider'))return {useListingPostmoderation:()=>true,useLocalPaymentSimulation:()=>true};
  if(name.endsWith('/local-account'))return {notifyAccountSessionChange(){}};
  if(name.endsWith('/client-work-publications'))return {productionWorkPublications:{}};
  if(name.endsWith('/client-work-cabinet'))return {workCabinet:{}};
  if(name.endsWith('/work-cabinet-contract'))return {parseWorkCabinetStatus:value=>value};
  if(name==='./WorkPublicationForm')return {WorkPublicationForm:()=>null};
  if(name==='./PrimaryWorkPublicationEditor')return {PrimaryWorkPublicationEditor:()=>null};
  if(name==='./WorkModerationStatus')return {WorkModerationStatus:()=>null};
  return require(name);
 },exports);return exports;
}
test('vacancy cabinet card has compact catalogue hierarchy, employer, salary, location, status and explicit owner actions',()=>{
 const {WorkCabinetCard}=load('WorkCabinetCard');
 const html=renderToStaticMarkup(React.createElement(WorkCabinetCard,{owner,item,onDetails(){},disabled:false}));
 for(const text of ['Сантехник','Мастер','Сочи','Центральный','Полный день','На месте','Опубликовано','Подробнее','Редактировать','Посмотреть'])assert.ok(html.includes(text),text);
 assert.match(html,/65(?:\s|&#x27;|&#xA0;|&#x202F;| | )+000/);
 assert.match(html,/href="\/rabota\/vakansii\/[^"]+\/edit"/);
 assert.match(html,/href="\/vakansiya\//);
 assert.match(html,/data-photo-frame/);
 assert.doesNotMatch(html,/6500000|Обновить список/);
});
test('draft cards never link to a public page and still permit editing',()=>{
 const {WorkCabinetCard}=load('WorkCabinetCard');
 const html=renderToStaticMarkup(React.createElement(WorkCabinetCard,{owner,item:{...item,status:'draft',amount:null},onDetails(){},disabled:false}));
 assert.match(html,/Черновик/);assert.match(html,/По договорённости/);assert.match(html,/Редактировать/);
 assert.doesNotMatch(html,/href="\/vakansiya\/|>Посмотреть</);
});
test('work cabinet list is bounded, keyboard-scrollable and uses compact multi-column cards',()=>{
 const {WorkCabinetList}=load('WorkPublicationsPanel');
 const html=renderToStaticMarkup(React.createElement(WorkCabinetList,{owner,page:{items:[item],nextCursor:null},disabled:false,onDetails(){}}));
 assert.match(html,/role="region"[^>]*aria-label="Список вакансий"[^>]*tabIndex="0"/i);
 assert.match(html,/max-h-\[[^\]]+\].*overflow-y-auto/);
 assert.match(html,/sm:grid-cols-2/);assert.match(html,/xl:grid-cols-4/);
});
test('successful initial work cabinet does not show a redundant Refresh button',()=>{
 const {WorkPublicationsPanel}=load('WorkPublicationsPanel');
 const html=renderToStaticMarkup(React.createElement(WorkPublicationsPanel,{kind:'vacancy'}));
 assert.match(html,/Создать вакансию/);assert.doesNotMatch(html,/Обновить список|Повторить загрузку/);
});
