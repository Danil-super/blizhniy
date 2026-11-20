const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),ts=require('typescript');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const initial={name:'Original',phone:'',phoneVerified:false,verifiedPhone:'',city:'Краснодар',email:'synthetic@example.invalid'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class CookieProfileError extends Error{constructor(code){super(code);this.code=code;}}
function fixture(){
 const slots=[],effects=[];let index=0,read=async()=>({profile:{...initial},revision:'r1'}),writes=[];
 const api={read:(...args)=>read(...args),write:async(owner,profile,revision)=>{writes.push({owner,profile,revision});return{profile,revision:'r3'};}};
 const react={createContext:()=>({Provider:'provider'}),useState(initial){const n=index++;if(!(n in slots))slots[n]=initial;return[slots[n],next=>{slots[n]=typeof next==='function'?next(slots[n]):next;}];},useRef(initial){const n=index++;if(!(n in slots))slots[n]={current:initial};return slots[n];},useEffect(fn,deps){const n=index++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){slots[n]={deps,cleanup:null};effects.push(()=>{old?.cleanup?.();slots[n].cleanup=fn();});}}};
 const exports={},jsx=(type,props)=>({type,props});
 new Function('require','exports',ts.transpileModule(fs.readFileSync(new URL('../src/components/cabinet/CookieCabinetProfileProvider.tsx',`file://${__filename}`),'utf8')+'\nexports.ProfileScope=ProfileScope;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name.endsWith('/client-postgres-profile'))return{productionProfile:api,CookieProfileError};if(name.endsWith('/local-account')||name.endsWith('/AccountAuthProvider'))return{};assert.fail('Unexpected dependency '+name);
 },exports);
 return{render(id=owner){index=0;const value=exports.ProfileScope({auth:{state:'signed-in',userId:id},children:null}).props.value;for(const effect of effects.splice(0))effect();return value;},setRead(fn){read=fn;},writes};
}
test('phone refresh preserves dirty settings and uses the confirmed server revision for the next save',async()=>{
 const f=fixture();f.render();await tick();let value=f.render();value.setSettingsDraft({...initial,name:'Unsaved name',city:'Армавир'});
 f.setRead(async()=>({profile:{...initial,phone:'+79991234567',phoneVerified:true,verifiedPhone:'+79991234567'},revision:'r2'}));await value.refreshVerifiedPhone();value=f.render();
 assert.equal(value.settingsDraft.name,'Unsaved name');assert.equal(value.settingsDraft.city,'Армавир');assert.equal(value.settingsDraft.phone,'+79991234567');assert.equal(value.settingsDraft.phoneVerified,true);
 await value.saveProfile(value.settingsDraft);assert.equal(f.writes[0].revision,'r2');
});
test('unrelated remote profile changes keep the draft and refuse blind revision adoption',async()=>{
 const f=fixture();f.render();await tick();let value=f.render();value.setSettingsDraft({...initial,name:'Unsaved name'});f.setRead(async()=>({profile:{...initial,name:'Remote edit'},revision:'r2'}));
 await assert.rejects(value.refreshVerifiedPhone(),{code:'PROFILE_CHANGED'});value=f.render();assert.equal(value.settingsDraft.name,'Unsaved name');assert.equal(value.conflict,true);await assert.rejects(value.saveProfile(value.settingsDraft),{code:'SESSION_CHANGED'});assert.equal(f.writes.length,0);
});
test('a delayed phone read cannot overwrite a newer profile save or another account',async()=>{
 for(const changeOwner of [false,true]){const f=fixture();f.render();await tick();const value=f.render();let resolve;f.setRead(()=>new Promise(r=>{resolve=r;}));const pending=value.refreshVerifiedPhone(),finish=resolve;
  if(changeOwner)f.render(other);else await value.saveProfile({...initial,name:'New saved name'});
  finish({profile:{...initial,phone:'+79991234567',phoneVerified:true,verifiedPhone:'+79991234567'},revision:'stale'});
  await assert.rejects(pending,{code:'SESSION_CHANGED'});const next=f.render(changeOwner?other:owner);if(changeOwner)assert.equal(next.profile,null);else assert.equal(next.profile.name,'New saved name');
 }
});
test('a same-owner session recheck keeps the draft tied to its original revision until explicit conflict recovery',async()=>{
 const f=fixture();
 f.render();await tick();
 f.render().setSettingsDraft({...initial,name:'Draft name'});
 f.render(null);
 f.setRead(async()=>({profile:{...initial,city:'Армавир'},revision:'r2'}));
 f.render();await tick();
 const conflicted=f.render();
 assert.equal(conflicted.settingsDraft.name,'Draft name');
 assert.equal(conflicted.conflict,true);
 await assert.rejects(conflicted.saveProfile(conflicted.settingsDraft),{code:'PROFILE_CHANGED'});
 assert.equal(f.writes.length,0);
 conflicted.clearSettingsDraft();
 const recovered=f.render();
 assert.equal(recovered.settingsDraft,null);
 assert.equal(recovered.profile.city,'Армавир');
});
test('a completed settings write only clears the draft that was submitted',async()=>{
 const f=fixture();f.render();await tick();
 const value=f.render(),first={...initial,name:'First edit'},later={...initial,name:'Further edit'};
 value.setSettingsDraft(first);
 const selection={draft:{src:'fixture',zoom:1,offsetX:0,offsetY:0},imageSize:{width:50,height:50}};
 value.setAvatarDraft(selection);
 value.setSettingsDraft(later);
 value.clearSavedSettings(first);
 assert.equal(f.render().settingsDraft,later);
 value.clearSavedSettings(later);
 assert.equal(f.render().settingsDraft,null);
 assert.equal(f.render().avatarDraft,selection);
});
