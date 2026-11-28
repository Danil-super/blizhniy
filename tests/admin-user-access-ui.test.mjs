import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),{loadLocalPrimaryModule:load}=require('../scripts/local-primary-modules.cjs');
const contract=load('admin-user-access-contract'),jsx=(type,props,key)=>({type,props,key});
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
const nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];
const text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const initial={user:{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'},receipt:null,history:[]};
function harness(){
  const state=[],effects=[],scheduled=[],requests=[],proofs=[];let index=0,effectIndex=0,changed=0,authChanges=0,ids=0;
  const exports={},source=readFileSync(new URL('../src/components/admin/AdminUserAccessPanel.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports','crypto',compiled+'\nexports.AccessDetails=AccessDetails;')(name=>{
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='react')return {useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return[state[slot],value=>state[slot]=typeof value==='function'?value(state[slot]):value];},
      useRef(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]={current:initial};return state[slot];},
      useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))scheduled.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:work()};});}};
    if(name==='@/lib/admin-user-access-contract')return contract;
    if(name==='@/lib/client-admin-passkey')return {AdminPasskeyClientError:Error,adminPasskeys:{approveAccess(command,signal){
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});proofs.push({command,signal,resolve,reject});return promise;
    }}};
    if(name==='@/lib/local-account')return {notifyAccountSessionChange:()=>authChanges++};
    if(name==='@/lib/client-admin-user-access')return {adminUserAccess:{execute(command,options){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({command,options,resolve,reject});return promise;}}};
    throw Error('Unexpected access UI dependency: '+name);
  },exports,{randomUUID:()=>`33333333-3333-4333-8333-${String(++ids).padStart(12,'0')}`});
  return {requests,proofs,state,changed:()=>changed,authChanges:()=>authChanges,render(overrides={}){index=0;effectIndex=0;const tree=exports.AccessDetails({actor,targetId:target,targetLabel:'Синтетический пользователь',onClose(){},onChanged(){changed++;},...overrides});scheduled.splice(0).forEach(work=>work());return tree;},stop(){effects.forEach(effect=>effect.cleanup?.());}};
}
const find=(tree,name)=>nodes(tree).find(node=>node.props?.name===name);
async function ready(){const h=harness();h.render();h.requests[0].resolve(initial);await flush();return h;}
function decision(h){let tree=h.render();find(tree,'blocked').props.onChange({target:{checked:true}});find(tree,'reason').props.onChange({target:{value:'Нарушение правил'}});tree=h.render();return tree;}
const submit=tree=>nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
function applied(request){const input=request.command.input;const receipt={...input,actorId:actor,previousRole:'user',previousBlocked:false,resultingVersion:'1',changed:true,createdAt:'2026-11-17T12:00:00.123456Z'};return{user:{...initial.user,isBlocked:true,authVersion:'1'},receipt,history:[receipt]};}
test('unchanged access is never submitted from the form',async()=>{
  const h=await ready();let tree=h.render();find(tree,'reason').props.onChange({target:{value:'Основание решения'}});find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);assert.equal(h.requests.length,1);h.stop();
});
test('access form requires a reason and explicit confirmation, sends one intent and updates the journal',async()=>{
  const h=await ready();let tree=decision(h);submit(tree);assert.equal(h.requests.length,1);
  find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);submit(tree);assert.equal(h.requests.length,2);
  const request=h.requests[1];assert.equal(request.command.input.expectedVersion,'0');assert.equal(request.command.input.isBlocked,true);assert.equal(request.command.input.reason,'Нарушение правил');
  request.resolve(applied(request));await flush();tree=h.render();assert.equal(h.changed(),1);assert.ok(text(tree).includes('Доступ обновлён'));assert.ok(text(tree).includes('Нарушение правил'));h.stop();
});
test('unknown outcome never automatically resends; read-only recovery keeps the original operation ID',async()=>{
  const h=await ready();let tree=decision(h);find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);
  const request=h.requests[1];request.reject(new contract.AdminUserAccessError('ACCESS_UNAVAILABLE'));await flush();tree=h.render();assert.equal(h.requests.length,2);
  nodes(tree).find(node=>node.type==='button'&&text(node)==='Проверить результат').props.onClick();assert.equal(h.requests[2].command.action,'recover');assert.equal(h.requests[2].command.id,request.command.input.id);
  h.requests[2].resolve({...initial,receipt:null});await flush();tree=h.render();assert.equal(h.requests.length,3);
  nodes(tree).find(node=>node.type==='button'&&text(node)==='Повторить исходное решение').props.onClick();assert.deepEqual(h.requests[3].command,request.command);
  h.requests[3].resolve(applied(request));await flush();assert.equal(h.changed(),1);h.stop();
});
test('the operator passkey requirement confirms the frozen intent before resubmission',async()=>{
  const h=await ready();let tree=decision(h);find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);
  const original=h.requests[1];original.reject(new contract.AdminUserAccessError('PASSKEY_REQUIRED'));await flush();
  assert.equal(h.requests.length,2);assert.deepEqual(h.proofs[0].command,original.command);
  h.proofs[0].resolve();await flush();
  assert.equal(h.requests.length,3);assert.deepEqual(h.requests[2].command,original.command);
  h.requests[2].resolve(applied(original));await flush();assert.equal(h.changed(),1);h.stop();
});
test('cancelling the first passkey confirmation keeps the draft and does not resend',async()=>{
  const h=await ready();let tree=decision(h);find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);
  h.requests[1].reject(new contract.AdminUserAccessError('PASSKEY_REQUIRED'));await flush();h.proofs[0].reject(Error('Ключ не подтверждён.'));await flush();
  tree=h.render();assert.equal(h.requests.length,2);assert.equal(find(tree,'reason').props.value,'Нарушение правил');
  assert.equal(find(tree,'confirmed').props.checked,true);h.stop();
});
test('the enrollment form never serializes its operator code in native HTML submission',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),exports={};
  const source=readFileSync(new URL('../src/components/admin/AdminPasskeyEnrollmentForm.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',compiled)(name=>name==='@/lib/client-admin-passkey'?{}:require(name),exports);
  const html=renderToStaticMarkup(React.createElement(exports.AdminPasskeyEnrollmentForm));
  const field=html.match(/<input\b[^>]*>/)?.[0];
  assert.match(html,/<form\b[^>]*method="post"/);
  assert.match(field,/type="password"/);
  assert.doesNotMatch(field,/\bname=/);
});
test('stale decisions reload current authority and require a new confirmation; self access cannot be submitted',async()=>{
  const h=await ready();let tree=decision(h);find(tree,'confirmed').props.onChange({target:{checked:true}});tree=h.render();submit(tree);
  h.requests[1].reject(new contract.AdminUserAccessError('STALE_ACCESS'));await flush();h.render();assert.equal(h.requests[2].command.action,'inspect');
  h.requests[2].resolve({...initial,user:{...initial.user,authVersion:'1'}});await flush();tree=h.render();assert.equal(find(tree,'confirmed').props.checked,false);submit(tree);assert.equal(h.requests.length,3);h.stop();
  const self=harness();self.render({targetId:actor});self.requests[0].resolve({...initial,user:{...initial.user,id:actor,role:'admin'}});await flush();tree=self.render({targetId:actor});assert.ok(text(tree).includes('собственный доступ'));submit(tree);assert.equal(self.requests.length,1);self.stop();
});
test('closing or losing admin authority cannot restore a late private result',async()=>{
  const h=harness();h.render();h.stop();assert.equal(h.requests[0].options.signal.aborted,true);h.requests[0].resolve(initial);await flush();assert.equal(h.state[0],null);
  const denied=await ready();let tree=decision(denied);find(tree,'confirmed').props.onChange({target:{checked:true}});tree=denied.render();submit(tree);
  denied.requests[1].reject(new contract.AdminUserAccessError('ADMIN_REQUIRED'));await flush();assert.equal(denied.state[0],null);assert.equal(denied.authChanges(),1);denied.stop();
});
