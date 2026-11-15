// Read-only candidate comparison on the physically verified owned loopback fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer,request,Agent} from 'node:http';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.argv.length,2);
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const require=createRequire(import.meta.url),ts=require('typescript'),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
Object.assign(process.env,{BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin});
const database=new(load('postgres').PostgresDatabase)(new pg.Pool({...localPrimaryDatabaseConfig(state),max:5,statement_timeout:5000,query_timeout:5000}));
let active=0,peak=0,sqlActive=0,sqlPeak=0,enteredSearches,server;
const db={readTransaction:(work,options)=>{active++;peak=Math.max(peak,active);let entered=false;return database.readTransaction(tx=>{entered=true;sqlActive++;sqlPeak=Math.max(sqlPeak,sqlActive);if(sqlActive===2)enteredSearches?.();return work(tx);},{...options,onComplete:()=>{if(entered)sqlActive--;active--;options.onComplete?.();}});}};
const config=()=>({origin:'https://xn----9sbphbgks4a4a.xn--p1ai'});
const dependencies={
 'server-only':{},'./production-auth-config':{readProductionAuthConfig:config},'./production-auth-runtime':{getProductionAccountDatabase:async()=>({db})},
 './listing-workflow-config':load('listing-workflow-config'),'./postgres-public-search':load('postgres-public-search'),'./public-search-contract':load('public-search-contract'),
};
const compile=source=>{const out={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(Object.hasOwn(dependencies,name));return dependencies[name];},out);return out.searchPrimaryPublications;};
const p95=rows=>[...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*.95)-1];
const agent=new Agent({keepAlive:true,maxSockets:64,maxFreeSockets:64});
let search;
const reports=[];
try{
 await load('production-auth-database').verifyProductionAuthDatabase(database);
 server=createServer(async(req,res)=>{
  if(req.method!=='GET'||req.url!=='/'||req.socket.remoteAddress!=='127.0.0.1'){res.writeHead(404);res.end();return;}
  try{const result=await search({query:'ремонт',page:1});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}
  catch{res.writeHead(503);res.end('Search temporarily unavailable');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const get=()=>new Promise(resolve=>{
  const start=performance.now(),req=request({hostname:'127.0.0.1',port,path:'/',agent,signal:AbortSignal.timeout(6000)},res=>{
   let size=0;const chunks=[];res.on('data',part=>{size+=part.length;if(size>1048576)req.destroy();else chunks.push(part);});res.on('error',()=>resolve({status:0,ms:performance.now()-start}));
   res.on('end',()=>{let valid=res.complete;if(res.statusCode===200){try{const body=JSON.parse(Buffer.concat(chunks).toString());valid&&=Array.isArray(body.items)&&body.items.length<=24&&typeof body.hasMore==='boolean';}catch{valid=false;}}resolve({status:valid?res.statusCode:0,ms:performance.now()-start});});
  });req.on('error',()=>resolve({status:0,ms:performance.now()-start}));req.end();
 });
 for(const [name,file]of[['before','../docs/review/search-queue-runtime.before'],['candidate','../src/lib/production-search-runtime.ts']]){
  search=compile(await readFile(new URL(file,import.meta.url),'utf8'));assert.equal((await get()).status,200);
  for(let run=0;run<3;run++){
   peak=0;sqlPeak=0;const probes=[];let overlaps=0,timer;
   const entered=new Promise((resolve,reject)=>{enteredSearches=resolve;timer=setTimeout(()=>reject(Error('No simultaneous physical search scopes')),2000);});
   const traffic=Array.from({length:25},()=>get());
   try{await entered;}finally{clearTimeout(timer);enteredSearches=undefined;}
   for(let index=0;index<10;index++){const before=sqlActive,start=performance.now();assert.equal((await database.query('select 1 as value')).rows[0].value,1);probes.push(performance.now()-start);if(before>0&&sqlActive>0)overlaps++;}
   assert.ok(overlaps>0,'pool probes must overlap live search SQL scopes');
   const rows=await Promise.all(traffic),report={name,run:run+1,requests:rows.length,success:rows.filter(row=>row.status===200).length,failed:rows.filter(row=>row.status!==200).length,p95Ms:p95(rows.map(row=>row.ms)),maxPhysicalReaders:peak,maxSqlScopes:sqlPeak,overlapProbes:overlaps,poolProbeP95Ms:p95(probes)};
   assert.equal(active,0);assert.equal(sqlActive,0);assert.ok(peak<=2);assert.ok(sqlPeak<=2);if(name==='candidate'){assert.equal(report.success,25);assert.ok(report.p95Ms<=800);}else assert.ok(report.failed>0);
   reports.push(report);
  }
 }
 const report={scope:'Owned PG58 runtime role, real SQL/store and same max5 pool; standalone loopback HTTP + Node client, no Next render, no browser, no auth login, no mutations, no provider calls or production. Pool probes are SELECT1, not an auth SLA.',reports};
 const file=join(stateDirectory,'search-queue-candidate-'+randomUUID()+'.json');await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,file}));
}finally{agent.destroy();if(server)await new Promise(resolve=>server.close(resolve));await database.close();}
