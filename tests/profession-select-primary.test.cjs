const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const first={id:'11111111-1111-4111-8111-111111111111',slug:'synthetic-one',name:'Синтетический мастер',parent:'Первая категория',active:true};
const second={...first,id:'22222222-2222-4222-8222-222222222222',slug:'synthetic-two',parent:'Вторая категория'};
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const find=(tree,role)=>nodes(tree).find(node=>node.props?.role===role);
const hidden=tree=>nodes(tree).find(node=>node.props?.name==='professionId');
const content=node=>!node||typeof node!=='object'?String(node??''):[node.props?.children].flat(Infinity).map(content).join('');
function harness(initial){
 const state=[],refs=[];let index=0,refIndex=0,effects=[],props={required:true,catalogState:'ready',catalog:[first,second],...initial};
 const jsx=(type,props)=>({type,props}),out={},input={value:'',dataset:{},validity:'',setCustomValidity(value){this.validity=value;},matches:()=>false,dispatchEvent:()=>true,focus(){}};
 const deps={react:{useId:()=> 'profession-primary-test',useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),
  useRef:value=>{const i=refIndex++;return refs[i]??=({current:value});},
  useState:value=>{const i=index++;if(!(i in state))state[i]=typeof value==='function'?value():value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronDown:'chevron',Check:'check'},
  '@/lib/data':{professions:[{name:'LEGACY STATIC FALLBACK',slug:'legacy-static',active:true}]}};
 const document={addEventListener(){},removeEventListener(){},getElementById:()=>null};
 const source=fs.readFileSync('src/components/work/ProfessionSelect.tsx','utf8');
 new Function('exports','require','document',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>{if(!Object.hasOwn(deps,name))throw Error(name);return deps[name];},document);
 return{input,render(next={}){props={...props,...next};index=0;refIndex=0;effects=[];const tree=out.ProfessionSelect(props);
  for(const node of nodes(tree))if(node.props?.ref){node.props.ref.current=node.props.role==='combobox'?input:{contains:()=>false};}
  input.value=find(tree,'combobox').props.value;for(const effect of effects)effect();return tree;
 }};
}

test('primary selector requires an explicit UUID choice for duplicate labels and shows distinguishing category and slug',()=>{
 const h=harness({defaultValue:first.name});let tree=h.render();
 assert.equal(hidden(tree).props.value,'');assert.equal(find(tree,'combobox').props['data-reference-state'],'unknown');assert.notEqual(h.input.validity,'');
 find(tree,'combobox').props.onFocus();tree=h.render();const options=nodes(tree).filter(node=>node.props?.role==='option');
 assert.equal(options.length,2);assert.match(content(options[0]),/Первая категория.*synthetic-one/);assert.match(content(options[1]),/Вторая категория.*synthetic-two/);
 options[1].props.onClick();tree=h.render();assert.equal(hidden(tree).props.value,second.id);assert.equal(find(tree,'combobox').props.value,second.name);
 assert.equal(find(tree,'combobox').props['data-reference-state'],'selected');assert.equal(h.input.validity,'');
});

test('typing clears a selected UUID even when the entered text equals a known label',()=>{
 const h=harness({defaultId:first.id,defaultValue:first.name});let tree=h.render();assert.equal(hidden(tree).props.value,first.id);
 h.input.value=first.name;find(tree,'combobox').props.onChange({target:h.input});tree=h.render();
 assert.equal(hidden(tree).props.value,'');assert.equal(find(tree,'combobox').props['data-reference-state'],'unknown');assert.notEqual(h.input.validity,'');
 h.input.value='';find(tree,'combobox').props.onChange({target:h.input});tree=h.render();assert.equal(hidden(tree).props.value,'');assert.equal(find(tree,'combobox').props['data-reference-state'],'empty');
});

test('restored stable UUID uses its current label and retains the reference when the catalog disables it',()=>{
 const renamed={...first,name:'Новое синтетическое название'};
 const h=harness({defaultId:first.id,defaultValue:'Старое синтетическое название',catalog:[renamed]});let tree=h.render();
 assert.equal(hidden(tree).props.value,first.id);assert.equal(find(tree,'combobox').props.value,renamed.name);assert.equal(h.input.validity,'');
 tree=h.render({catalog:[{...renamed,active:false}]});
 assert.equal(hidden(tree).props.value,first.id);assert.equal(find(tree,'combobox').props.value,renamed.name);assert.equal(find(tree,'combobox').props['data-reference-state'],'inactive');
 assert.equal(find(tree,'combobox').props['aria-invalid'],true);assert.match(h.input.validity,/отключена/);assert.match(content(tree),/Черновик сохранён/);
 tree=h.render({catalog:[renamed]});assert.equal(hidden(tree).props.value,first.id);assert.equal(find(tree,'combobox').props['data-reference-state'],'selected');assert.equal(h.input.validity,'');
});

test('primary loading and catalog failure block selection without substituting static professions',()=>{
 const h=harness({catalog:[],catalogState:'loading'});let tree=h.render();
 assert.equal(find(tree,'combobox').props['aria-busy'],true);assert.match(h.input.validity,/загрузки/);
 find(tree,'combobox').props.onFocus();tree=h.render();assert.equal(find(tree,'listbox'),undefined);
 tree=h.render({catalogState:'error'});assert.equal(hidden(tree).props.value,'');assert.equal(find(tree,'combobox').props['data-reference-state'],'error');
 assert.match(h.input.validity,/ещё раз/);assert.equal(nodes(tree).find(node=>node.type==='button').props.disabled,true);
 find(tree,'combobox').props.onInvalid();tree=h.render();assert.match(content(find(tree,'alert')),/ещё раз/);assert.equal(content(tree).includes('LEGACY STATIC FALLBACK'),false);
 tree=h.render({catalogState:'ready'});find(tree,'combobox').props.onFocus();tree=h.render();assert.equal(nodes(tree).filter(node=>node.props?.role==='option').length,0);
});

test('a newly chosen profession disabled before saving cannot claim draft retention of an unsaved FK',()=>{
 const h=harness({defaultId:first.id,defaultValue:first.name});let tree=h.render();
 find(tree,'combobox').props.onFocus();tree=h.render();nodes(tree).filter(node=>node.props?.role==='option')[1].props.onClick();
 tree=h.render({catalog:[first]});
 assert.equal(hidden(tree).props.value,second.id);assert.equal(find(tree,'combobox').props['data-reference-state'],'unavailable');
 assert.match(h.input.validity,/больше недоступна/);assert.equal(content(tree).includes('Черновик сохранён'),false);
});
