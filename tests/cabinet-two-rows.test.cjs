const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

const owner='11111111-1111-4111-8111-111111111111';
const root=path.resolve(__dirname,'..');
const jsx=(type,props)=>({type,props:props||{}});
const listing=id=>({id,revision:'1',kind:'prodam',title:`Объявление ${id}`,price:'3500.00',card:{status:'draft',city:'Сочи',district:null,coverPhotoId:null,blockReason:null}});
const vacancy=id=>({id,kind:'vacancy',revision:'1',status:'published',paid:true,title:`Вакансия ${id}`,updatedAt:'2026-10-23T12:00:00Z',amount:'65000.00',organization:'Мастер',city:'Сочи',district:null,profession:'Сантехник',schedule:'5/2',workFormat:'На месте',coverPhotoId:null});
const walk=node=>Array.isArray(node)?node.flatMap(walk):!node||typeof node!=='object'?[]:[node,...walk(node.props?.children)];
const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);

/** Minimal deterministic hook host: real components, fake account/API boundary, no browser or network. */
function mount(kind,responses){
 const instances=new Map(),cache=new Map(),calls=[],effects=[];let current,tree,dirty=false;
 const react={
  useState(initial){const instance=current,index=instance.cursor++;if(!Object.hasOwn(instance.values,index))instance.values[index]=typeof initial==='function'?initial():initial;
   return [instance.values[index],value=>{const next=typeof value==='function'?value(instance.values[index]):value;if(!Object.is(next,instance.values[index])){instance.values[index]=next;dirty=true;}}];},
  useRef(initial){const instance=current,index=instance.cursor++;return instance.values[index]??=( {current:initial});},
  useEffect(effect,deps){const instance=current,index=instance.cursor++,previous=instance.values[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){instance.values[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();instance.values[index].cleanup=effect();});}},
  useMemo(factory,deps){const instance=current,index=instance.cursor++,previous=instance.values[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))instance.values[index]={deps,value:factory()};return instance.values[index].value;},
  createElement:(type,props,...children)=>jsx(type,{...props,children}),Fragment:({children})=>children,
 };
 react.useLayoutEffect=react.useEffect;react.useCallback=(callback,deps)=>react.useMemo(()=>callback,deps);
 const api={async list(...args){calls.push(args);const response=responses.shift();if(response instanceof Error)throw response;if(!response)throw Error('Unexpected page request');return response;}};
 const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:react.Fragment},'next/link':{__esModule:true,default:({children,...props})=>jsx('a',{...props,children})},
  '@/components/auth/AccountAuthProvider':{usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})},
  '@/components/listings/ListingWorkflowProvider':{useListingPostmoderation:()=>true,useWorkOwnerActions:()=>false,usePlacementRenewals:()=>false,useLocalPaymentSimulation:()=>true},
  '@/lib/local-account':{notifyAccountSessionChange(){}},
  '@/lib/client-listing-drafts':{productionDrafts:api},'@/lib/client-listing-cabinet':{listingCabinet:api,ListingCabinetClientError:class extends Error{}},
  '@/lib/client-work-cabinet':{workCabinet:api},'@/lib/client-work-publications':{productionWorkPublications:{}},
  '@/components/listings/PrivateDraftEditor':{draftButton:'button'},
 };
 function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename);const out={};cache.set(filename,out);
  const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('exports','require',compiled)(out,name=>{
   if(Object.hasOwn(deps,name))return deps[name];
   if(name==='./WorkOwnerActions')return {WorkOwnerActions:()=>null};
   if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
   if(name.endsWith('/CabinetListingCard')||name==='./CabinetListingCard')return {CabinetListingCard:({item,onChanged})=>jsx('article',{'data-record':item.id,onChanged,children:item.title})};
   if(name==='./WorkCabinetCard')return {WorkCabinetCard:({item})=>jsx('article',{'data-record':item.id,children:item.title})};
   if(name.endsWith('/PrivateDraftEditor')||name==='./PrivateDraftEditor')return {draftButton:'button'};
   if(/PrivateDraftModeration|PrivateListingCheckout|WorkModerationStatus|PrimaryWorkPublicationEditor/.test(name))return new Proxy({},{get:()=>()=>null});
   const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
   if(base){for(const extension of ['.tsx','.ts'])if(fs.existsSync(base+extension))return load(base+extension);}
   return require(name);
  });return out;
 }
 const component=kind==='listing'?load(path.join(root,'src/components/listings/ListingCabinetList.tsx')).ListingCabinetList:load(path.join(root,'src/components/work/WorkPublicationsPanel.tsx')).WorkPublicationsPanel;
 function expand(node,key='root'){
  if(Array.isArray(node))return node.map((child,index)=>expand(child,`${key}:${index}`));
  if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){const instance=instances.get(key)||{values:[],cursor:0};instances.set(key,instance);instance.cursor=0;const parent=current;current=instance;const rendered=node.type(node.props);current=parent;return expand(rendered,`${key}:render`);}
  return {...node,props:{...node.props,children:expand(node.props.children,`${key}:children`)}};
 }
 function render(){dirty=false;tree=expand(jsx(component,kind==='listing'?{owner,visible:true,enriched:true}:{kind:'vacancy'}));while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<12;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}return tree;}
 function scroll(){const regions=walk(tree).filter(node=>node.props?.role==='region');const region=regions.find(node=>typeof node.props.onScroll==='function');assert.ok(region,'The card viewport must load subsequent pages when its scroll reaches the end');region.props.onScroll({currentTarget:{scrollTop:900,scrollHeight:1000,clientHeight:400}});}
 render();return {settle,scroll,calls,get tree(){return tree;},records:()=>walk(tree).filter(node=>node.props?.['data-record']).map(node=>node.props['data-record'])};
}

for(const kind of ['listing','vacancy']){
 const make=kind==='listing'?listing:vacancy;
 const page=(items,nextCursor)=>({items:items.map(make),nextCursor,...(kind==='listing'?{workflow:'postmoderation'}:{})});
 test(`${kind} cabinet exposes scrolling instead of a redundant Next page control`,async()=>{
  const host=mount(kind,[page(['first'],'cursor-2')]);await host.settle();
  assert.equal(walk(host.tree).some(node=>node.type==='button'&&text(node)==='Следующая страница'),false);
 });
 test(`${kind} cabinet appends later scroll pages once and preserves earlier cards without duplicates`,async()=>{
  const host=mount(kind,[page(['first','second'],'cursor-2'),page(['second','third'],null)]);await host.settle();
  host.scroll();await host.settle();
  assert.deepEqual(host.records(),['first','second','third']);assert.equal(host.calls.length,2);
  host.scroll();await host.settle();assert.equal(host.calls.length,2,'End-of-list scrolling must not issue more page requests');
 });
 test(`${kind} cabinet preserves cards on a failed next page and waits for explicit retry`,async()=>{
  const host=mount(kind,[page(['first'],'cursor-2'),new Error('Synthetic offline'),page(['second'],null)]);await host.settle();
  host.scroll();await host.settle();assert.deepEqual(host.records(),['first']);assert.equal(host.calls.length,2);
  host.scroll();await host.settle();assert.equal(host.calls.length,2,'An error must not create an automatic scroll retry loop');
  const retry=walk(host.tree).find(node=>node.type==='button'&&/Повторить/.test(text(node)));assert.ok(retry,'A failed next page needs an explicit retry');retry.props.onClick();await host.settle();
  assert.deepEqual(host.records(),['first','second']);assert.equal(host.calls.length,3);
 });
}

test('a failed listing refresh retries the first page, not a next-page cursor from the stale snapshot',async()=>{
 const page=(ids,nextCursor)=>({items:ids.map(listing),nextCursor,workflow:'postmoderation'});
 const host=mount('listing',[page(['outdated'],'cursor-2'),new Error('Synthetic refresh failure'),page(['fresh'],null)]);await host.settle();
 walk(host.tree).find(node=>node.props?.['data-record']==='outdated').props.onChanged();await host.settle();
 assert.deepEqual(host.records(),['outdated'],'The last snapshot can remain during a transient refresh error');
 const retry=walk(host.tree).find(node=>node.type==='button'&&/Повторить/.test(text(node)));assert.ok(retry);retry.props.onClick();await host.settle();
 assert.deepEqual(host.records(),['fresh'],'Retry must replace the stale first page, not append a later page');
 assert.equal(host.calls[2][1],null,'A failed first-page refresh must retry without a pagination cursor');
});

test('vacancy cards in the cabinet only offer Edit and View, with no duplicate Details action',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),cache=new Map();
 function load(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
  const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',compiled)(name=>{
   if(name==='next/link')return {__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}};
   if(name.endsWith('/AccountAuthProvider'))return {usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})};
   if(name.endsWith('/ListingWorkflowProvider'))return {useListingPostmoderation:()=>true,useWorkOwnerActions:()=>false,usePlacementRenewals:()=>false,useLocalPaymentSimulation:()=>true};
   if(/client-work-publications|client-work-cabinet|local-account/.test(name))return {};
   if(name==='./WorkCabinetPhoto')return {WorkCabinetPhoto:()=>null};
   if(name==='./WorkOwnerActions')return {WorkOwnerActions:()=>null};
   if(/PrivateDraftEditor/.test(name))return {draftButton:'button'};
   if(/PrimaryWorkPublicationEditor|WorkModerationStatus/.test(name))return new Proxy({},{get:()=>()=>null});
   const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
   if(base){for(const extension of ['.tsx','.ts'])if(fs.existsSync(base+extension))return load(base+extension);}
   return require(name);
  },exports);return exports;
 }
 const {WorkCabinetList}=load(path.join(root,'src/components/work/WorkPublicationsPanel.tsx'));
 const html=renderToStaticMarkup(React.createElement(WorkCabinetList,{owner,page:{items:[vacancy('11111111-1111-4111-8111-111111111112')],nextCursor:null},disabled:false,onDetails(){}}));
 assert.match(html,/Редактировать/);assert.match(html,/Посмотреть/);assert.doesNotMatch(html,/Подробнее/);
});
