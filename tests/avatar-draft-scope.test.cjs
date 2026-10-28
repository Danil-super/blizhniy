const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const ts=require('typescript');
function fixture(){
 const slots=[];let index=0;
 const state=initial=>{const slot=index++;if(!(slot in slots))slots[slot]=initial;return[slots[slot],next=>{slots[slot]=typeof next==='function'?next(slots[slot]):next;}];};
 const react={createContext:()=>({Provider:'provider'}),useState:state,useRef:value=>{const slot=index++;if(!(slot in slots))slots[slot]={current:value};return slots[slot];},useEffect(){}};
 const source=fs.readFileSync(new URL('../src/components/cabinet/CookieCabinetProfileProvider.tsx',`file://${__filename}`),'utf8');
 const exports={};const jsx=(type,props)=>({type,props});
 new Function('require','exports',ts.transpileModule(source+'\nexports.ProfileScope=ProfileScope;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
 }).outputText)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name.endsWith('/AccountAuthProvider'))return{};
  if(name.endsWith('/local-account'))return{};
  if(name.endsWith('/client-postgres-profile'))return{CookieProfileError:class extends Error{}};
  assert.fail('Unexpected dependency '+name);
 },exports);
 return auth=>{index=0;return exports.ProfileScope({auth,children:null}).props.value;};
}
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const selection={draft:{src:'data:image/png;base64,synthetic',zoom:1.3,offsetX:2,offsetY:3},imageSize:{width:640,height:480}};
test('avatar selection survives temporary rechecking only for the same verified owner and is discarded on real logout',()=>{
 const render=fixture();render({state:'signed-in',userId:owner}).setAvatarDraft(selection);
 assert.deepEqual(render({state:'signed-in',userId:owner}).avatarDraft,selection);
 assert.equal(render({state:'checking'}).avatarDraft,null,'An unverified identity never receives the private selection');
 assert.deepEqual(render({state:'signed-in',userId:owner}).avatarDraft,selection);
 render({state:'signed-out'});
 assert.equal(render({state:'signed-in',userId:owner}).avatarDraft,null,'A later login cannot recover a logged-out draft');
});
test('changing account erases avatar selection and a stale callback cannot write into the new account',()=>{
 const render=fixture(),old=render({state:'signed-in',userId:owner});old.setAvatarDraft(selection);
 assert.equal(render({state:'signed-in',userId:other}).avatarDraft,null);
 old.setAvatarDraft(selection);
 assert.equal(render({state:'signed-in',userId:other}).avatarDraft,null);
 assert.equal(render({state:'signed-in',userId:owner}).avatarDraft,null);
});
