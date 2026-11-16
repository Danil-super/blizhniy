const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),owner='10000000-0000-4000-8000-000000000001',payment='10000000-0000-4000-8000-000000000002';
const jsx=(type,props)=>({type,props:props||{}}),walk=n=>Array.isArray(n)?n.flatMap(walk):!n||typeof n!=='object'?[]:[n,...walk(n.props.children)],text=n=>Array.isArray(n)?n.map(text).join(''):n==null||typeof n==='boolean'?'':typeof n==='object'?text(n.props.children):String(n);
class ClientError extends Error{constructor(code){super(code);this.code=code;}}
function mount(application){const instances=new Map(),effects=[],cache=new Map(),calls=[];let current,dirty=false,tree,auth={state:'signed-in',userId:owner},applied=false,resolveWrite;
 const pendingWrite=new Promise(resolve=>resolveWrite=resolve),snapshot=()=>({order:{id:payment,status:applied?'failed':'created',amount:'199.00',durationDays:application?null:30},fulfillment:null,deliveredAt:null,targetClosed:false});
 const react={useState(initial){const i=current,n=i.cursor++;if(!Object.hasOwn(i.values,n))i.values[n]=typeof initial==='function'?initial():initial;return[i.values[n],value=>{const next=typeof value==='function'?value(i.values[n]):value;if(!Object.is(next,i.values[n])){i.values[n]=next;dirty=true;}}];},useRef(initial){const i=current,n=i.cursor++;return i.values[n]??={current:initial};},useEffect(work,deps){const i=current,n=i.cursor++,old=i.values[n];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){i.values[n]={deps};effects.push(()=>{old?.cleanup?.();i.values[n].cleanup=work();});}}};
 const read=async()=>{calls.push('payment.read');return snapshot();};
 function load(name){if(cache.has(name))return cache.get(name);const out={};cache.set(name,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(root,'src/components/payments',name+'.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(dep=>{
  if(dep==='react')return react;if(dep==='react/jsx-runtime')return{jsx,jsxs:jsx};if(dep==='next/link')return{__esModule:true,default:props=>jsx('a',props)};
  if(dep==='next/navigation')return{useRouter:()=>({replace(){assert.fail('Cancellation must not automatically navigate');}})};
  if(dep==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>auth};if(dep==='@/components/listings/ListingWorkflowProvider')return{useLocalPaymentSimulation:()=>true};
  if(dep==='@/lib/local-account')return{notifyAccountSessionChange(){calls.push('session.notify');}};
  if(dep==='@/lib/client-listing-payment')return{listingPayment:{read},ListingPaymentClientError:ClientError};if(dep==='@/lib/client-vacancy-payment')return{vacancyPaymentStatus:{read},workRequestPaymentStatus:{read}};
  if(dep==='@/lib/client-application-payment')return{applicationPayment:{read},ApplicationPaymentClientError:ClientError};
  if(dep==='@/lib/client-checkout-cancellation')return{CheckoutCancellationClientError:ClientError,checkoutCancellation:{cancel:async()=>{calls.push('cancel.write');return pendingWrite;},read:async()=>{calls.push('cancel.read');return{paymentId:payment,targetType:application?'application':'listing',state:'cancelled'};}}};
  if(dep==='./CheckoutCancellation')return load('CheckoutCancellation');if(dep==='./ListingPaymentStatus')return{ListingPaymentStatus:({snapshot})=>jsx('h2',{children:snapshot.order.status})};
  if(dep==='./TestPaymentLaunch')return{TestPaymentLaunch:({disabled})=>jsx('button',{disabled,children:'Запустить оплату'})};if(dep==='@/components/phone/PhonePaymentNotice')return{PhonePaymentNotice:()=>null};
  throw Error('Unapproved cancellation UI dependency: '+dep);
 },out);return out;}
 const component=application?load('ApplicationPaymentReturnClient').ApplicationPaymentReturnClient:load('PrimaryPaymentReturnClient').PrimaryPaymentReturnClient;
 function expand(node,location,used){if(Array.isArray(node))return node.map((v,i)=>expand(v,location+':'+i,used));if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){used.add(location);const i=instances.get(location)||{values:[],cursor:0};instances.set(location,i);i.cursor=0;const previous=current;current=i;const child=node.type(node.props);current=previous;return expand(child,location+':render',used);}
  return{...node,props:{...node.props,children:expand(node.props.children,location+':children',used)}};}
 function render(){dirty=false;const used=new Set();tree=expand(jsx(component,{paymentId:payment,testCheckout:true,cancellationEnabled:true}),'root',used);for(const [key,i] of instances)if(!used.has(key)){for(const value of i.values)value?.cleanup?.();instances.delete(key);}while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<10;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 function button(label){const n=walk(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(n,'Missing button '+label);return n;}
 render();return{calls,settle,button,auth:value=>{auth=value;render();},commit:()=>{applied=true;resolveWrite({paymentId:payment,targetType:application?'application':'listing',state:'cancelled'});},get tree(){return tree;}};
}
for(const application of [false,true])test(`${application?'application':'placement'} cancellation survives same-owner auth revalidation and ignores the late write acknowledgement`,async()=>{
 const h=mount(application);await h.settle();assert.equal(h.calls.filter(c=>c==='payment.read').length,1);
 h.button('Отменить подготовку оплаты').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c==='cancel.write').length,1);
 h.auth({state:'loading',userId:null});await h.settle();h.auth({state:'signed-in',userId:owner});await h.settle();
 assert.equal(h.calls.filter(c=>c==='payment.read').length,1,'Generic refresh must wait for cancellation readback');assert.equal(h.button('Проверить отмену').props.disabled,false);
 const launch=application?'Открыть локальную TEST-оплату':'Запустить оплату';assert.equal(h.button(launch).props.disabled,true);
 h.commit();await h.settle();assert.equal(h.calls.filter(c=>c==='payment.read').length,1,'Late acknowledgement must not mutate the restored UI');
 h.button('Проверить отмену').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c==='cancel.read').length,1);assert.equal(h.calls.filter(c=>c==='cancel.write').length,1);
 assert.equal(h.calls.filter(c=>c==='payment.read').length,2);assert.equal(h.button('Проверить статус').props.disabled,false);assert.ok(!walk(h.tree).some(n=>n.type==='button'&&text(n)==='Проверить отмену'));
});
