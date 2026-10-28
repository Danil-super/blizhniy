const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function render(){
 const jsx=(type,props)=>({type,props}),exportsObject={};
 const dependencies={react:{useRef:()=>({current:null}),useState:value=>[value,()=>{}],useId:()=> 'profession'},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@/components/FormPanel':{},'@/components/VacancyEmployerFields':{},'./VacancyEmployerFlow':{},
  '@/components/listings/ListingWorkflowProvider':{useListingPostmoderation:()=>false,useLocalPaymentSimulation:()=>false},'@/components/listings/ListingFormControls':{},'@/components/LegalConsentCheckbox':{},
  '@/lib/data':{professions:[]},'@/components/listings/PrivateDraftEditor':{draftButton:'button'},'./WorkPublicationPhotos':{},'./WorkAmountField':{},
  './ProfessionSelect':{},'./VacancyTermsFields':{},
  '@/components/PublicationPhotoEditor':{},'@/components/CabinetFormValidation':{},
  './useWorkPublicationSave':{useWorkPublicationSave:()=>({active:true,done:false,busy:false,uncertain:false})}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/work/WorkPublicationForm.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exportsObject,name=>{
  if(!Object.hasOwn(dependencies,name))throw Error('Unapproved retry test dependency: '+name);return dependencies[name];
 });return exportsObject.WorkPublicationForm({owner:'synthetic',kind:'workRequest'});
}
test('a frozen saved intent still allows explicit retry after null readback; action buttons are outside the frozen fields',()=>{
 const buttons=[];
 function walk(node,frozen=false){if(!node||typeof node!=='object')return;const locked=frozen||node.type==='fieldset'&&!!node.props.disabled;
  if(node.type==='button')buttons.push({type:node.props.type,disabled:locked||!!node.props.disabled});
  [node.props?.children].flat(Infinity).forEach(child=>walk(child,locked));
 }
 walk(render());assert.equal(buttons.find(button=>button.type==='submit').disabled,false);assert.equal(buttons.find(button=>button.type==='button').disabled,false);
});
