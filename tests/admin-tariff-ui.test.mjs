import assert from 'node:assert/strict';import{test}from'node:test';import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),{loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs'),contract=load('admin-tariff-contract');
const actor='11111111-1111-4111-8111-111111111111',row={id:'listing-publication',action:'listing_publication',name:'Размещение',price:'199.00',durationDays:30,active:true,revision:'a'.repeat(64)};
const jsx=(type,props,key)=>({type,props,key}),nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)],text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function harness(){
 const state=[],effects=[],scheduled=[],requests=[];let index=0,effectIndex=0,changed=0,authChanges=0,ids=0,auth={state:'admin',userId:actor};
 const exports={},source=readFileSync(new URL('../src/components/admin/PrimaryAdminTariffsClient.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports','crypto',compiled+'\nexports.TariffEditor=TariffEditor; exports.TariffList=TariffList;')(name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='react')return{useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return[state[slot],value=>state[slot]=typeof value==='function'?value(state[slot]):value];},useRef(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]={current:initial};return state[slot];},useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))scheduled.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:work()};});}};
  if(name==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>auth};
  if(name==='@/lib/admin-tariff-contract')return contract;
  if(name==='@/lib/local-account')return{notifyAccountSessionChange:()=>authChanges++};
  if(name==='@/lib/client-admin-tariffs')return{adminTariffs:{execute(command,options){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({command,options,resolve,reject});return promise;}}};
  throw Error('Unexpected tariff UI dependency: '+name);
 },exports,{randomUUID:()=>`33333333-3333-4333-8333-${String(++ids).padStart(12,'0')}`});
 return{requests,changed:()=>changed,authChanges:()=>authChanges,render(overrides={}){index=0;effectIndex=0;const tree=exports.TariffEditor({actor,initial:row,...overrides,onClose(){},onRefresh(){},onChanged(){changed++;}});scheduled.splice(0).forEach(work=>work());return tree;},list(props){index=0;effectIndex=0;const tree=exports.TariffList(props);scheduled.splice(0).forEach(work=>work());return tree;},wrapper(value){index=0;effectIndex=0;auth=value;return exports.PrimaryAdminTariffsClient();},stop(){effects.forEach(effect=>effect.cleanup?.());}};
}
const find=(tree,name)=>nodes(tree).find(node=>node.props?.name===name),submit=tree=>nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
test('the read-only list shows a saved tariff without edit controls',async()=>{
 const h=harness(),props={actor,visible:true,editable:false};
 h.list(props);
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].command.action,'list');
 h.requests[0].resolve({tariffs:[row],receipt:null,history:[]});
 await flush();
 const tree=h.list(props);
 assert.ok(text(tree).includes('199.00'));
 assert.ok(text(tree).includes('Активен'));
 assert.equal(nodes(tree).some(node=>node.type==='button'),false);
 h.stop();
});
test('hosted tariff editing shows only supported actions and keeps the tariff name fixed',async()=>{
 const h=harness(),props={actor,visible:true,editable:true,hosted:true};
 const fair={...row,id:'fair-participation',action:'fair_participation',name:'Ярмарка',durationDays:null};
 h.list(props);
 h.requests[0].resolve({tariffs:[row,fair],receipt:null,history:[]});
 await flush();
 const buttons=nodes(h.list(props)).filter(node=>node.props?.id?.startsWith('tariff-'));
 assert.deepEqual(buttons.map(node=>node.props.id),['tariff-listing-publication']);
 const editor=harness();
 assert.equal(find(editor.render({hosted:true}),'name').props.readOnly,true);
 h.stop();editor.stop();
});
function decision(h){let tree=h.render();find(tree,'price').props.onChange({target:{value:'249,51'}});find(tree,'reason').props.onChange({target:{value:'  Изменение стоимости  '}});tree=h.render();find(tree,'confirmed').props.onChange({target:{checked:true}});return h.render();}
function applied(request){const input=request.command.input,next={...row,name:input.name,price:input.price,durationDays:input.durationDays,active:input.active,revision:'b'.repeat(64)},receipt={id:input.id,actorId:actor,tariffId:row.id,expectedRevision:row.revision,previous:row,next,reason:input.reason,changed:true,createdAt:'2026-11-17T12:00:00.123456Z'};return{tariffs:[next],receipt,history:[receipt]};}
test('tariff editor validates values/reason/confirmation and fences duplicate submits',async()=>{
 const h=harness();let tree=h.render();submit(tree);assert.equal(h.requests.length,0);tree=decision(h);submit(tree);submit(tree);assert.equal(h.requests.length,1);
 const request=h.requests[0];assert.equal(request.command.input.price,'249.51');assert.equal(request.command.input.reason,'Изменение стоимости');assert.equal(request.command.input.expectedRevision,row.revision);
 request.resolve(applied(request));await flush();tree=h.render();assert.equal(h.changed(),1);assert.ok(text(tree).includes('Сохранение подтверждено'));assert.ok(text(tree).includes('249.51'));h.stop();
});
test('changed tariff requires explicit confirmation and a valid reason before dispatch',()=>{
 for(const missing of['confirmed','reason']){const h=harness();let tree=decision(h);find(tree,missing).props.onChange({target:missing==='confirmed'?{checked:false}:{value:''}});tree=h.render();submit(tree);assert.equal(h.requests.length,0);h.stop();}
});
test('invalid zero duration is rejected before dispatch, never coerced to a one-day term',()=>{
 const h=harness();let tree=decision(h);find(tree,'days').props.onChange({target:{value:'0'}});tree=h.render();submit(tree);assert.equal(h.requests.length,0);assert.ok(text(h.render()).includes('Проверьте название'));h.stop();
});
test('a definite hosted tariff refusal lets an administrator correct terms and confirm again',async()=>{
 const h=harness();submit(decision(h));
 h.requests[0].reject(new contract.AdminTariffError('TARIFF_TERMS_INVALID'));
 await flush();
 const tree=h.render({hosted:true});
 assert.equal(find(tree,'confirmed').props.checked,false);
 assert.equal(nodes(tree).find(node=>node.type==='fieldset').props.disabled,false);
 assert.ok(text(tree).includes('Проверьте цену активного тарифа'));
 assert.ok(!text(tree).includes('Проверить сохранение'));
 h.stop();
});
test('unknown tariff outcome is recovered or explicitly replayed with exactly the original ID and payload',async()=>{
 const h=harness();submit(decision(h));const request=h.requests[0];assert.equal(nodes(h.render()).find(node=>node.type==='button'&&text(node)==='Закрыть').props.disabled,true);request.reject(new contract.AdminTariffError('TARIFF_UNAVAILABLE'));await flush();let tree=h.render();assert.equal(h.requests.length,1);
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Проверить сохранение').props.onClick();assert.equal(h.requests[1].command.action,'recover');assert.equal(h.requests[1].command.id,request.command.input.id);
 h.requests[1].resolve({tariffs:[row],receipt:null,history:[]});await flush();tree=h.render();assert.equal(h.requests.length,2);
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Повторить исходное сохранение').props.onClick();assert.deepEqual(h.requests[2].command,request.command);h.requests[2].resolve(applied(request));await flush();assert.equal(h.changed(),1);h.stop();
});
test('stale and unauthorized tariff decisions cannot be resubmitted; authorization clears private controls',async()=>{
 for(const code of['STALE_TARIFF','ADMIN_REQUIRED']){const h=harness();submit(decision(h));h.requests[0].reject(new contract.AdminTariffError(code));await flush();const tree=h.render();if(code==='STALE_TARIFF'){submit(tree);assert.ok(text(tree).includes('Загрузить актуальный тариф'));}else{assert.equal(nodes(tree).some(node=>node.type==='form'),false);assert.equal(h.authChanges(),1);}assert.equal(h.requests.length,1);h.stop();}
});
test('closed or changed-account tariff workspace ignores late saves and removes unauthorized DOM',async()=>{
 const h=harness();submit(decision(h));h.stop();assert.equal(h.requests[0].options.signal.aborted,true);h.requests[0].resolve(applied(h.requests[0]));await flush();assert.equal(h.changed(),0);
 const scope=harness(),workspace=tree=>nodes(tree).find(node=>typeof node.type==='function'&&node.type.name==='TariffList');
 const first=workspace(scope.wrapper({state:'admin',userId:actor})),checking=workspace(scope.wrapper({state:'loading',userId:null}));assert.equal(checking.key,first.key);assert.equal(checking.props.visible,false);assert.equal(workspace(scope.wrapper({state:'admin',userId:actor})).key,first.key);
 scope.wrapper({state:'admin',userId:'22222222-2222-4222-8222-222222222222'});const second=workspace(scope.wrapper({state:'admin',userId:'22222222-2222-4222-8222-222222222222'}));assert.notEqual(first.key,second.key);scope.wrapper({state:'signed-out',userId:null});assert.equal(workspace(scope.wrapper({state:'signed-out',userId:null})),undefined);
});

test('same-actor session recheck hides editor without losing original recovery intent or accepting late responses',async()=>{
 const h=harness();submit(decision(h));const request=h.requests[0];assert.equal(h.render({visible:false}),null);assert.equal(request.options.signal.aborted,true);request.resolve(applied(request));await flush();assert.equal(h.changed(),0);
 const tree=h.render({visible:true});nodes(tree).find(node=>node.type==='button'&&text(node)==='Проверить сохранение').props.onClick();assert.equal(h.requests[1].command.id,request.command.input.id);assert.equal(h.requests[1].command.action,'recover');h.stop();
});

test('session recheck of an idle editor returns to editable ready state',()=>{const h=harness();h.render();h.render({visible:false});let tree=h.render({visible:true});assert.equal(nodes(tree).find(node=>node.type==='fieldset').props.disabled,false);h.stop();});
