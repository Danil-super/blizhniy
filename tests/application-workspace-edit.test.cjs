const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003',specialistId='10000000-0000-4000-8000-000000000004',stamp='2026-10-26T08:00:00.123456Z';
const base={id,revision:'4',view:'applicant',target:{id:targetId,kind:'workRequest',title:'Заказ'},specialistId,snapshot:{name:'Анна',profession:'Сантехник',price:'1500.00',skills:'Описание',about:'Полное описание специалиста',phone:null,email:'fixture@example.invalid',messengerUrl:null},message:'Первое сообщение',status:'pending_payment',paid:false,sentAt:null,createdAt:stamp,updatedAt:stamp};
const preview=value=>({target:{...value.target,revision:'8'},specialist:{id:specialistId,revision:'9',snapshot:value.snapshot},existing:value});
const jsx=(type,props)=>({type,props:props||{}}),walk=node=>Array.isArray(node)?node.flatMap(walk):!node||typeof node!=='object'?[]:[node,...walk(node.props?.children)],text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
class ClientError extends Error{constructor(code){super(code);this.code=code;}}
function host(filename,props,api){
 const instances=new Map(),modules=new Map(),effects=[],calls=[],saved=[],locks=[];let current,tree,dirty=false;
 const react={useState(initial){const i=current,index=i.cursor++;if(!Object.hasOwn(i.values,index))i.values[index]=typeof initial==='function'?initial():initial;return[i.values[index],value=>{const next=typeof value==='function'?value(i.values[index]):value;if(!Object.is(next,i.values[index])){i.values[index]=next;dirty=true;}}];},useRef(initial){const i=current,index=i.cursor++;return i.values[index]??={current:initial};},useEffect(work,deps){const i=current,index=i.cursor++,prior=i.values[index];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){i.values[index]={deps};effects.push(()=>{prior?.cleanup?.();i.values[index].cleanup=work();});}},useMemo(work,deps){const i=current,index=i.cursor++,prior=i.values[index];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j])))i.values[index]={deps,value:work()};return i.values[index].value;},useId(){return react.useRef('edit-message').current;}};
 react.useCallback=(work,deps)=>react.useMemo(()=>work,deps);
 const actualApi=new Proxy({},{get(_target,key){return async(...args)=>{calls.push({method:key,args});assert.equal(typeof api[key],'function',`Explicit API fake for ${key}`);return api[key](...args);};}});
 function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;new Function('require','exports',js)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:({children})=>children};if(name==='next/link')return{__esModule:true,default:({children,...rest})=>jsx('a',{...rest,children})};
  if(name==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>({state:'signed-in',userId:owner})};if(name==='@/lib/local-account')return{notifyAccountSessionChange(){}};
  if(name==='@/lib/client-applications')return{productionApplications:actualApi,ApplicationClientError:ClientError};
  if(name==='@/components/listings/ListingWorkflowProvider')return{useListingPostmoderation:()=>true};
  if(name==='./ApplicationCheckout')return{ApplicationCheckout:()=>null};
  if(name==='./ApplicationDetail')return{applicationButton:'button',applicationLabels:{pending_payment:'Ожидает оплаты',sent:'Отправлен',viewed:'Просмотрен'},applicationTargetHref:()=>'/target',ApplicationDetail:p=>jsx('detail',{...p,children:null})};
  if(name==='@/lib/application-contract')return{parseApplicationEdit(value){if(value.message.length>500||/[\u0000]|<[^>]+>/.test(value.message))throw Error('invalid');return{...value,message:value.message.trim()};}};
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),`${name}.tsx`));throw Error(`Unexpected dependency ${name}`);
 },out);return out;}
 const exports=load(path.join(root,filename)),component=exports.ApplicationMessageEditor||exports.ApplicationsPanel;
 function expand(node,key='root'){if(Array.isArray(node))return node.map((n,j)=>expand(n,`${key}:${j}`));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const i=instances.get(key)||{values:[],cursor:0};instances.set(key,i);i.cursor=0;const prev=current;current=i;const out=node.type(node.props);current=prev;return expand(out,`${key}:render`);}return{...node,props:{...node.props,children:expand(node.props.children,`${key}:children`)}};}
 function render(){dirty=false;tree=expand(jsx(component,{owner,value:base,visible:true,onSaved:value=>saved.push(value),onUnknownChange:value=>locks.push(value),onCancel(){},...props}));while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}return tree;}
 function button(label){const found=walk(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,`Button ${label}`);return found;}
 render();return{settle,render,calls,saved,locks,button,get tree(){return tree;},textarea:()=>walk(tree).find(n=>n.type==='textarea'),form:()=>walk(tree).find(n=>n.type==='form')};
}
test('message editor previews the original application and updates with exact current target/profile CAS',async()=>{
 const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>preview(base),update:async(_owner,input)=>({...base,revision:'5',message:input.message})});await h.settle();
 assert.equal(h.textarea().props.maxLength,500);h.textarea().props.onChange({target:{value:'Новое сообщение'}});await h.settle();h.form().props.onSubmit({preventDefault(){}});await h.settle();
 const update=h.calls.find(c=>c.method==='update');assert.deepEqual(update.args.slice(0,2),[owner,{applicationId:id,expectedRevision:'4',expectedTargetRevision:'8',specialistId,expectedSpecialistRevision:'9',message:'Новое сообщение'}]);assert.equal(h.saved[0].message,'Новое сообщение');
});
test('lost edit acknowledgement keeps text locked and recovers only the exact matching revision without repeating update',async()=>{
 const changed={...base,revision:'5',message:'Сохранить текст'};const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>preview(base),update:async()=>{throw new ClientError('UNKNOWN');},read:async()=>changed});await h.settle();
 h.textarea().props.onChange({target:{value:changed.message}});await h.settle();h.form().props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.textarea().props.value,changed.message);assert.equal(h.textarea().props.disabled,true);assert.equal(h.locks.at(-1),true);
 h.button('Проверить сохранение').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.method==='update').length,1);assert.deepEqual(h.saved,[changed]);assert.equal(h.locks.at(-1),false);
});
test('edit retry requires an authoritative unchanged read and repeats the original immutable input only',async()=>{
 let count=0;const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>preview(base),update:async(_owner,input)=>{if(++count===1)throw new ClientError('UNKNOWN');return{...base,revision:'5',message:input.message};},read:async()=>base});await h.settle();
 h.textarea().props.onChange({target:{value:'Точный повтор'}});await h.settle();h.form().props.onSubmit({preventDefault(){}});await h.settle();h.button('Проверить сохранение').props.onClick();await h.settle();
 assert.equal(h.calls.filter(c=>c.method==='update').length,1);h.form().props.onSubmit({preventDefault(){}});await h.settle();const writes=h.calls.filter(c=>c.method==='update');assert.equal(writes.length,2);assert.deepEqual(writes[0].args[1],writes[1].args[1]);
});
test('changed preview or edit conflict does not discard the entered message or automatically overwrite',async()=>{
 const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>preview(base),update:async()=>{throw new ClientError('APPLICATION_CHANGED');}});await h.settle();h.textarea().props.onChange({target:{value:'Мои несохранённые правки'}});await h.settle();h.form().props.onSubmit({preventDefault(){}});await h.settle();
 assert.equal(h.textarea().props.value,'Мои несохранённые правки');assert.equal(h.calls.filter(c=>c.method==='update').length,1);assert.deepEqual(h.saved,[]);
});
test('a preview with a different application or revision never enables an overwrite',async()=>{
 for(const existing of [{...base,id:owner},{...base,revision:'5'}]){
  const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>({...preview(base),existing})});await h.settle();
  assert.equal(h.button('Сохранить изменения').props.disabled,true);h.form().props.onSubmit({preventDefault(){}});await h.settle();assert.equal(h.calls.filter(c=>c.method==='update').length,0);assert.equal(h.textarea().props.value,base.message);
 }
});
test('unknown edit readback with remote changes shows both messages without pretending the local draft was saved',async()=>{
 const remote={...base,revision:'6',message:'Чужая новая версия'};const h=host('src/components/applications/ApplicationMessageEditor.tsx',{}, {preview:async()=>preview(base),update:async()=>{throw new ClientError('UNKNOWN');},read:async()=>remote});await h.settle();
 h.textarea().props.onChange({target:{value:'Мои правки'}});await h.settle();h.form().props.onSubmit({preventDefault(){}});await h.settle();h.button('Проверить сохранение').props.onClick();await h.settle();
 assert.equal(h.textarea().props.value,'Мои правки');assert.match(text(h.tree),/Чужая новая версия/);assert.deepEqual(h.saved,[]);assert.equal(h.locks.at(-1),false);assert.equal(h.button('Сохранить изменения').props.disabled,true);
});
test('a lost viewed acknowledgement stays unknown until explicit readback and does not retry on renders',async()=>{
 const incoming={...base,view:'recipient',status:'sent',paid:true,sentAt:stamp},summary={id,revision:'4',view:'recipient',status:'sent',paid:true,createdAt:stamp,targetId,kind:'workRequest',targetTitle:'Заказ',specialistName:'Анна'};
 const h=host('src/components/applications/ApplicationsPanel.tsx',{}, {list:async(_owner,mode)=>({items:mode==='recipient'?[summary]:[],nextCursor:null}),read:async()=>incoming,decide:async()=>{throw new ClientError('UNKNOWN');}});await h.settle();h.button('Входящие отклики').props.onClick();await h.settle();h.button('Подробнее').props.onClick({currentTarget:{focus(){}}});await h.settle();
 let detail=walk(h.tree).find(node=>node.type==='detail');assert.equal(detail.props.unknown,true);detail.props.onDecision('selected');await h.settle();h.render();await h.settle();assert.equal(h.calls.filter(c=>c.method==='decide').length,1);
 detail=walk(h.tree).find(node=>node.type==='detail');detail.props.onRefresh();await h.settle();assert.equal(walk(h.tree).find(node=>node.type==='detail').props.unknown,false);assert.equal(h.calls.filter(c=>c.method==='read').length,2);assert.equal(h.calls.filter(c=>c.method==='decide').length,1);
});
for(const view of ['applicant','recipient'])for(const status of ['sent','viewed','selected','rejected'])test(`opening ${view}/${status} mutates viewed only for an incoming sent application`,async()=>{
 const incoming={...base,view,status,paid:true,sentAt:stamp},summary={id,revision:'4',view,status,paid:true,createdAt:stamp,targetId,kind:'workRequest',targetTitle:'Заказ',specialistName:'Анна'};
 const h=host('src/components/applications/ApplicationsPanel.tsx',{}, {list:async(_owner,mode)=>({items:mode===view?[summary]:[],nextCursor:null}),read:async()=>incoming,decide:async()=>({...incoming,status:'viewed',revision:'5'})});await h.settle();if(view==='recipient'){h.button('Входящие отклики').props.onClick();await h.settle();}
 h.button('Подробнее').props.onClick({currentTarget:{focus(){}}});await h.settle();h.render();await h.settle();const writes=h.calls.filter(c=>c.method==='decide');assert.equal(writes.length,view==='recipient'&&status==='sent'?1:0);
 if(writes.length)assert.deepEqual(writes[0].args.slice(0,4),[owner,id,'4','viewed']);
});
