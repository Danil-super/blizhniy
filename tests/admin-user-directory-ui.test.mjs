import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts=createRequire(import.meta.url)('typescript'),jsx=(type,props,key)=>({type,props,key});
const nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];
const text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function harness(){
  const state=[],effects=[],pending=[],requests=[];let index=0,effectIndex=0,auth={state:'admin',userId:'admin-a'},changes=0;
  const exports={};class ClientError extends Error {constructor(code){super('Запрос отклонён');this.code=code;}}
  const source=readFileSync(new URL('../src/components/admin/PrimaryAdminUsersClient.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compiled+'\nexports.DirectoryPage=DirectoryPage;exports.UserDirectory=UserDirectory;',{exports,Intl,Date,JSON,AbortController,require:name=>{
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='react')return {useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return[state[slot],value=>state[slot]=typeof value==='function'?value(state[slot]):value];},
      useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))pending.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:work()};});}};
    if(name==='@/components/auth/AccountAuthProvider')return {usePrimaryAccountAuth:()=>auth};
    if(name==='@/lib/local-account')return {notifyAccountSessionChange:()=>changes++};
    if(name==='./AdminUserAccessPanel')return {AdminUserAccessPanel:'access-panel'};
    if(name==='@/lib/client-admin-user-directory')return {AdminUserDirectoryClientError:ClientError,adminUserDirectory:{list(input,options){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({input,options,resolve,reject});return promise;}}};
    throw Error('Unexpected directory UI import: '+name);
  }});
  const initial={expectedAdminId:'admin-a',query:'',role:'all',status:'all',cursor:null};
  return {requests,state,ClientError,changes:()=>changes,setAuth:next=>auth=next,entry:()=>exports.PrimaryAdminUsersClient(),
    form(accessManagement=false){index=0;return exports.UserDirectory({actor:'admin-a',accessManagement});},
    render(input=initial){index=0;effectIndex=0;const tree=exports.DirectoryPage({input,onNext:()=>{},onFirst:()=>{},onRefresh:()=>{}});pending.splice(0).forEach(work=>work());return tree;},stop(){effects.forEach(effect=>effect.cleanup?.());}};
}
test('primary directory hides private data on authority recheck and remounts for a different admin',()=>{
  const h=harness();assert.equal(h.entry().key,'admin-a');h.setAuth({state:'admin',userId:'admin-b'});assert.equal(h.entry().key,'admin-b');
  for(const state of ['loading','unavailable','signed-out','signed-in']){h.setAuth({state,userId:'admin-a'});assert.equal(h.entry().type,'p');assert.equal(h.entry().props.role,'status');}
});
test('directory exposes access actions only when enabled and refreshes after a decision',()=>{
  const h=harness();let tree=h.form();assert.equal(nodes(tree).some(node=>node.props?.onManage),false);
  tree=h.form(true);let reader=nodes(tree).find(node=>node.props?.onManage);reader.props.onManage({id:'target',name:'Пользователь',email:'user@example.invalid'});
  tree=h.form(true);const panel=nodes(tree).find(node=>node.type==='access-panel');assert.equal(panel.props.targetId,'target');assert.equal(panel.props.actor,'admin-a');
  reader=nodes(tree).find(node=>node.props?.onManage);const old=reader.key;panel.props.onChanged();tree=h.form(true);assert.notEqual(nodes(tree).find(node=>node.props?.onManage).key,old);
  panel.props.onClose();assert.equal(nodes(h.form(true)).some(node=>node.type==='access-panel'),false);
});
test('directory offers retry for failures, aborts reads and ignores late private responses',async()=>{
  const h=harness();h.render();h.requests[0].reject(new h.ClientError('ADMIN_REQUIRED'));await flush();const tree=h.render();
  assert.equal(h.changes(),1);assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));
  assert.equal(text(tree).includes('Пользователи не найдены'),false);assert.ok(nodes(tree).some(node=>node.type==='button'&&text(node)==='Повторить загрузку'));
  const next={expectedAdminId:'admin-a',query:'новое имя',role:'all',status:'all',cursor:null};h.render(next);h.stop();assert.equal(h.requests[1].options.signal.aborted,true);
  h.requests[1].resolve({items:[{id:'secret',name:'ЛИЧНОЕ ИМЯ'}],nextCursor:null});await flush();assert.equal(h.state[0],null);
});
test('directory presents distinct coloured states, current role and contact fields without fake activity or payment metrics',async()=>{
  const h=harness();h.render();const base={email:'user@example.invalid',phone:'+79990000000',role:'user',isBlocked:false,emailVerified:true,createdAt:'2026-11-17T10:20:30.123456Z'};
  h.requests[0].resolve({items:[{...base,id:'one',name:'Первый'},{...base,id:'two',name:'Второй',isBlocked:true},{...base,id:'three',name:'Третий',emailVerified:false,role:'admin'}],nextCursor:null});
  await flush();const tree=h.render(),content=text(tree);for(const label of ['Первый','user@example.invalid','Активен','Заблокирован','Ожидает email','Администратор'])assert.ok(content.includes(label));
  for(const color of ['emerald','red','amber'])assert.ok(nodes(tree).some(node=>node.props?.className?.includes(color)));
  assert.equal(content.includes('Последняя активность'),false);assert.equal(content.includes('Оплатил'),false);h.stop();
});
test('directory filters reset pagination; paging and refresh use new keys without keeping stale results',()=>{
  const h=harness();let tree=h.form(),reader=nodes(tree).find(node=>typeof node.type==='function');const firstKey=reader.key;
  reader.props.onNext({id:'last',updatedAt:'2026-11-17T10:20:30.123456Z'});tree=h.form();reader=nodes(tree).find(node=>typeof node.type==='function');assert.notEqual(reader.key,firstKey);assert.ok(reader.props.input.cursor);
  nodes(tree).find(node=>node.type==='input').props.onChange({target:{value:'  Найти имя  '}});
  tree=h.form();nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});tree=h.form();reader=nodes(tree).find(node=>typeof node.type==='function');
  assert.equal(reader.props.input.query,'Найти имя');assert.equal(reader.props.input.cursor,null);
  const key=reader.key;reader.props.onRefresh();tree=h.form();assert.notEqual(nodes(tree).find(node=>typeof node.type==='function').key,key);
});
test('primary provider never falls back to legacy user management while loading or signed out',()=>{
  let auth=null;const exports={};
  const compiled=ts.transpileModule(readFileSync(new URL('../src/components/admin/AdminUsersClient.tsx',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compiled,{exports,require:name=>{
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='@/components/auth/AccountAuthProvider')return {usePrimaryAccountAuth:()=>auth};
    if(name==='./PrimaryAdminUsersClient')return {PrimaryAdminUsersClient:'primary-directory'};
    if(['react','lucide-react','@/lib/supabase-browser'].includes(name))return {};
    throw Error('Unexpected users entry import: '+name);
  }});
  assert.equal(exports.AdminUsersClient().type.name,'LegacyAdminUsersClient');
  for(const state of ['loading','unavailable','signed-out','signed-in','admin']){auth={state,userId:null};assert.equal(exports.AdminUsersClient().type,'primary-directory');}
});
