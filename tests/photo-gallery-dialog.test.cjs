const assert=require('node:assert/strict'),{test}=require('node:test'),{readFileSync}=require('node:fs'),{resolve}=require('node:path'),ts=require('typescript');
function fixture(images=['/one.webp','/two.webp']){
 const state=[[],0,true],effects=[];let cursor=0;const out={},jsx=(type,props)=>({type,props});
 const deps={
  react:{useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},useRef:initial=>({current:initial}),useEffect:callback=>effects.push(callback)},
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':{ChevronLeft:'left',ChevronRight:'right',X:'close'},
  '@/components/StoredMedia':{StoredMediaImage:'image'},'@/lib/client-runtime-mode':{shouldShowClientFallbackContent:()=>false},'@/lib/demo-publications':{readStoredDemoPublications:()=>null},
  '@/lib/dialog-keyboard':require('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('dialog-keyboard'),
 };
 const source=readFileSync(resolve(__dirname,'../src/components/DetailImageGallery.tsx'),'utf8');
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{assert.ok(Object.hasOwn(deps,name));return deps[name];},out);
 return{state,effects,tree:out.DetailImageGallery({images,title:'Синтетическая галерея',fallbackIcon:null})};
}
const nodes=value=>value&&typeof value==='object'?[value,...[value.props?.children].flat(Infinity).flatMap(nodes)]:[];
test('public photo dialog opens in the top layer and closes its captured node during unmount',()=>{
 const f=fixture(),dialog=nodes(f.tree).find(node=>node.type==='dialog');assert.ok(dialog);assert.equal(dialog.props['aria-label'],'Фото: Синтетическая галерея');
 const calls=[];dialog.props.ref.current={ownerDocument:{activeElement:null},showModal:()=>calls.push('open'),close:()=>calls.push('close')};const cleanup=f.effects.at(-1)();assert.deepEqual(calls,['open']);
 dialog.props.ref.current=null;cleanup();assert.deepEqual(calls,['open','close']);
});
test('photo navigation is local to the modal, bounded, announced and cancelable',()=>{
 const f=fixture(),all=nodes(f.tree),dialog=all.find(node=>node.type==='dialog');assert.ok(dialog);
 const counter=nodes(dialog).find(node=>node.props['aria-live']==='polite');assert.ok(counter);assert.equal(counter.props['aria-atomic'],'true');
 let prevented=0;dialog.props.onKeyDown({key:'ArrowLeft',preventDefault:()=>prevented++});assert.equal(f.state[1],1);
 dialog.props.onKeyDown({key:'ArrowRight',preventDefault:()=>prevented++});assert.equal(f.state[1],0);assert.equal(prevented,2);
 dialog.props.onCancel({preventDefault:()=>prevented++});assert.equal(f.state[2],false);
});
test('removing all photos while the viewer is open closes its state without leaving a stale key listener',()=>{
 const f=fixture([]);assert.equal(nodes(f.tree).some(node=>node.type==='dialog'),false);f.effects.at(-1)();assert.equal(f.state[2],false);assert.equal(f.state[1],0);
});
