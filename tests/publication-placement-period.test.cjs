const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const test=require('node:test');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const ts=require('typescript');
const {loadLocalPrimaryModule}=require('../scripts/local-primary-modules.cjs');
function render(props){
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../src/components/PublicationPlacementPeriod.tsx','file://'+__filename),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 new Function('require','exports',code)(name=>name==='@/lib/publication-time'?loadLocalPrimaryModule('publication-time'):require(name),exports);
 return renderToStaticMarkup(React.createElement(exports.PublicationPlacementPeriod,props));
}
const period={publishedAt:'2026-10-01T09:30:00.123456Z',expiresAt:'2026-10-31T09:30:00.123456Z',status:'published'};
test('placement period omits an unstarted draft instead of inventing dates',()=>{
 assert.equal(render({publishedAt:null,expiresAt:null,status:'draft'}),'');
 assert.equal(render({...period,publishedAt:null}),'');
 assert.equal(render({...period,expiresAt:null}),'');
});
test('placement period renders both original server dates in semantic time elements',()=>{
 const html=render(period);
 assert.match(html,/aria-label="Срок размещения"/);
 assert.match(html,/Начало размещения/);assert.match(html,/Окончание размещения/);
 assert.ok(html.includes('dateTime="'+period.publishedAt+'"'));
 assert.ok(html.includes('dateTime="'+period.expiresAt+'"'));
 assert.doesNotMatch(html,/Срок размещения истёк/);
});
test('expiry message uses the server-projected status and never offers automatic payment or extension',()=>{
 const html=render({...period,status:'expired',expiresAt:'2099-12-31T09:30:00.000001Z'});
 assert.match(html,/Срок размещения истёк/);
 assert.match(html,/Редактирование не продлевает размещение/);
 assert.doesNotMatch(html,/<button|Оплатить|автоматически продле/);
});
