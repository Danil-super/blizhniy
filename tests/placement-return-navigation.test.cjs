const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const owner='10000000-0000-4000-8000-000000000001',payment='20000000-0000-4000-8000-000000000002';
const jsx=(type,props,key)=>({type,props:props||{},key}),walk=n=>Array.isArray(n)?n.flatMap(walk):!n||typeof n!=='object'?[]:[n,...walk(n.props.children)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n==null||typeof n==='boolean'?'':typeof n==='object'?text(n.props.children):String(n);
function mount(options={}){
 const instances=new Map(),effects=[],timers=new Map(),reads=[],navigation=[];let current,dirty=false,tree,timerId=0;
 let auth={state:'signed-in',userId:owner},result={order:{id:payment,status:'succeeded'},fulfillment:null},readOverride=null;
 const router={replace:href=>navigation.push(href)};
 const react={useState(initial){const i=current,n=i.cursor++;if(!Object.hasOwn(i.values,n))i.values[n]=typeof initial==='function'?initial():initial;return[i.values[n],v=>{const value=typeof v==='function'?v(i.values[n]):v;if(!Object.is(value,i.values[n])){i.values[n]=value;dirty=true;}}];},
  useRef(initial){const i=current,n=i.cursor++;return i.values[n]??={current:initial};},
  useEffect(work,deps){const i=current,n=i.cursor++,old=i.values[n];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){i.values[n]={deps};effects.push(()=>{old?.cleanup?.();i.values[n].cleanup=work();});}}};
 const read=async(...args)=>{reads.push(args);await Promise.resolve();return readOverride?readOverride(...args):structuredClone(result);};
 const exports={};new Function('require','exports','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/payments/PrimaryPaymentReturnClient.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/navigation')return{useRouter:()=>router};if(name==='next/link')return{__esModule:true,default:props=>jsx('a',props)};
  if(name==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>auth};
  if(name==='@/lib/client-listing-payment')return{listingPayment:{read},ListingPaymentClientError:class extends Error{}};
  if(name==='@/lib/client-specialist-payment')return{specialistPaymentStatus:{read}};
  if(name==='@/lib/client-vacancy-payment')return{vacancyPaymentStatus:{read},workRequestPaymentStatus:{read}};
  if(name==='@/lib/local-account')return{notifyAccountSessionChange(){}};
  if(name==='./ListingPaymentStatus')return{ListingPaymentStatus:({snapshot})=>jsx('h2',{children:snapshot.order.status})};
  if(name==='./TestPaymentLaunch'||name==='./CheckoutCancellation'||name==='@/components/phone/PhonePaymentNotice')return new Proxy({},{get:()=>()=>null});
  throw Error('Unapproved return dependency '+name);
 },exports,callback=>{timers.set(++timerId,callback);return timerId;},id=>timers.delete(id));
 function expand(node,location,used){if(Array.isArray(node))return node.map((v,i)=>expand(v,location+':'+i,used));if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){location+=':'+String(node.key??'');used.add(location);const i=instances.get(location)||{values:[],cursor:0};instances.set(location,i);i.cursor=0;const old=current;current=i;const child=node.type(node.props);current=old;return expand(child,location+':render',used);}
  return{...node,props:{...node.props,children:expand(node.props.children,location+':children',used)}};}
 function render(){dirty=false;const used=new Set();tree=expand(jsx(exports.PrimaryPaymentReturnClient,{paymentId:payment,testCheckout:true,...options}),'root',used);for(const [key,i] of instances)if(!used.has(key)){for(const v of i.values)v?.cleanup?.();instances.delete(key);}while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<12;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 render();return{navigation,reads,settle,setResult:v=>result=v,setRead:v=>readOverride=v,setAuth:v=>{auth=v;render();},
  buttons:()=>walk(tree).filter(n=>n.type==='button').map(text),links:()=>walk(tree).filter(n=>n.type==='a'),
  async tick(){assert.ok(timers.size,'Expected one automatic action');const [id,fn]=timers.entries().next().value;timers.delete(id);fn();if(dirty)render();await settle();},
  stop(){for(const i of instances.values())for(const v of i.values)v?.cleanup?.();},get timerCount(){return timers.size;}};
}
for(const [options,destination] of [[{},'/cabinet/obyavleniya'],[{vacancy:true},'/cabinet/vakansii'],[{workRequest:true},'/cabinet/zakazy'],[{specialist:true},'/cabinet/specialist']])test('verified success returns once to '+destination,async()=>{
 const h=mount(options);await h.settle();assert.deepEqual(h.buttons(),[]);assert.equal(h.links().filter(n=>text(n)==='Вернуться на сайт').length,1);
 await h.tick();assert.deepEqual(h.navigation,[destination]);assert.equal(h.reads.length,1);assert.equal(h.timerCount,0);h.stop();
});
test('pending orders poll only the same owner order and stop after ten automatic checks',async()=>{
 const h=mount();h.setResult({order:{id:payment,status:'pending'},fulfillment:null});await h.settle();
 for(let i=0;i<10;i++)await h.tick();assert.equal(h.reads.length,11);assert.equal(h.timerCount,0);assert.deepEqual(h.navigation,[]);
 for(const [id,target] of h.reads)assert.deepEqual([id,target],[owner,payment]);h.stop();
});
test('live succeeded without fulfillment cannot trigger success navigation',async()=>{
 const h=mount({testCheckout:false});await h.settle();await h.tick();assert.deepEqual(h.navigation,[]);
 h.setResult({order:{id:payment,status:'succeeded'},fulfillment:{publishedAt:'2026-11-16T12:00:00Z'}});await h.tick();await h.tick();assert.deepEqual(h.navigation,['/cabinet/obyavleniya']);h.stop();
});
for(const state of ['failed','refunded'])test(state+' is not an automatic success',async()=>{
 const h=mount();h.setResult({order:{id:payment,status:state},fulfillment:null});await h.settle();assert.equal(h.timerCount,0);assert.deepEqual(h.navigation,[]);h.stop();
});
test('strict revalidation cancels navigation; a failed fresh check cannot reuse an old success',async()=>{
 const h=mount();await h.settle();assert.equal(h.timerCount,1);h.setAuth({state:'loading',userId:null});await h.settle();assert.equal(h.timerCount,0);
 h.setRead(async()=>{throw Error('Synthetic unavailable');});h.setAuth({state:'signed-in',userId:owner});await h.settle();assert.equal(h.timerCount,0);assert.deepEqual(h.navigation,[]);assert.ok(h.buttons().includes('Проверить статус'));h.stop();
});
test('a different owner, null readback and late old response cannot navigate',async()=>{
 const h=mount();let release;h.setRead(()=>new Promise(resolve=>release=resolve));await h.settle();
 h.setRead(async()=>null);h.setAuth({state:'signed-in',userId:'30000000-0000-4000-8000-000000000003'});await h.settle();
 release({order:{id:payment,status:'succeeded'},fulfillment:null});await h.settle();assert.equal(h.timerCount,0);assert.deepEqual(h.navigation,[]);h.stop();
});
test('unmount cancels a confirmed success timer',async()=>{
 const h=mount();await h.settle();assert.equal(h.timerCount,1);h.stop();assert.equal(h.timerCount,0);assert.deepEqual(h.navigation,[]);
});
