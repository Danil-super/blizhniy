import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import {installLegacyBookingStorageCleanup} from '../src/lib/booking-notifications.ts';
import {clearLegacyDemoPublicationsStorage} from '../src/lib/demo-publications.ts';
import {clearLegacySiteNotificationStorage} from '../src/lib/site-notification-storage.ts';

const require=createRequire(import.meta.url),ts=require('typescript');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(file,{primary=null,failImport=false,configured=true}={}){
 const effects=[],updates=[],state=[],routes=[],stored=new Map([
  ['blizhniy-booking-requests','private booking'],['blizhniy-booking-notifications','private booking message'],
  ['blizhniy-demo-publications','private publication'],['blizhniy-site-notifications:owner','private message'],['blizhniy-city','krasnodar'],
 ]);
 let slot=0,imports=0,subscriptions=0,unsubscriptions=0,authChange,settleSession,logouts=0;
 const session=new Promise(resolve=>{settleSession=resolve;});
 const sdk={getSupabaseBrowserClient:()=>({auth:{
  getSession:()=>session,signOut:async()=>{logouts++;return {error:null};},
  onAuthStateChange(callback){subscriptions++;authChange=callback;return {data:{subscription:{unsubscribe(){unsubscriptions++;}}}};},
 }}),isSupabaseBrowserConfigured:()=>configured};
 const storage={get length(){return stored.size;},key:i=>[...stored.keys()][i],removeItem:key=>stored.delete(key)};
 const react={useEffect:effect=>effects.push(effect),useRef:value=>({current:value}),useState:initial=>{
  const index=slot++;state[index]=initial;return [initial,value=>{updates.push([index,value]);state[index]=value;}];
 }};
 const module={exports:{}};
 const source=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const jsx=(type,props)=>({type,props});
 vm.runInNewContext(js,{module,exports:module.exports,Promise,window:{localStorage:storage},require:id=>{
  if(id==='react')return react;
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
  if(id==='next/navigation')return {useRouter:()=>({push:url=>routes.push(url),refresh:()=>routes.push('refresh')})};
  if(id==='lucide-react')return {LogOut:'icon'};
  if(id==='@/components/auth/AccountAuthProvider')return {usePrimaryAccountAuth:()=>primary};
  if(id==='@/lib/local-account')return {productionAccount:{logout:async()=>{logouts++;}},notifyAccountSessionChange(){}};
  if(id==='@/lib/client-runtime-mode')return {shouldShowClientFallbackContent:()=>false};
  if(id==='@/lib/booking-notifications')return {installLegacyBookingStorageCleanup};
  if(id==='@/lib/demo-publications')return {clearLegacyDemoPublicationsStorage};
  if(id==='@/lib/site-notification-storage')return {clearLegacySiteNotificationStorage};
  if(id==='@/lib/supabase-browser'){imports++;if(failImport)throw new Error('synthetic unavailable chunk');return sdk;}
  throw new Error('Unexpected dependency: '+id);
 }});
 const exported=file.includes('Logout')?'LogoutButton':'BookingLegacyStorageCleanup';
 let node=module.exports[exported]();
 while(typeof node?.type==='function')node=node.type(node.props);
 const cleanups=effects.map(effect=>effect());
 return {stored,updates,state,routes,node,imports:()=>imports,subscriptions:()=>subscriptions,unsubscriptions:()=>unsubscriptions,logouts:()=>logouts,
  stop:()=>cleanups.forEach(cleanup=>cleanup?.()),emit:session=>authChange('SIGNED_OUT',session),
  settle:session=>settleSession({data:{session},error:null}),failSession:()=>settleSession({data:{session:null},error:new Error('synthetic late error')})};
}

for(const mode of ['signed-out','unavailable'])test(`root clears private legacy storage without SDK in primary ${mode}`,async()=>{
 const h=harness('BookingLegacyStorageCleanup.tsx',{primary:{state:mode,userId:null}});
 assert.deepEqual([...h.stored],[['blizhniy-city','krasnodar']]);
 await flush();assert.equal(h.imports(),0);h.stop();
});

test('root clears private storage before a failed legacy chunk resolves',async()=>{
 const h=harness('BookingLegacyStorageCleanup.tsx',{failImport:true});
 assert.deepEqual([...h.stored],[['blizhniy-city','krasnodar']]);
 await flush();assert.equal(h.imports(),1);assert.equal(h.subscriptions(),0);h.stop();
});

test('root unsubscribes and cannot install a subscription after unmount',async()=>{
 const early=harness('BookingLegacyStorageCleanup.tsx');early.stop();await flush();assert.equal(early.subscriptions(),0);
 const mounted=harness('BookingLegacyStorageCleanup.tsx');await flush();assert.equal(mounted.subscriptions(),1);
 mounted.stored.set('blizhniy-site-notifications:other','private');mounted.emit(null);assert.equal(mounted.stored.has('blizhniy-site-notifications:other'),false);
 mounted.stop();assert.equal(mounted.unsubscriptions(),1);
});

test('legacy logout ignores an old session read after sign-out and unsubscribes',async()=>{
 const h=harness('auth/LogoutButton.tsx');await flush();assert.equal(h.subscriptions(),1);
 h.emit(null);h.settle({user:{id:'old-owner'}});await flush();assert.equal(h.state[1],false);
 h.stop();assert.equal(h.unsubscriptions(),1);
});

test('legacy logout handles import failure and never writes after unmount',async()=>{
 const failed=harness('auth/LogoutButton.tsx',{failImport:true});await flush();assert.equal(failed.state[1],false);failed.stop();
 const early=harness('auth/LogoutButton.tsx');early.stop();await flush();assert.equal(early.subscriptions(),0);assert.deepEqual(early.updates,[]);
 const late=harness('auth/LogoutButton.tsx');await flush();late.stop();late.settle({user:{id:'old-owner'}});await flush();assert.deepEqual(late.updates,[]);
});

test('failed initial session read cannot erase a newer sign-in event',async()=>{
 const h=harness('auth/LogoutButton.tsx');await flush();
 h.emit({user:{id:'current-owner'}});h.failSession();await flush();
 assert.equal(h.state[1],true);h.stop();
});

test('failed legacy chunk does not clear storage after root cleanup has unmounted',async()=>{
 const h=harness('BookingLegacyStorageCleanup.tsx',{failImport:true});h.stop();
 h.stored.set('blizhniy-demo-publications','new demo content');await flush();
 assert.equal(h.stored.get('blizhniy-demo-publications'),'new demo content');
});

test('primary logout uses the cookie endpoint and never imports the legacy SDK',async()=>{
 const h=harness('auth/LogoutButton.tsx',{primary:{state:'signed-in',userId:'owner'}});
 const control=h.node.props.children[0];
 await control.props.onClick();
 assert.equal(h.logouts(),1);assert.equal(h.imports(),0);assert.deepEqual(h.routes,['/auth','refresh']);
});
