const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),{loadLocalPrimaryModule}=require('../scripts/local-primary-modules.cjs');
const out={};
new Function('exports','require',ts.transpileModule(fs.readFileSync('src/components/PublicationDates.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(out,name=>name==='@/lib/publication-time'?loadLocalPrimaryModule('publication-time'):require(name));
test('published and edited dates have explicit labels and semantic timestamps in Moscow time',()=>{
 const html=renderToStaticMarkup(React.createElement(out.PublicationDates,{publishedAt:'2026-10-21T10:00:00Z',updatedAt:'2026-10-23T12:00:00Z'}));
 assert.match(html,/Размещено/);assert.match(html,/Обновлено/);assert.match(html,/dateTime="2026-10-21T10:00:00Z"/i);assert.match(html,/dateTime="2026-10-23T12:00:00Z"/i);assert.match(html,/15:00/);
});
test('unedited publication does not show a fabricated update date',()=>{
 const html=renderToStaticMarkup(React.createElement(out.PublicationDates,{publishedAt:'2026-10-21T10:00:00Z'}));
 assert.match(html,/Размещено/);assert.doesNotMatch(html,/Обновлено/);
});
test('date terms and descriptions are direct children of a definition-list group',()=>{
 const html=renderToStaticMarkup(React.createElement(out.PublicationDates,{publishedAt:'2026-10-21T10:00:00Z',updatedAt:'2026-10-23T12:00:00Z'}));
 const parents=[];
 for(const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)){
  const [,closing,tag]=match;if(closing){assert.equal(parents.pop(),tag);continue;}
  if(tag==='dt'||tag==='dd')assert.ok(parents.at(-1)==='dl'||parents.at(-1)==='div'&&parents.at(-2)==='dl','dt/dd must not be buried below an extra wrapper inside their dl group');
  if(!match[0].endsWith('/>'))parents.push(tag);
 }
});
