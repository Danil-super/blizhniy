const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),ts=require('typescript');
class Target{constructor(menu=null){this.menu=menu;}closest(){return this.menu;}}
function root(){
 const out={},jsx=(type,props)=>({type,props}),deps={react:{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){}},'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{},
  '@/lib/client-listing-drafts':{},'@/lib/client-listing-cabinet':{},'@/lib/local-account':{},'./PrivateDraftModeration':{},'./PrivateListingCheckout':{},'./PrivateDraftEditor':{},'./CabinetListingCard':{},
  './ListingOwnerRemoveButton':{},'./ListingWorkflowProvider':{useDraftRemovals:()=>false},'@/components/cabinet/TwoRowCardViewport':{}};
 new Function('exports','require','Element',ts.transpileModule(fs.readFileSync('src/components/listings/ListingCabinetList.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,key=>{assert.ok(Object.hasOwn(deps,key),key);return deps[key];},Target);
 return out.ListingCabinetList({owner:'owner',visible:true,enriched:true});
}
test('opening another card action or pressing another button closes the old menu without disturbing the clicked native details',()=>{
 const first={open:true},second={open:false},tree=root();assert.equal(typeof tree.props.onClickCapture,'function');
 tree.props.onClickCapture({target:new Target(second),currentTarget:{querySelectorAll:()=>[first]}});assert.equal(first.open,false);assert.equal(second.open,false);
 first.open=true;tree.props.onClickCapture({target:new Target(first),currentTarget:{querySelectorAll:()=>[first]}});assert.equal(first.open,true,'native summary still owns its own toggle');
 tree.props.onClickCapture({target:new Target(),currentTarget:{querySelectorAll:()=>[first]}});assert.equal(first.open,false,'status/payment buttons also close an open menu');
});
test('Escape closes open action disclosure and restores its summary focus',()=>{
 let focused=0,prevented=0;const menu={open:true,contains:()=>true,querySelector:()=>({focus:()=>focused++})},tree=root();
 assert.equal(typeof tree.props.onKeyDown,'function');tree.props.onKeyDown({key:'Escape',target:new Target(menu),preventDefault:()=>prevented++,currentTarget:{querySelectorAll:()=>[menu]}});
 assert.equal(menu.open,false);assert.equal(focused,1);assert.equal(prevented,1);
});
