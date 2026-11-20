import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeDocumentPrefetchHeaders} from '../scripts/next-prefetch-ingress.mjs';
test('ingress removes partial-tree hints from document requests and preserves all unrelated headers',()=>{
 const input=Object.freeze({'next-router-prefetch':'1','next-router-segment-prefetch':'/_tree',purpose:'prefetch',cookie:'synthetic',authorization:'synthetic',origin:'https://synthetic.invalid','x-real-ip':'192.0.2.1'});
 const result=normalizeDocumentPrefetchHeaders(input);
 assert.equal(result['next-router-prefetch'],undefined);assert.equal(result['next-router-segment-prefetch'],undefined);
 for(const key of ['purpose','cookie','authorization','origin','x-real-ip'])assert.equal(result[key],input[key]);
 assert.equal(input['next-router-prefetch'],'1');
});
test('ingress preserves actual Flight headers without coercing malformed RSC values',()=>{
 const input={rsc:'1','next-router-prefetch':'1','next-router-segment-prefetch':'/_tree','next-router-state-tree':'synthetic'};
 assert.deepEqual(normalizeDocumentPrefetchHeaders(input),input);
 for(const rsc of [undefined,'0','1, 1',['1']])assert.equal(normalizeDocumentPrefetchHeaders({...input,rsc})['next-router-prefetch'],undefined);
});
test('Caddy template normalizes the same hints before the trusted reverse proxy',()=>{
 const file=readFileSync(new URL('../deploy/Caddyfile.example',import.meta.url),'utf8');
 assert.match(file,/@document_not_rsc\s*\{\s*not header RSC 1\s*\}/);
 for(const header of ['Next-Router-Prefetch','Next-Router-Segment-Prefetch'])assert.ok(file.includes('request_header @document_not_rsc -'+header));
 assert.ok(file.indexOf('request_header @document_not_rsc')<file.indexOf('reverse_proxy'));
 assert.ok(file.includes('header_up X-Real-IP {remote_host}'));
});

test('missing category documents use the same backend as the original lookup',()=>{
 const file=readFileSync(new URL('../deploy/Caddyfile.example',import.meta.url),'utf8');
 assert.match(file,/@missing_html\s*\{\s*status 404\s*header Content-Type text\/html\*/);
 assert.match(file,/@category_document\s*\{\s*method GET HEAD\s*path \/katalog\/\*\s*not header RSC 1/);
 assert.match(file,/reverse_proxy @category_document \{http\.reverse_proxy\.upstream\.address\}\s*\{\s*rewrite \/_not-found\?\s*import origin_headers\s*\}\s*copy_response/);
});
