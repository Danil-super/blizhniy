// Characterize Next 15's bundled renderer without patching packages or contacting a server.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url);
const modules=['scheduler','react','react-dom','react-dom-client'];
const paths=['scheduler/cjs/scheduler.production.js','react/cjs/react.production.js','react-dom/cjs/react-dom.production.js','react-dom/cjs/react-dom-client.production.js'];
const sources=await Promise.all(paths.map(path=>readFile(require.resolve('next/dist/compiled/'+path),'utf8')));
const browser=await chromium.launch(),results=[];
try{
 for(const keyed of [false,true])for(let iteration=0;iteration<8;iteration++){
  const page=await browser.newPage();
  try{
   await page.route('**/*',route=>route.abort());
   await page.setContent('<div id="root"><div id="outer"><p id="before">before</p><div id="target"><section id="child">lazy child</section></div><p id="after">after</p></div></div>');
   await page.evaluate(()=>{window.syntheticModules={};window.syntheticErrors=[];window.serverChild=document.getElementById('child');});
   for(let index=0;index<sources.length;index++)await page.addScriptTag({content:`(function(exports,require){${sources[index]}\n})(window.syntheticModules[${JSON.stringify('next/dist/compiled/'+modules[index])}]={},name=>{if(!(name in window.syntheticModules))throw Error('Unexpected module');return window.syntheticModules[name];});`});
   await page.evaluate(keyed=>{
    const React=window.syntheticModules['next/dist/compiled/react'],client=window.syntheticModules['next/dist/compiled/react-dom-client'],h=React.createElement;
    const chunk={status:'pending',value:null,listeners:[],then(resolve){if(this.status==='fulfilled')resolve(this.value);else this.listeners.push(resolve);}};
    const lazy=React.lazy(()=>{
     queueMicrotask(()=>{chunk.status='fulfilled';chunk.value={default:h('section',{id:'child'},'lazy child')};chunk.listeners.forEach(listener=>listener(chunk.value));});
     return chunk;
    });
    function Ready(){React.useEffect(()=>{window.syntheticHydrated=true;},[]);return null;}
    const App=()=>h('div',{id:'outer'},h('p',{id:'before'},'before'),h('div',{id:'target'},keyed?h(React.Fragment,{key:'route-content'},lazy):lazy),h('p',{id:'after'},'after'),h(Ready));
    React.startTransition(()=>client.hydrateRoot(document.getElementById('root'),h(App),{onRecoverableError:error=>window.syntheticErrors.push(error.message.includes('React error #418'))}));
   },keyed);
   await page.waitForFunction(()=>window.syntheticHydrated===true);
   results.push({keyed,...await page.evaluate(()=>({errors:window.syntheticErrors,preserved:document.getElementById('child')===window.serverChild}))});
  }finally{await page.close();}
 }
 // shortcut: Next 15's replay bug needs the keyed boundary; review/remove it when the renderer upgrade fails this characterization.
 assert.ok(results.filter(row=>!row.keyed).every(row=>row.errors.includes(true)&&!row.preserved));
 assert.ok(results.filter(row=>row.keyed).every(row=>row.errors.length===0&&row.preserved));
 console.log(JSON.stringify({status:'passed',baselineMismatches:8,keyedFragmentPreserved:8,externalRequests:0}));
}finally{await browser.close();}
