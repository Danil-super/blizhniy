import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {PassThrough} from 'node:stream';
import {gzipSync,gunzipSync} from 'node:zlib';
import {once} from 'node:events';
import test from 'node:test';
const ts=createRequire(import.meta.url)('typescript');
const source=readFileSync(new URL('../scripts/local-primary-proxy.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('proxy.mjs',source,ts.ScriptTarget.Latest,true);let call;
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='httpRequest')call=node;ts.forEachChild(node,visit);}
visit(ast);assert.ok(call,'Exercise the actual upstream forwarding call, not a duplicate proxy implementation');
const forward=new Function('httpRequest','headers','req','res','canonical','state','proof','localPrimaryUpstreamPort',`return ${call.getText(ast)}`);

for(const encoding of ['gzip, deflate, br','identity',null])test(`local forwarding preserves encoding negotiation and wire bytes: ${encoding??'absent'}`,async()=>{
 const canonical='https://example.invalid',state={origin:'https://127.0.0.1:3045'},proof={cookie:'__Host-proof=synthetic; Secure; HttpOnly'};
 for(const path of ['/_next/static/css/styles.css','/api/account/session']){
  const headers=new Headers({'host':'example.invalid','x-real-ip':'127.0.0.1'});if(encoding!==null)headers.set('accept-encoding',encoding);
  const plain=Buffer.from(path.endsWith('.css')?'body{color:#123456}'.repeat(100):JSON.stringify({synthetic:true,value:'x'.repeat(2000)}));
  const compressed=encoding?.includes('gzip')===true,wire=compressed?gzipSync(plain):plain;
  const incoming=new PassThrough();incoming.statusCode=200;incoming.headers={'content-type':path.endsWith('.css')?'text/css':'application/json',vary:'Accept-Encoding','content-length':String(wire.length),'cache-control':'no-store','set-cookie':['__Host-session=synthetic; Secure; HttpOnly'],...(compressed?{'content-encoding':'gzip'}:{})};
  const res=new PassThrough(),chunks=[];let status,responseHeaders,captured;
  res.writeHead=(code,value)=>{status=code;responseHeaders=value;};res.on('data',chunk=>chunks.push(chunk));const ended=once(res,'end');
  forward((options,onResponse)=>{captured=options;onResponse(incoming);return {};},headers,{url:path,method:path.endsWith('.css')?'GET':'POST'},res,canonical,state,proof,3046);
  assert.equal(captured.hostname,'127.0.0.1');assert.equal(captured.port,3046);assert.equal(captured.path,path);assert.equal(captured.headers['accept-encoding'],encoding??undefined);
  assert.equal(captured.headers['x-real-ip'],'127.0.0.1');assert.equal(captured.headers.host,'example.invalid');
  incoming.end(wire);await ended;const received=Buffer.concat(chunks);
  assert.equal(status,200);assert.equal(responseHeaders.vary,'Accept-Encoding');assert.equal(responseHeaders['content-encoding'],compressed?'gzip':undefined);assert.equal(Number(responseHeaders['content-length']),received.length);assert.deepEqual(received,wire);assert.deepEqual(compressed?gunzipSync(received):received,plain);
  assert.equal(responseHeaders['cache-control'],'no-store');assert.deepEqual(responseHeaders['set-cookie'],['__Host-session=synthetic; Secure; HttpOnly','__Host-proof=synthetic; Secure; HttpOnly']);
 }
});
