const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function render(initial){
 const jsx=(type,props)=>({type,props}),exportsObject={},select=()=>null;
 const dependencies={react:{useRef:()=>({current:null}),useState:value=>[value,()=>{}],useId:()=> 'profession'},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@/components/FormPanel':{},'@/components/VacancyEmployerFields':{},'./VacancyEmployerFlow':{},
  '@/components/listings/ListingWorkflowProvider':{useListingPostmoderation:()=>true,useLocalPaymentSimulation:()=>true},'@/components/listings/ListingFormControls':{},'@/components/LegalConsentCheckbox':{},
  '@/lib/data':{professions:[]},'@/components/listings/PrivateDraftEditor':{draftButton:'button'},'./WorkPublicationPhotos':{},'./WorkAmountField':{},
  './ProfessionSelect':{ProfessionSelect:select},'./VacancyTermsFields':{},
  '@/components/PublicationPhotoEditor':{},'@/components/CabinetFormValidation':{},
  './useWorkPublicationSave':{useWorkPublicationSave:()=>({active:false,done:false,busy:false,uncertain:false})}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/work/WorkPublicationForm.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exportsObject,name=>{
  if(!Object.hasOwn(dependencies,name))throw Error('Unexpected form dependency: '+name);return dependencies[name];
 });
 const root=exportsObject.WorkPublicationForm({owner:'synthetic',kind:'workRequest',initial}),nodes=[];
 function walk(node){if(!node||typeof node!=='object')return;nodes.push(node);[node.props?.children].flat(Infinity).forEach(walk);}
 walk(root);return{nodes,select};
}
test('a new local work request uses the shared searchable profession and explicit draft/pay actions, not moderation',()=>{
 const {nodes,select}=render();
 assert.equal(nodes.filter(node=>node.type===select).length,1);
 const text=JSON.stringify(nodes.filter(node=>node.type==='button').map(node=>node.props.children));
 assert.match(text,/Сохранить черновик/);assert.match(text,/Оплатить/);assert.doesNotMatch(text,/модерацию/);
 assert.equal(nodes.some(node=>node.type==='datalist'),false);
});
test('a saved unpaid work request still offers payment from its canonical edit form',()=>{
 const {nodes}=render({id:'synthetic',paid:false,form:{kind:'workRequest',title:'Нужен ремонт',photoIds:[],budget:'4500.00'}});
 assert.ok(nodes.some(node=>node.type==='button'&&node.props.type==='submit'&&node.props.children==='Оплатить'));
});
