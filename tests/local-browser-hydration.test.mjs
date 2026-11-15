import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {observeBrowserHydration} from '../scripts/local-browser-hydration.mjs';

async function fixture(){
 const handlers=new Map(),context={on:(name,handler)=>handlers.set(name,handler),addInitScript:async(fn,arg)=>{context.init={fn,arg};}};
 const records=await observeBrowserHydration(context),messages=[],events=new Map(),location={pathname:'/original-document'};
 const sandbox={window:{addEventListener:(name,handler)=>events.set(name,handler)},location,performance:{timeOrigin:1000,now:()=>25},console:{debug:text=>messages.push(text)}};
 vm.runInNewContext(`(${context.init.fn.toString()})(${JSON.stringify(context.init.arg)})`,sandbox);
 const deliver=text=>handlers.get('console')({text:()=>text});
 return{records,messages,events,location,deliver};
}
test('hydration evidence retains the originating document after the tab navigates',async()=>{
 const f=await fixture();f.events.get('error')({message:'Uncaught Error: Minified React error #418; synthetic',preventDefault:()=>assert.fail('Must not suppress the error')});
 assert.equal(f.messages.length,1);f.location.pathname='/next-document';f.deliver(f.messages[0]);
 assert.deepEqual(f.records,[{documentPath:'/original-document',timeOrigin:1000,elapsedMs:25}]);
});
test('unrelated errors and console output do not enter hydration evidence',async()=>{
 const f=await fixture();f.events.get('error')({message:'Unrelated synthetic private content'});f.deliver('ordinary console output');
 assert.deepEqual(f.messages,[]);assert.deepEqual(f.records,[]);
});
test('malformed diagnostic output fails visibly without retaining its raw contents',async()=>{
 const f=await fixture();f.events.get('error')({message:'Minified React error #418; synthetic'});
 const marker=f.messages[0].slice(0,f.messages[0].indexOf('{'));f.deliver(marker+'not-json-private-content');
 f.deliver(marker+JSON.stringify({documentPath:'/private?token=synthetic',timeOrigin:1000,elapsedMs:25}));
 assert.deepEqual(f.records,[{invalidDiagnostic:true},{invalidDiagnostic:true}]);
});
test('a broken page cannot grow the private diagnostic artifact without bound',async()=>{
 const f=await fixture();f.events.get('error')({message:'Minified React error #418; synthetic'});
 for(let n=0;n<150;n++)f.deliver(f.messages[0]);
 assert.equal(f.records.length,101);assert.deepEqual(f.records.at(-1),{truncated:true});
});
