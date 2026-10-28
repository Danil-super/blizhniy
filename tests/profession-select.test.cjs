const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function harness(defaultValue=''){
 const state=[],refs=[];let index=0,refIndex=0;
 const jsx=(type,props)=>({type,props}),out={};
 const deps={react:{useId:()=> 'profession-test',useMemo:fn=>fn(),useEffect:()=>{},useRef:value=>{const i=refIndex++;return refs[i]??=( {current:value});},
  useState:value=>{const i=index++;if(!(i in state))state[i]=typeof value==='function'?value():value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronDown:'chevron',Check:'check'},
  '@/lib/data':{professions:[{name:'Юрист',slug:'yurist',active:true},{name:'Сантехник',slug:'santehnik',active:true},{name:'Архивная',slug:'old',active:false}]}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/work/ProfessionSelect.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>{if(!Object.hasOwn(deps,name))throw Error(name);return deps[name];});
 return()=>{index=0;refIndex=0;return out.ProfessionSelect({defaultValue,required:true});};
}
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
test('profession is an accessible named editable combobox with a bounded dropdown, not a native OS-sized select',()=>{
 const render=harness('Сантехник'),tree=render(),input=nodes(tree).find(node=>node.props?.role==='combobox');
 assert.ok(input);assert.equal(input.type,'input');assert.equal(input.props.name,'profession');assert.equal(input.props.value,'Сантехник');assert.equal(input.props.required,true);
 input.props.onFocus();const open=render(),list=nodes(open).find(node=>node.props?.role==='listbox');assert.ok(list);assert.match(list.props.className,/max-h-/);assert.match(list.props.className,/overflow-y-auto/);
 assert.equal(nodes(list).filter(node=>node.props?.role==='option').length,2);
});
test('typing filters active professions and choosing an option submits its canonical name',()=>{
 const render=harness();let input=nodes(render()).find(node=>node.props?.role==='combobox');
 input.props.onChange({target:{value:'сант'}});let tree=render();const options=nodes(tree).filter(node=>node.props?.role==='option');assert.equal(options.length,1);
 options[0].props.onClick();input=nodes(render()).find(node=>node.props?.role==='combobox');assert.equal(input.props.value,'Сантехник');assert.equal(input.props['aria-expanded'],false);
});
