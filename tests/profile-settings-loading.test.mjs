import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props,key)=>({type,props,key});
const nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];
const text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function loaderHarness(load){
 const state=[],effects=[],scheduled=[],updates=[],requests=[];let index=0,effectIndex=0,clears=0;
 const react={useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;updates.push(slot);}];},
  useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))scheduled.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:work()};});}};
 const module={exports:{}};
 vm.runInNewContext(compile(readFileSync(new URL('../src/components/cabinet/SettingsPanelLoader.tsx',import.meta.url),'utf8')),{module,exports:module.exports,Promise,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(name==='./CookieCabinetProfileProvider')return {useCookieCabinetProfile:()=>({clearSettingsDraft(){clears++;}})};
  if(name==='./CabinetClient'){const request=deferred();requests.push(request);return load?load():request.promise;}
  throw new Error('Unexpected loader import: '+name);
 }});
 return {requests,state,updates,clears:()=>clears,render(props){index=0;effectIndex=0;const tree=module.exports.SettingsPanelLoader(props);scheduled.splice(0).forEach(work=>work());return tree;},stop(){effects.forEach(effect=>effect.cleanup?.());}};
}
const props=owner=>({identity:{ownerKey:owner,email:owner+'@local.invalid'},profile:{name:owner,phone:'+79990000000'},onClose(){}});

test('settings loading keeps close usable and cannot render after close',async()=>{
 const h=loaderHarness(),input=props('a');let closed=0;input.onClose=()=>closed++;
 const tree=h.render(input);assert.ok(nodes(tree).some(node=>node.props?.role==='status'));
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Закрыть').props.onClick();assert.equal(closed,1);
 assert.equal(h.clears(),1,'closing the loader also cancels retained avatar preparation');
 await flush();assert.equal(h.requests.length,1);h.stop();h.requests[0].resolve({SettingsPanel:()=>null});await flush();
 assert.equal(h.state[0],null);assert.deepEqual(h.updates,[]);
});

test('failed settings import exposes a safe retry and uses current props when it succeeds',async()=>{
 const h=loaderHarness(),first=props('a');h.render(first);await flush();h.requests[0].reject(new Error('private upstream diagnostic'));await flush();
 const error=h.render(first);assert.ok(nodes(error).some(node=>node.props?.role==='alert'));assert.equal(text(error).includes('private upstream'),false);
 assert.ok(nodes(error).some(node=>node.type==='button'&&text(node)==='Закрыть'));
 nodes(error).find(node=>node.type==='button'&&text(node)==='Повторить загрузку').props.onClick();h.render(first);await flush();assert.equal(h.requests.length,2);
 const latest={...first,profile:{...first.profile,name:'updated'}},Editor=()=>null;
 h.render(latest);assert.equal(h.requests.length,2);h.requests[1].resolve({SettingsPanel:Editor});await flush();
 const ready=h.render(latest);assert.equal(ready.type,Editor);assert.equal(ready.props.profile,latest.profile);assert.equal(ready.props.identity,latest.identity);h.stop();
});

test('one shared import completing after an account change belongs only to the mounted owner',async()=>{
 const shared=deferred(),a=loaderHarness(()=>shared.promise),b=loaderHarness(()=>shared.promise),Editor=()=>null;
 a.render(props('a'));await flush();a.stop();const current=props('b');b.render(current);await flush();
 shared.resolve({SettingsPanel:Editor});await flush();assert.equal(a.state[0],null);assert.deepEqual(a.updates,[]);
 const ready=b.render(current);assert.equal(ready.type,Editor);assert.equal(ready.props.identity.ownerKey,'b');b.stop();
});

function profileView({auth,retained=null}){
 const source=readFileSync(new URL('../src/components/cabinet/CabinetProfileBar.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('CabinetProfileBar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CabinetProfileView');assert.ok(declaration);
 const module={exports:{}};
 vm.runInNewContext(compile(declaration.getText(ast)),{module,exports:module.exports,useAuthState:()=>auth,
  useCookieCabinetProfile:()=>retained,useState:initial=>[initial,()=>{}],useEffect(){},Image:'image',Settings2:'icon',SettingsPanelLoader:'settings-loader',CabinetProfileFailure:'profile-failure',
  require:name=>{assert.equal(name,'react/jsx-runtime');return {jsx,jsxs:jsx};}});
 return data=>module.exports.CabinetProfileView({data});
}
const data=owner=>({identity:{ownerKey:owner,email:owner+'@local.invalid'},profile:{name:owner,email:owner+'@local.invalid',phone:'',avatarDataUrl:''},loading:false});

test('profile never displays another account or unresolved identity',()=>{
 for(const auth of [{state:'loading',userId:'a'},{state:'signed-out',userId:null},{state:'signed-in',userId:'b'},{state:'signed-in',userId:null}])assert.equal(profileView({auth})(data('a')),null);
 const ready=profileView({auth:{state:'signed-in',userId:'a'}})(data('a'));assert.ok(text(ready).includes('a@local.invalid'));
});

test('retained avatar opens the same owner-keyed editor and errors keep the reload callback',()=>{
 const ready=profileView({auth:{state:'signed-in',userId:'a'},retained:{avatarDraft:{src:'synthetic'},avatarPreparation:null}})(data('a'));
 const editor=nodes(ready).find(node=>node.type==='settings-loader');assert.ok(editor);assert.equal(editor.key,'a');assert.equal(editor.props.identity.ownerKey,'a');
 const reload=()=>{},failure=profileView({auth:{state:'signed-in',userId:'a'}})({identity:null,profile:null,loading:false,profileError:'Не удалось загрузить профиль.',reloadProfile:reload});
 assert.equal(failure.type,'profile-failure');assert.equal(failure.props.reload,reload);
});

test('private avatar keeps its direct source instead of the unauthenticated image optimizer',()=>{
 const current=data('a');current.profile.avatarDataUrl='blob:synthetic-avatar';
 const view=profileView({auth:{state:'signed-in',userId:'a'}})(current);
 const avatar=nodes(view).find(node=>node.type==='image');assert.ok(avatar);
 assert.equal(avatar.props.src,'blob:synthetic-avatar');assert.equal(avatar.props.unoptimized,true);
 assert.equal(avatar.props.width,48);assert.equal(avatar.props.height,48);
});
