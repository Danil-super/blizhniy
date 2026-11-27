import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import test from 'node:test';import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),jsx=(type,props,key)=>({type,props,key});
const nodes=root=>!root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];
const text=root=>typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness(){
 const state=[],effects=[],scheduled=[],requests=[];let index=0,effectIndex=0,auth={state:'signed-in',userId:'owner-a'},changes=0;
 const module={exports:{}};
 const source=readFileSync(new URL('../src/components/cabinet/PrimaryPaymentHistory.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 class ClientError extends Error{constructor(code){super('Не удалось загрузить историю платежей.');this.code=code;}}
 vm.runInNewContext(compiled+'\nexports.History=History;',{module,exports:module.exports,Intl,Number,Date,AbortController,
  require:name=>{
   if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='next/link')return {default:'link',__esModule:true};
   if(name==='react')return {useState(initial){const slot=index++;if(!Object.hasOwn(state,slot))state[slot]=initial;return[state[slot],value=>state[slot]=typeof value==='function'?value(state[slot]):value];},useEffect(work,deps){const slot=effectIndex++,old=effects[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))scheduled.push(()=>{old?.cleanup?.();effects[slot]={deps,cleanup:work()};});}};
   if(name==='@/components/auth/AccountAuthProvider')return {usePrimaryAccountAuth:()=>auth};
   if(name==='@/components/listings/ListingWorkflowProvider')return {useLocalPaymentSimulation:()=>false,useServiceCheckout:()=>false,useSpecialistCheckout:()=>!!auth.specialistTest};
   if(name==='@/lib/local-account')return {notifyAccountSessionChange:()=>changes++};
   if(name==='@/lib/client-payment-history')return {PaymentHistoryClientError:ClientError,paymentHistory:{list(owner,cursor,options){const request={owner,cursor,options,...deferred()};requests.push(request);return request.promise;}}};
   throw Error('Unexpected history dependency '+name);
  }});
 return{state,requests,ClientError,changes:()=>changes,setAuth:value=>auth=value,entry:()=>module.exports.PrimaryPaymentHistory(),render(owner='owner-a'){index=0;effectIndex=0;const tree=module.exports.History({owner});scheduled.splice(0).forEach(work=>work());return tree;},stop(){effects.forEach(effect=>effect.cleanup?.());}};
}
const item=(id='payment',type='listing')=>({id,targetType:type,amount:'199.50',status:'succeeded',isTest:true,createdAt:'2026-11-13T12:00:00.123456Z'});

test('payment history hides unresolved users and uses a fresh owner key on account changes',()=>{
 const h=harness();assert.equal(h.entry().key,'owner-a');h.setAuth({state:'signed-in',userId:'owner-b'});assert.equal(h.entry().key,'owner-b');
 for(const state of ['loading','unavailable','signed-out']){h.setAuth({state,userId:'owner-a'});assert.equal(h.entry().type,'p');assert.equal(h.entry().props.role,'status');}
});

test('history failures show a retry, not an empty list; canceled reads cannot repopulate the view',async()=>{
 const h=harness();h.render();h.requests[0].reject(new h.ClientError('UNKNOWN'));await flush();let tree=h.render();assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));assert.equal(text(tree).includes('Платежей пока нет'),false);
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Повторить загрузку').props.onClick();h.render();assert.equal(h.requests.length,2);
 h.stop();assert.equal(h.requests[1].options.signal.aborted,true);h.requests[1].resolve({items:[item()],nextCursor:null});await flush();assert.equal(h.state[0],null);
});

test('history appends one page after retry without duplicating rows and links only cabinet sections',async()=>{
 const h=harness();h.render();const cursor={id:'payment',createdAt:item().createdAt};h.requests[0].resolve({items:[item()],nextCursor:cursor});await flush();let tree=h.render();
 assert.ok(text(tree).includes('199,5'));assert.ok(text(tree).includes('TEST'));assert.ok(text(tree).includes('Оплачено'));
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Показать ещё').props.onClick();h.render();assert.equal(h.requests[1].cursor,cursor);h.requests[1].reject(new h.ClientError('UNKNOWN'));await flush();tree=h.render();assert.equal(h.state[0].items.length,1);
 nodes(tree).find(node=>node.type==='button'&&text(node)==='Повторить загрузку').props.onClick();h.render();h.requests[2].resolve({items:[item('second','ad_marquee')],nextCursor:null});await flush();tree=h.render();assert.equal(h.state[0].items.length,2);
 const links=nodes(tree).filter(node=>node.type==='link');assert.deepEqual(links.map(node=>node.props.href),['/cabinet/obyavleniya','/reklama/begushchaya-stroka?view=list']);assert.equal(nodes(tree).some(node=>node.type==='button'&&text(node)==='Оплатить'),false);h.stop();
});

test('an available TEST order links to its exact payment while other records keep their section',async()=>{
 const h=harness();h.setAuth({state:'signed-in',userId:'owner-a',workPublicationTest:true});h.render();
 h.requests[0].resolve({items:[
  {...item('original','workRequest'),status:'created'},{...item('live','workRequest'),status:'created',isTest:false},
  {...item('specialist','specialist'),status:'created'},item('completed','vacancy'),
 ],nextCursor:null});
 await flush();
 const links=nodes(h.render()).filter(node=>node.type==='link');
 assert.deepEqual(links.map(node=>[text(node),node.props.href]),[
  ['Продолжить','/oplata/original?type=workRequest'],['Перейти в раздел','/cabinet/zakazy'],
  ['Перейти в раздел','/cabinet/specialist'],['Перейти в раздел','/cabinet/vakansii'],
 ]);
 h.stop();
});
