const assert=require('node:assert/strict'),{test}=require('node:test'),{readFileSync}=require('node:fs'),ts=require('typescript');
const first={id:'11111111-1111-4111-8111-111111111111',slug:'synthetic-first',name:'Первый мастер',parent:'Категория',active:true},second={...first,id:'22222222-2222-4222-8222-222222222222',slug:'synthetic-second',name:'Второй мастер'};
const nodes=value=>value&&typeof value==='object'?[value,...[value.props?.children].flat(Infinity).flatMap(nodes)]:[],find=(tree,role)=>nodes(tree).find(node=>node.props?.role===role);
function fixture(initial={}){
 const states=[],refs=[],out={},jsx=(type,props)=>({type,props});let index=0,refIndex=0,effects=[],props={required:true,catalog:[first,second],catalogState:'ready',...initial},dispatches=0;
 const input={value:'',dataset:{},setCustomValidity(value){this.validity=value;},matches:()=>false,dispatchEvent(){dispatches++;},focus(){}};
 const deps={react:{useId:()=> 'refresh-selector',useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),useRef:value=>refs[refIndex++]??(refs[refIndex-1]={current:value}),useState:value=>{const i=index++;if(!(i in states))states[i]=value;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];}},'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronDown:'chevron',Check:'check'},'@/lib/data':{professions:[]}};
 const document={addEventListener(){},removeEventListener(){},getElementById:()=>null};
 new Function('exports','require','document',ts.transpileModule(readFileSync('src/components/work/ProfessionSelect.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>{assert.ok(Object.hasOwn(deps,name));return deps[name];},document);
 return{input,dispatches:()=>dispatches,render(next={}){props={...props,...next};index=0;refIndex=0;effects=[];const tree=out.ProfessionSelect(props);for(const node of nodes(tree))if(node.props.ref)node.props.ref.current=node.props.role==='combobox'?input:{contains:()=>false};input.value=find(tree,'combobox').props.value;for(const effect of effects)effect();return tree;}};
}
const hidden=tree=>nodes(tree).find(node=>node.props.name==='professionId').props.value;
function key(tree,key){let prevented=0;find(tree,'combobox').props.onKeyDown({key,preventDefault(){prevented++;}});return prevented;}

test('refreshing or failing a visible profession list never exposes an expanded missing popup or dangling active descendant',()=>{
 const f=fixture();let tree=f.render();find(tree,'combobox').props.onFocus();tree=f.render();assert.ok(find(tree,'listbox'));assert.ok(find(tree,'combobox').props['aria-activedescendant']);
 for(const catalogState of ['loading','error']){tree=f.render({catalogState});assert.equal(find(tree,'listbox'),undefined);assert.equal(find(tree,'combobox').props['aria-expanded'],false);assert.equal(find(tree,'combobox').props['aria-activedescendant'],undefined);assert.notEqual(f.input.validity,'');}
});
test('Enter during catalog refresh cannot choose a cached profession or submit the form',()=>{
 const f=fixture();let tree=f.render();find(tree,'combobox').props.onFocus();tree=f.render();key(tree,'ArrowDown');tree=f.render({catalogState:'loading'});assert.equal(key(tree,'Enter'),1);tree=f.render();assert.equal(hidden(tree),'');assert.equal(f.dispatches(),0);assert.equal(find(tree,'combobox').props['data-reference-state'],'loading');
});
test('catalog failure cannot replace the saved UUID with the previously highlighted cached option',()=>{
 const f=fixture({defaultId:second.id,defaultValue:second.name});let tree=f.render();find(tree,'combobox').props.onFocus();tree=f.render();key(tree,'ArrowDown');tree=f.render({catalogState:'error'});assert.equal(key(tree,'Enter'),1);tree=f.render();assert.equal(hidden(tree),second.id);assert.equal(f.dispatches(),0);assert.match(f.input.validity,/ещё раз/);
});
test('retry shows the current validation issue and clears the previous error once the selected UUID is valid again',()=>{
 const f=fixture({defaultId:first.id,defaultValue:first.name,catalogState:'loading'});let tree=f.render();find(tree,'combobox').props.onInvalid();tree=f.render();assert.match(find(tree,'alert').props.children,/загрузки/);
 tree=f.render({catalogState:'error'});assert.match(find(tree,'alert').props.children,/ещё раз/);tree=f.render({catalogState:'ready'});assert.equal(find(tree,'alert'),undefined);assert.equal(find(tree,'combobox').props['aria-invalid'],undefined);assert.equal(hidden(tree),first.id);assert.equal(f.input.validity,'');
});

test('typing before the first catalogue arrives opens the matching results unless the user dismissed them',()=>{
 for(const dismiss of [false,true]){
  const f=fixture({catalog:[],catalogState:'loading'});let tree=f.render();
  const field=find(tree,'combobox');field.props.onFocus();
  f.input.value='Второй';field.props.onChange({target:f.input});tree=f.render();
  assert.equal(find(tree,'listbox'),undefined);assert.equal(hidden(tree),'');
  if(dismiss)key(tree,'Escape');
  tree=f.render({catalog:[first,second],catalogState:'ready'});
  assert.equal(find(tree,'combobox').props.value,'Второй');
  assert.equal(hidden(tree),'');
  if(dismiss){assert.equal(find(tree,'listbox'),undefined);continue;}
  const options=nodes(tree).filter(n=>n.props?.role==='option');
  assert.equal(options.length,1);options[0].props.onClick();
  assert.equal(hidden(f.render()),second.id);
 }
});
