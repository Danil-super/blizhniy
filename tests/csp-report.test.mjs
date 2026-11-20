import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {createCspReportHandler}=load('csp-report');
const origin='https://example.invalid';
const payload={'csp-report':{'effective-directive':'script-src-elem',disposition:'enforce','blocked-uri':'inline','document-uri':'https://private.invalid/secret?token=synthetic','original-policy':"script-src 'nonce-synthetic-private'",'script-sample':'synthetic private user text',referrer:'synthetic private referrer','source-file':'synthetic private source'}};
const request=(body=JSON.stringify(payload),headers={},method='POST')=>new Request(origin+'/api/csp-report',{method,headers:{host:'example.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/csp-report',...headers},...(method==='GET'?{}:{body,duplex:'half'})});
test('reports emit only closed categories, not URLs, nonce, sample or private fields; fixed-key sampling limits logs',async()=>{
 const events=[];let now=1000;const handle=createCspReportHandler({origin},event=>events.push(event),()=>now);
 for(let n=0;n<100;n++)assert.equal((await handle(request())).status,204);
 assert.deepEqual(events,[{event:'csp_violation',source:'untrusted-browser',directive:'script-src-elem',disposition:'enforce',blocked:'inline'}]);
 assert.ok(!JSON.stringify(events).includes('private'));now+=60000;assert.equal((await handle(request())).status,204);assert.equal(events.length,2);
});
test('wrong target/origin/type/method and oversized/malformed bodies are refused',async()=>{
 const events=[],handle=createCspReportHandler({origin},e=>events.push(e));
 for(const [req,status]of [[request(undefined,{origin:'https://evil.invalid'}),403],[request(undefined,{host:'evil.invalid'}),403],[request(undefined,{'sec-fetch-site':'cross-site'}),403],[request(undefined,{'content-type':'application/json'}),415],[request(undefined,{},'GET'),405],[request('x'.repeat(8193)),413],[request('{}'),400],[request('not-json'),400],[request(JSON.stringify({'csp-report':{'effective-directive':'evil\nlog',disposition:'enforce'}})),400]])assert.equal((await handle(req)).status,status);
 assert.deepEqual(events,[]);
 assert.equal((await handle(request(undefined,{origin:''}))).status,204,'same-origin fetch metadata can admit reports without Origin');
});
test('a slow or non-cooperative body is bounded even if cancellation never resolves',async()=>{
 const handle=createCspReportHandler({origin},()=>{},()=>1000,25);
 const stream=new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})});
 const start=performance.now();assert.equal((await handle(request(stream))).status,408);assert.ok(performance.now()-start<1000);
});
test('unknown input cannot create attacker-chosen log keys or output, and audit failure stays generic',async()=>{
 const handle=createCspReportHandler({origin},()=>{throw new Error('synthetic private log sink');});
 const response=await handle(request());assert.equal(response.status,503);assert.equal(await response.text(),'');assert.equal(response.headers.get('cache-control'),'no-store');
 const noOrigin=request(undefined,{origin:'','sec-fetch-site':''});assert.equal((await handle(noOrigin)).status,403);
});
test('invalid UTF-8 fails as client input, while report budgets stay separate and bounded',async()=>{
 let now=1000;const handle=createCspReportHandler({origin},()=>{},()=>now);
 assert.equal((await handle(request(new Uint8Array([255,254])))).status,400);
 for(let n=0;n<239;n++)assert.equal((await handle(request())).status,204);
 assert.equal((await handle(request())).status,429);now+=60000;assert.equal((await handle(request())).status,204);
});
test('at most four report bodies can be in flight and expired reads release capacity',async()=>{
 const handle=createCspReportHandler({origin},()=>{},()=>1000,25);
 const pending=Array.from({length:4},()=>handle(request(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})}))));
 assert.equal((await handle(request())).status,429);for(const result of await Promise.all(pending))assert.equal(result.status,408);
 assert.equal((await handle(request())).status,204);
});

test('Reporting API batches validate every report before logging and share sampling with legacy reports',async()=>{
 const events=[], handle=createCspReportHandler({origin},event=>events.push(event));
 const headers={'content-type':'application/reports+json; charset=utf-8'};
 const report={type:'csp-violation',url:origin+'/private',body:{effectiveDirective:'style-src-elem',disposition:'enforce',blockedURL:origin+'/private',sample:'private text'}};
 const other={...report,body:{effectiveDirective:'script-src-elem',disposition:'enforce',blockedURL:'inline'}};
 const send=(data,extra={})=>handle(request(JSON.stringify(data),{...headers,...extra}));
 for(const invalid of [[],[report,{...other,type:'unrelated'}],[report,{...other,body:null}],[report,{...other,body:{...other.body,disposition:'invalid'}}],payload]){
  assert.equal((await send(invalid)).status,400);
 }
 assert.equal((await send([report],{origin:'https://other.invalid'})).status,403);
 assert.equal((await send([report],{'content-length':'8193'})).status,413);
 assert.deepEqual(events,[]);
 // Chromium sends Origin on background deliveries without Sec-Fetch-Site.
 assert.equal((await send([report,report,other],{'sec-fetch-site':''})).status,204);
 assert.equal((await handle(request())).status,204);
 assert.deepEqual(events,[
  {event:'csp_violation',source:'untrusted-browser',directive:'style-src-elem',disposition:'enforce',blocked:'url'},
  {event:'csp_violation',source:'untrusted-browser',directive:'script-src-elem',disposition:'enforce',blocked:'inline'},
 ]);
 assert.equal((await send([report],{'content-type':'application/csp-report'})).status,400);
});
