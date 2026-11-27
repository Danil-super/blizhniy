const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {TwoRowCardViewport}=require('./load-two-row-viewport.cjs')({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})});
const jsx=(type,props)=>type===TwoRowCardViewport?type(props):({type,props});
function render(items=[]){
 let state=0;const out={},deps={react:{useState:value=>[state++===0?{items,nextCursor:null,workflow:'postmoderation'}:value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'@/lib/client-listing-drafts':{},'@/lib/client-listing-cabinet':{},'@/lib/local-account':{},
  './PrivateDraftModeration':{},'./PrivateListingCheckout':{},'./PrivateDraftEditor':{draftButton:'button'},'./CabinetListingCard':{},
  './ListingOwnerRemoveButton':{},'./ListingWorkflowProvider':{useDraftRemovals:()=>false},'@/components/cabinet/TwoRowCardViewport':{TwoRowCardViewport}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/listings/ListingCabinetList.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(out,key=>{if(!Object.hasOwn(deps,key))throw Error(key);return deps[key];});
 return out.ListingCabinetList({owner:'synthetic',visible:true,enriched:true});
}
const walk=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
test('cabinet has one create action and no permanent manual refresh control',()=>{
 const all=walk(render());assert.equal(all.some(node=>node.type==='button'&&node.props.children==='Обновить список'),false);
 assert.equal(all.filter(node=>node.props?.href==='/razmestit/obyavlenie').length,1);
});
test('populated owner listings are a labeled keyboard-focusable bounded scroll area',()=>{
 const tree=render([{id:'10000000-0000-4000-8000-000000000001',revision:'1',kind:'prodam',title:'Комод',price:'3500.00',card:{status:'draft',city:'Сочи',district:null,coverPhotoId:null,blockReason:null}}]);
 const region=walk(tree).find(node=>node.props?.role==='region');assert.ok(region);assert.equal(region.props.tabIndex,0);
 assert.equal(region.props['aria-label'],'Прокручиваемый список моих объявлений');assert.match(region.props.className,/max-h-\[65vh\]/);assert.match(region.props.className,/overflow-y-auto/);
});
