const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),owner='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003',paymentId='10000000-0000-4000-8000-000000000004',stamp='2026-10-26T08:00:00.123456Z';
const order={id:paymentId,creationKey:key,targetId:id,targetRevision:'4',tariffId:'job-response',amount:'199.00',durationDays:null,status:'created',createdAt:stamp},quote={applicationId:id,revision:'4',tariff:{id:'job-response',name:'Отклик',amount:'199.00',currency:'RUB',durationDays:null},activePayment:null};
const jsx=(type,props)=>({type,props:props||{}}),walk=node=>Array.isArray(node)?node.flatMap(walk):!node||typeof node!=='object'?[]:[node,...walk(node.props?.children)],text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
class ClientError extends Error{constructor(code){super(code);this.code=code;}}
function mount(kind,api,props={}){const instances=new Map(),effects=[],calls=[],locks=[],redirects=[];let current,tree,dirty=false,auth={state:'signed-in',userId:owner};
 const react={useState(initial){const i=current,n=i.cursor++;if(!Object.hasOwn(i.values,n))i.values[n]=typeof initial==='function'?initial():initial;return[i.values[n],v=>{const next=typeof v==='function'?v(i.values[n]):v;if(!Object.is(next,i.values[n])){i.values[n]=next;dirty=true;}}];},useRef(initial){const i=current,n=i.cursor++;return i.values[n]??={current:initial};},useEffect(work,deps){const i=current,n=i.cursor++,prior=i.values[n];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){i.values[n]={deps};effects.push(()=>{prior?.cleanup?.();i.values[n].cleanup=work();});}},useMemo(work,deps){const i=current,n=i.cursor++,prior=i.values[n];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j])))i.values[n]={deps,value:work()};return i.values[n].value;}};react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const client=new Proxy({},{get(_target,name){return async(...args)=>{calls.push({method:name,args});assert.equal(typeof api[name],'function',`Explicit ${name} response`);return api[name](...args);};}}),cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;new Function('require','exports','window','crypto',code)(name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:({children})=>children};if(name==='next/link')return{__esModule:true,default:({children,...props})=>jsx('a',{...props,children})};
  if(name==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>auth};if(name==='@/lib/local-account')return{notifyAccountSessionChange(){}};if(name==='./ApplicationDetail')return{applicationButton:'button'};
  if(name==='@/lib/client-application-payment')return{applicationPayment:client,ApplicationPaymentClientError:ClientError,applicationPaymentMatchesInput:(saved,input)=>saved.creationKey===input.creationKey&&saved.targetId===input.applicationId&&saved.targetRevision===input.expectedRevision&&saved.tariffId===input.expectedTariffId&&saved.amount===input.expectedAmount};
  throw Error(`Unexpected UI dependency ${name}`);
 },out,{location:{assign:href=>redirects.push(href)}},{randomUUID:()=>key});return out;}
 const file=kind==='checkout'?'src/components/applications/ApplicationCheckout.tsx':'src/components/payments/ApplicationPaymentReturnClient.tsx',module=load(path.join(root,file)),component=module.ApplicationCheckout||module.ApplicationPaymentReturnClient;
 function expand(node,keyPath='root'){if(Array.isArray(node))return node.map((v,j)=>expand(v,`${keyPath}:${j}`));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const i=instances.get(keyPath)||{values:[],cursor:0};instances.set(keyPath,i);i.cursor=0;const prev=current;current=i;const out=node.type(node.props);current=prev;return expand(out,`${keyPath}:render`);}return{...node,props:{...node.props,children:expand(node.props.children,`${keyPath}:children`)}};}
 function render(){dirty=false;tree=expand(jsx(component,kind==='checkout'?{owner,id,revision:'4',onLockChange:value=>locks.push(value),...props}:{paymentId}));while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}return tree;}
 function button(label){const found=walk(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(found,`Button ${label}`);return found;}
 render();return{calls,locks,redirects,settle,render,button,auth:value=>{auth=value;render();},get tree(){return tree;}};
}
test('checkout explicitly previews and prepares once with the server tariff before opening the local application payment page',async()=>{
 const h=mount('checkout',{preview:async()=>quote,prepare:async()=>order});await h.settle();assert.equal(h.calls.length,0);h.button('Оплатить отклик (локальная TEST)').props.onClick();await h.settle();
 assert.deepEqual(h.calls.map(c=>c.method),['preview','prepare']);assert.deepEqual(h.calls[1].args.slice(0,2),[owner,{applicationId:id,expectedRevision:'4',creationKey:key,expectedTariffId:'job-response',expectedAmount:'199.00'}]);assert.deepEqual(h.redirects,[`/oplata/${paymentId}?type=application`]);assert.ok(h.locks.includes(true));assert.equal(h.locks.at(-1),false);
});
test('checkout reuses an existing order without creating another one',async()=>{
 const h=mount('checkout',{preview:async()=>({...quote,activePayment:order})});await h.settle();h.button('Оплатить отклик (локальная TEST)').props.onClick();await h.settle();assert.deepEqual(h.calls.map(c=>c.method),['preview']);assert.deepEqual(h.redirects,[`/oplata/${paymentId}?type=application`]);
});
test('the explicit composer payment click starts checkout once and never retries an uncertain prepare on auth return',async()=>{
 const h=mount('checkout',{preview:async()=>quote,prepare:async()=>{throw new ClientError('UNKNOWN');}},{autoStart:true});await new Promise(resolve=>setTimeout(resolve,5));await h.settle();
 assert.deepEqual(h.calls.map(c=>c.method),['preview','prepare']);assert.equal(h.locks.at(-1),true);assert.deepEqual(h.redirects,[]);
 h.auth({state:'unavailable'});await h.settle();h.auth({state:'signed-in',userId:owner});await h.settle();
 assert.equal(h.calls.filter(c=>c.method==='prepare').length,1);assert.ok(h.button('Проверить сохранённый заказ'));
});
for(const status of ['created','pending','succeeded'])test(`closed order ${status} preserves financial history and offers no new payment`,async()=>{
 const h=mount('return',{read:async()=>({order:{...order,status},deliveredAt:null,targetClosed:true})});await h.settle();
 assert.match(text(h.tree),/Заказ(чик| закрыт)/);assert.doesNotMatch(text(h.tree),/доставка ожидается|проверьте этот заказ позже/i);
 assert.ok(!walk(h.tree).some(n=>n.type==='button'&&/Открыть локальную TEST-оплату/.test(text(n))));
 if(status==='succeeded')assert.match(text(h.tree),/возврат не выполнен/);
 assert.deepEqual(h.calls.map(c=>c.method),['read']);
});
test('unknown prepare remains locked across auth recheck and recovers the original key without automatic retry',async()=>{
 let prepares=0;const h=mount('checkout',{preview:async()=>quote,prepare:async()=>{if(++prepares===1)throw new ClientError('UNKNOWN');return order;},recover:async()=>null});await h.settle();h.button('Оплатить отклик (локальная TEST)').props.onClick();await h.settle();assert.equal(h.locks.at(-1),true);assert.deepEqual(h.redirects,[]);
 h.auth({state:'unavailable'});await h.settle();h.auth({state:'signed-in',userId:owner});await h.settle();assert.equal(h.calls.filter(c=>c.method==='prepare').length,1);h.button('Проверить сохранённый заказ').props.onClick();await h.settle();assert.equal(h.calls.find(c=>c.method==='recover').args[1],key);h.button('Повторить тот же TEST-заказ').props.onClick();await h.settle();
 const writes=h.calls.filter(c=>c.method==='prepare');assert.equal(writes.length,2);assert.deepEqual(writes[0].args[1],writes[1].args[1]);assert.deepEqual(h.redirects,[`/oplata/${paymentId}?type=application`]);
});
test('return status reads are readonly and dispatch only uses the explicitly requested local simulator route',async()=>{
 const h=mount('return',{read:async()=>({order,deliveredAt:null}),dispatch:async()=>({confirmationUrl:'https://yoomoney.ru/pay',isTest:true})});await h.settle();assert.deepEqual(h.calls.map(c=>c.method),['read']);h.button('Открыть локальную TEST-оплату').props.onClick();await h.settle();assert.deepEqual(h.redirects,[`/__local/payment?intent=${paymentId}&type=application`]);h.button('Проверить статус').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.method==='read').length,2);assert.equal(h.calls.filter(c=>c.method==='dispatch').length,1);
});
for(const [status,deliveredAt,expected] of [['pending',null,'Платёж обрабатывается'],['failed',null,'Оплата не завершена'],['succeeded',null,'Оплата подтверждена, доставка ожидается'],['succeeded',stamp,'Отклик доставлен'],['refunded',stamp,'Платёж возвращён']])test(`return displays truthful ${status}/${!!deliveredAt} without a fake placement term`,async()=>{
 const h=mount('return',{read:async()=>({order:{...order,status},deliveredAt})});await h.settle();assert.match(text(h.tree),new RegExp(expected));assert.doesNotMatch(text(h.tree),/30 дн|Срок размещения|null дн/);assert.deepEqual(h.calls.map(c=>c.method),['read']);assert.deepEqual(h.redirects,[]);
});
