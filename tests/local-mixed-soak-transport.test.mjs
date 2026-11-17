import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Agent,createServer,request} from 'node:http';
// Execute the runner's actual transport without loading its owned-state/bootstrap side effects.
const source=await readFile(new URL('../scripts/check-local-mixed-soak.mjs',import.meta.url),'utf8');
const transport=source.slice(source.indexOf('function http('),source.indexOf('const summary='));
const factory=new Function('request','state','agent','privateAgent','controller','assert','samples','started',transport+';return {http,api};');
async function fixture(run){
 let held,requests=0;const entered=new Promise(resolve=>{held=resolve;});
 const server=createServer((req,res)=>{requests++;req.resume();if(req.url==='/held'){held();return;}if(req.url==='/closed'){res.destroy();return;}res.setHeader('content-type','application/json');res.end(req.url==='/invalid'?'{':'{"ok":true}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const agent=new Agent({keepAlive:true}),controller=new AbortController(),samples=[];
 try{const api=factory(request,{origin:'http://127.0.0.1:'+server.address().port},agent,agent,controller,assert,samples,1);await run({...api,controller,samples,entered,requests:()=>requests});}
 finally{controller.abort();agent.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('soak counts private connection and JSON failures with their measured duration',async()=>fixture(async f=>{
 const actor={cookies:new Map()};
 for(const path of ['/closed','/invalid']){const started=performance.now();await assert.rejects(f.api(actor,path));const row=f.samples.at(-1);assert.equal(row.status,0);assert.equal(row.valid,false);assert.equal(row.path,path);assert.ok(row.ms>=0&&row.ms<=performance.now()-started+1);}
 assert.equal(f.samples.length,2);
}));
test('soak abort cancels an active request and prevents a later dispatch while permitting cleanup',async()=>fixture(async f=>{
 const pending=f.http('/held');await f.entered;f.controller.abort();let timer;
 try{const result=await Promise.race([pending,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Abort was not delivered before the request timeout')),1000);})]);assert.equal(result.status,0);}
 finally{clearTimeout(timer);}
 const before=f.requests();assert.equal((await f.http('/ok')).status,0);assert.equal(f.requests(),before);
 const reply=await f.api({cookies:new Map()},'/ok',{},'POST',200,'cleanup');assert.equal(reply.ok,true);assert.equal(f.requests(),before+1);
}));
