import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts=createRequire(import.meta.url)('typescript');
function route(){
 const source=readFileSync(new URL('../src/app/api/[[...path]]/route.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,Response});return module.exports;
}
test('unknown API methods return only a non-cacheable JSON 404 with a restrictive document policy',async()=>{
 const handlers=route();
 for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS']){
  const response=handlers[method]();assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:{code:'NOT_FOUND'}});
  assert.match(response.headers.get('content-type'),/^application\/json\b/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.has('set-cookie'),false);
 }
});
test('unknown API HEAD has the same status and headers as GET with no body',async()=>{
 const handlers=route(),get=handlers.GET(),head=handlers.HEAD();
 assert.equal(head.status,404);assert.deepEqual([...head.headers],[...get.headers]);
 assert.equal(head.body,null);assert.equal(await head.text(),'');
});
