import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {probeWebSlot} from '../scripts/handoff-probe.mjs';
import {boundedHandoffRequest} from '../scripts/handoff-http.mjs';

const buildId = 'synthetic-build';
const paths = ['/api/health','/api/ready','/',`/_next/static/${buildId}/_buildManifest.js`];
const htmlForBuild = value => '<html><head><meta name="blizhniy-auth-backend" content="postgres"></head><body>' +
  '<script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push(' +
  JSON.stringify([1,`0:${JSON.stringify({P:null,b:value,p:'',c:['',''],i:false,f:[],s:false,S:true})}\n`]) + ')</script></body></html>';
const good = [
  ['application/json','{"ok":true}'],
  ['application/json','{"ok":true,"service":"blizhniy"}'],
  ['text/html; charset=utf-8',htmlForBuild(buildId)],
  ['application/javascript','self.__BUILD_MANIFEST={};'],
];
async function fixture(t,handler) {
  const requests = [],timers = new Set();
  const later = (fn,ms) => {const timer = setTimeout(() => {timers.delete(timer);fn();},ms);timers.add(timer);};
  const server = createServer((req,res) => {
    requests.push({method:req.method,path:req.url});handler(req,res,later);
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(() => new Promise(resolve => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();server.close(resolve);
  }));
  const port = server.address().port;
  return {requests,slot:{slot:'green',port,buildId},options:{hostname:'127.0.0.1',port,path:'/'}};
}
function send(req,res,replace = {}) {
  const index = paths.indexOf(req.url),[type,body] = good[index] ?? ['text/plain','unavailable'];
  res.writeHead(replace.status ?? 200,{'content-type':replace.type ?? type,...replace.headers});
  res.end(replace.body ?? body);
}
const proof = ready => ({ready,buildId});

test('probe requires all four real HTTP stages, using GET once without mutation',async t => {
  const f = await fixture(t,send);
  assert.deepEqual(await probeWebSlot(f.slot),proof(true));
  assert.deepEqual(f.requests,paths.map(path => ({method:'GET',path})));
});
test('probe accepts equivalent HTML serialization and reads split Flight data in document order', async t => {
  const payload = '0:' + JSON.stringify({b:buildId}) + '\n';
  const script = text => '<SCRIPT type="text/javascript">self.__next_f.push(' + JSON.stringify([1,text]) + ')</SCRIPT>';
  const body = '<!doctype html><html><head><META content="postgres" name="blizhniy-auth-backend"></head>' +
    '<body><section>' + script(payload.slice(0,5)) + '</section>' + script(payload.slice(5)) + '</body></html>';
  const f = await fixture(t, (req,res) => send(req,res,req.url === '/' ? {body, type:'Text/HTML; charset=UTF-8'} : {}));
  assert.deepEqual(await probeWebSlot(f.slot),proof(true));
});

test('probe requires one backend marker in the document head', async t => {
  const marker = '<meta name="blizhniy-auth-backend" content="postgres">';
  const body = htmlForBuild(buildId).replace(marker, marker + marker);
  const f = await fixture(t,(req,res) => send(req,res,req.url === '/' ? {body} : {}));
  assert.deepEqual(await probeWebSlot(f.slot), proof(false));
});

test('probe rejects another HTML build even when the expected retained manifest exists',async t => {
  const f = await fixture(t,(req,res) => send(req,res,req.url === '/' ? {body:htmlForBuild('other-build')} : {}));
  assert.deepEqual(await probeWebSlot(f.slot),proof(false));
});
test('probe refuses HTML without a usable Next Flight build identity',async t => {
  for (const body of [htmlForBuild(undefined),htmlForBuild(buildId).replace('0:{','0:broken{')]) {
    const f = await fixture(t,(req,res) => send(req,res,req.url === '/' ? {body} : {}));
    assert.deepEqual(await probeWebSlot(f.slot),proof(false));
  }
});
test('probe rejects invalid health, readiness, postgres HTML and build assets',async t => {
  const failures = [
    [0,{body:'{"ok":false}'}],[0,{body:'{"ok":"true"}'}],[0,{body:'null'}],[0,{body:'{' }],
    [1,{body:'{"ok":false,"service":"blizhniy"}'}],[1,{body:'{"ok":1,"service":"blizhniy"}'}],
    [1,{body:'{"ok":true,"service":"other"}'}],[1,{body:'not-json'}],
    [2,{type:'application/json'}],[2,{body:'<meta name="blizhniy-auth-backend" content="supabase">'}],
    [3,{type:'text/html'}],[3,{body:'self.OTHER_MANIFEST={};'}],
  ];
  for (const [stage,replace] of failures) {
    const f = await fixture(t,(req,res) => send(req,res,req.url === paths[stage] ? replace : {}));
    assert.deepEqual(await probeWebSlot(f.slot),proof(false));
    assert.equal(f.requests.length,stage + 1);
    assert.ok(f.requests.every(request => request.method === 'GET'));
  }
});
test('probe rejects every non-200 stage without redirects, retries or exposing response details',async t => {
  for (const stage of [0,1,2,3]) for (const status of [201,302,503]) {
    const f = await fixture(t,(req,res) => send(req,res,req.url === paths[stage] ? {
      status,headers:{location:'/private-fixture','set-cookie':'fixture=value'},body:'synthetic-private-marker',
    } : {}));
    assert.deepEqual(await probeWebSlot(f.slot),proof(false));
    assert.deepEqual(f.requests,paths.slice(0,stage + 1).map(path => ({method:'GET',path})));
  }
});
test('one deadline covers the complete probe instead of renewing at each stage',async t => {
  const f = await fixture(t,(req,res,later) => later(() => send(req,res),65));
  assert.deepEqual(await probeWebSlot(f.slot,{deadlineMs:110}),proof(false));
  assert.equal(f.requests.length,2);
});
test('hanging, oversized and incomplete responses fail with bounded generic results',async t => {
  for (const mode of ['hanging','oversized','incomplete']) {
    const f = await fixture(t,(_req,res,later) => {
      if (mode === 'hanging') return;
      if (mode === 'oversized') return res.end('x'.repeat(2048));
      res.writeHead(200,{'content-length':'200'});res.write('synthetic-private-marker');
      later(() => res.destroy(),10);
    });
    assert.deepEqual(await probeWebSlot(f.slot,{deadlineMs:100}),proof(false));
    assert.equal(f.requests.length,1);
    await assert.rejects(() => boundedHandoffRequest(f.options,{deadlineMs:40,maxBytes:1024}),
      error => error.message === 'Handoff transport unavailable');
    assert.equal(f.requests.length,2);
  }
});
test('bounded transport rejects unsafe hosts, ports, protocols and paths before I/O',async t => {
  const f = await fixture(t,(_req,res) => res.end('ok'));
  for (const replace of [
    {hostname:'localhost'},{hostname:'192.0.2.1'},{port:80},{port:65536},{port:'3000'},
    {protocol:'https:'},{path:'http://example.invalid/'},{path:'//example.invalid/'},
    {path:'/bad\r\npath'},{path:'/bad\\path'},{method:'DELETE'},
  ]) {
    await assert.rejects(async () => boundedHandoffRequest({...f.options,...replace},{deadlineMs:40}),
      error => /^Invalid handoff (request|transport)$/.test(error.message));
  }
  assert.equal(f.requests.length,0);
});
test('bounded transport preserves each method and never retries or follows a redirect',async t => {
  const f = await fixture(t,(_req,res) => {
    res.writeHead(302,{location:'/elsewhere'});res.end();
  });
  for (const method of ['GET','PATCH','POST']) {
    const result = await boundedHandoffRequest({...f.options,method},{deadlineMs:100});
    assert.equal(result.status,302);
  }
  assert.deepEqual(f.requests,['GET','PATCH','POST'].map(method => ({method,path:'/'})));
});
