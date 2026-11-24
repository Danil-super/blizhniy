const assert=require('node:assert/strict'),{test}=require('node:test'),{readFileSync}=require('node:fs'),{resolve}=require('node:path'),ts=require('typescript');
const options=[{value:'a',label:'Армавир'},{value:'k',label:'Краснодар'},{value:'r',label:'Крымск'}];
const nodes=value=>value&&typeof value==='object'?[value,...[value.props?.children].flat(Infinity).flatMap(nodes)]:[];
function fixture(props={}){
 const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,active=null;const changes=[],events=[],exports={},jsx=(type,props)=>({type,props});
 const react={useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(initial){return refs[refIndex++]??(refs[refIndex-1]={current:initial});},useMemo:callback=>callback(),useEffect:callback=>effects.push(callback),useId:()=> 'synthetic-select'};
 const code=ts.transpileModule(readFileSync(resolve(__dirname,'../src/components/DropdownSelect.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};assert.equal(name,'lucide-react');return{ChevronDown:'icon'};},exports);
 const doc={addEventListener(){},removeEventListener(){}};const before=global.document;global.document=doc;
 function render(){stateIndex=0;refIndex=0;effects.length=0;const tree=exports.DropdownSelect({name:'city',options,onValueChange:value=>changes.push(value),...props});
  const all=nodes(tree),trigger=all.find(node=>node.type==='button'&&node.props.role!=='option'),items=all.filter(node=>node.props.role==='option');
  const button={focus(){active='trigger';},matches:()=>false};if(trigger.props.ref)trigger.props.ref.current=button;
  if(tree.props.ref)tree.props.ref.current={
   contains:node=>node==='inside',querySelectorAll:()=>items.map((_,index)=>({focus(){active=index;},scrollIntoView(){}})),
   closest:selector=>selector==='form'?{}:null,dispatchEvent:event=>events.push(event),
  };
  for(const effect of effects)effect();return{tree,trigger,items,list:all.find(node=>node.props.role==='listbox'),hidden:all.find(node=>node.props.type==='hidden'),proxy:all.find(node=>node.props.required)};
 }
 function key(view,key,extra={}){let prevented=0;const event={key,timeStamp:1000,preventDefault(){prevented++;},stopPropagation(){},...extra};(view.tree.props.onKeyDown??view.trigger.props.onKeyDown)(event);return prevented;}
 return{render,key,changes,events,active:()=>active,close:()=>{global.document=before;}};
}
test('dropdown arrows browse without committing; Enter commits and Escape cancels with trigger focus',()=>{
 const f=fixture({defaultValue:'k'});try{let v=f.render();f.key(v,'ArrowDown');v=f.render();assert.ok(v.list);assert.equal(f.active(),1);assert.equal(v.trigger.props['aria-controls'],v.list.props.id);assert.ok(v.list.props['aria-labelledby']);
  f.key(v,'ArrowDown');v=f.render();assert.equal(f.active(),2);assert.equal(v.hidden.props.value,'k');assert.deepEqual(f.changes,[]);
  f.key(v,'Escape');v=f.render();assert.equal(v.list,undefined);assert.equal(v.hidden.props.value,'k');assert.equal(f.active(),'trigger');
  f.key(v,'End');v=f.render();assert.equal(f.active(),2);f.key(v,'Enter');v=f.render();assert.equal(v.list,undefined);assert.equal(v.hidden.props.value,'r');assert.deepEqual(f.changes,['r']);assert.equal(f.active(),'trigger');
  f.key(v,'End');v=f.render();f.key(v,'Enter');
  assert.deepEqual(f.events.map(event=>[event.type,event.bubbles]),[['input',true]]);
 }finally{f.close();}
});
test('dropdown Home/End and Cyrillic type-ahead move focus, with one Tab stop and no forced selection on Tab',()=>{
 const f=fixture();try{let v=f.render();f.key(v,'К');v=f.render();assert.equal(f.active(),1);f.key(v,'р',{timeStamp:1100});v=f.render();assert.equal(f.active(),1);
  f.key(v,'Home');v=f.render();assert.equal(f.active(),0);f.key(v,'End');v=f.render();assert.equal(f.active(),2);assert.equal(v.items.filter(item=>item.props.tabIndex===0).length,1);assert.equal(v.items[2].props.tabIndex,0);
  assert.equal(f.key(v,'Tab'),0);v=f.render();assert.equal(v.list,undefined);assert.equal(v.hidden.props.value,'');assert.deepEqual(f.changes,[]);
 }finally{f.close();}
});
test('touch pointerdown does not commit a scrolling gesture; click commits once and controlled state remains external',()=>{
 const f=fixture({value:'a'});try{let v=f.render();v.trigger.props.onClick();v=f.render();v.items[1].props.onPointerDown?.({pointerType:'touch',preventDefault(){},stopPropagation(){}});assert.deepEqual(f.changes,[]);
  v.items[1].props.onClick({stopPropagation(){}});v=f.render();assert.deepEqual(f.changes,['k']);assert.equal(v.hidden.props.value,'a');assert.equal(v.list,undefined);
 }finally{f.close();}
});
test('required dropdown participates in native validity and presents an accessible actionable error',()=>{
 const f=fixture({required:true});try{let v=f.render();assert.ok(v.proxy);assert.notEqual(v.proxy.props.readOnly,true);let prevented=0;v.proxy.props.onInvalid({preventDefault(){prevented++;}});v=f.render();assert.equal(prevented,1);assert.equal(v.proxy.props['aria-invalid'],true);assert.ok(v.trigger.props['aria-describedby']);assert.ok(nodes(v.tree).some(node=>node.props.role==='alert'));
  f.key(v,'Enter');v=f.render();assert.equal(v.proxy.props['aria-invalid'],undefined);assert.equal(v.hidden.props.value,'a');
 }finally{f.close();}
});
test('repeated Cyrillic characters cycle matching options and navigation stays bounded',()=>{
 const f=fixture();try{let v=f.render();f.key(v,'К');v=f.render();assert.equal(f.active(),1);f.key(v,'К',{timeStamp:1100});v=f.render();assert.equal(f.active(),2);f.key(v,'К',{timeStamp:1200});v=f.render();assert.equal(f.active(),1);
  f.key(v,'End');v=f.render();f.key(v,'ArrowDown');v=f.render();assert.equal(f.active(),2);f.key(v,'Home');v=f.render();f.key(v,'ArrowUp');v=f.render();assert.equal(f.active(),0);assert.deepEqual(f.changes,[]);
 }finally{f.close();}
});
test('an emptied option list closes safely and never submits a stale controlled value',()=>{
 const available=[...options],f=fixture({options:available,value:'k'});try{let v=f.render();v.trigger.props.onClick();v=f.render();assert.ok(v.list);available.length=0;f.render();v=f.render();assert.equal(v.list,undefined);assert.equal(v.hidden.props.value,'');assert.equal(f.active(),'trigger');assert.deepEqual(f.changes,[]);
 }finally{f.close();}
});
