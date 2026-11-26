import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {createHtmlCsp,htmlCspMode,createCspNonce}=load('html-csp');
function assertLegacyPermissions(nonce, options, httpOrigin, socketOrigin) {
 const tokens = policy => policy.split(';').map(part => part.trim().split(/\s+/));
 const expected = tokens(createHtmlCsp(nonce, {...options, legacyOrigin: undefined}));
 for (const directive of expected) {
  assert.ok(!directive.includes(httpOrigin) && !directive.includes(socketOrigin));
  if (directive[0] === 'img-src') directive.push(httpOrigin);
  if (directive[0] === 'connect-src') directive.push(httpOrigin, socketOrigin);
 }
 for (const name of ['img-src', 'connect-src']) assert.equal(expected.filter(([directive]) => directive === name).length, 1);
 const normalized = entries => entries.map(([name, ...sources]) => [name, ...sources.sort()]);
 const actual = tokens(createHtmlCsp(nonce, options));
 assert.deepEqual(normalized(actual), normalized(expected));
}
test('CSP uses fresh 192-bit nonces and refuses malformed nonce/mode',()=>{
 const values=new Set(Array.from({length:100},()=>createCspNonce()));assert.equal(values.size,100);for(const v of values)assert.match(v,/^[A-Za-z0-9+/]{32}$/);
 assert.equal(htmlCspMode({}),'report-only');assert.equal(htmlCspMode({BLIZHNIY_CSP_MODE:'enforce'}),'enforce');
 for(const bad of ['off','',"enforce; default-src *",'reportonly'])assert.throws(()=>htmlCspMode({BLIZHNIY_CSP_MODE:bad}));
 for(const bad of ['',"a'.repeat(32)",'x'.repeat(31),'x'.repeat(33)])assert.throws(()=>createHtmlCsp(bad,{}));
});
test('production scripts need a nonce, forbid attributes and eval, and use explicit resource categories',()=>{
 const nonce=createCspNonce(),value=createHtmlCsp(nonce,{mapEnabled:true}),script=value.split(';').find(part=>part.trim().startsWith('script-src '));
 assert.ok(!value.includes('report-uri'));
 assert.ok(script.includes(`'nonce-${nonce}'`));assert.ok(script.includes("'strict-dynamic'"));assert.ok(!script.includes('unsafe-inline'));assert.ok(!script.includes('unsafe-eval'));
 for(const directive of ["script-src-attr 'none'","object-src 'none'","base-uri 'none'","frame-ancestors 'self'",'report-to csp',"worker-src 'self' blob:"])assert.ok(value.includes(directive));
 assert.ok(value.includes("style-src 'self' 'unsafe-inline'"));assert.ok(!value.split(/[;\s]+/).includes('https:'));assert.doesNotMatch(value,/https:\/\/oauth\.telegram\.org|yookassa/);
 assert.ok(createHtmlCsp(nonce,{development:true}).includes("'unsafe-eval'"));
});
test('only a valid operator-selected legacy origin adds exact https/wss resources',()=>{
 const nonce=createCspNonce();
 assertLegacyPermissions(nonce,{legacyOrigin:'https://synthetic.supabase.co'},'https://synthetic.supabase.co','wss://synthetic.supabase.co');
 for(const bad of ['https://good.invalid/path','https://good.invalid?x=a','https://user:pass@good.invalid','http://good.invalid',"https://good.invalid';script-src *"]){assert.throws(()=>createHtmlCsp(nonce,{legacyOrigin:bad}));}
});
test('valid legacy trailing slash is normalized; only development admits an HTTP loopback backend',()=>{
 const nonce=createCspNonce();
 assertLegacyPermissions(nonce,{legacyOrigin:'https://legacy.example.invalid/'},'https://legacy.example.invalid','wss://legacy.example.invalid');
 for(const host of ['127.0.0.1','localhost','[::1]']){
  const origin=`http://${host}:54321`;
  assertLegacyPermissions(nonce,{development:true,legacyOrigin:origin},origin,`ws://${host}:54321`);
  assert.throws(()=>createHtmlCsp(nonce,{legacyOrigin:origin}));
 }
 assert.throws(()=>createHtmlCsp(nonce,{development:true,legacyOrigin:'http://external.example.invalid'}));
});

test('documents use only same-origin styles unless development or the map SDK needs inline styles',()=>{
 const nonce=createCspNonce();
 for(const options of [{},{mapEnabled:false},{legacyOrigin:'https://legacy.example.invalid'},{development:true},{mapEnabled:true}]){
  const policy=createHtmlCsp(nonce,options).split('; ');
  const styles=policy.filter(directive=>directive.startsWith('style-src'));
  assert.deepEqual(styles,[options.development||options.mapEnabled?"style-src 'self' 'unsafe-inline'":"style-src 'self'"]);
 }
});

test('Metrica adds only its exact HTTPS origin to script, image and connection permissions',()=>{
 const nonce=createCspNonce(),origin='https://mc.yandex.ru';
 const tokens=policy=>policy.split(';').map(part=>part.trim().split(/\s+/));
 for(const options of [{},{mapEnabled:true},{legacyOrigin:'https://legacy.example.invalid'},{development:true}]){
  const baseline=tokens(createHtmlCsp(nonce,options));
  assert.deepEqual(tokens(createHtmlCsp(nonce,{...options,metricaEnabled:false})),baseline);
  const expected=baseline.map(([name,...sources])=>[name,...sources,...(['script-src','img-src','connect-src'].includes(name)?[origin]:[])]);
  const actual=tokens(createHtmlCsp(nonce,{...options,metricaEnabled:true}));
  const normalize=entries=>entries.map(([name,...sources])=>[name,...sources.sort()]);
  assert.deepEqual(normalize(actual),normalize(expected));
  assert.equal(actual.filter(([, ...sources])=>sources.includes(origin)).length,3);
  assert.ok(baseline.every(([, ...sources])=>!sources.includes(origin)));
 }
});
