const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');
const {renderToStaticMarkup}=require('react-dom/server');
const ts=require('typescript');
function load(name,messages){
 const exports={};
 const code=ts.transpileModule(readFileSync(resolve(__dirname,'../src/components',name+'.tsx'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 new Function('require','exports',code)(dependency=>{
  if(dependency==='@/lib/ad-marquee-store')return {
   getActiveAdMarqueeMessages:async format=>messages.map(value=>typeof value==='string'?value:format(value)),
  };
  if(dependency==='@/lib/publication-time')return require('../src/lib/publication-time.ts');
  if(dependency==='./AdMarquee')return load('AdMarquee',messages);
  if(dependency==='./PublicPublicationTerms')return load('PublicPublicationTerms',messages);
  if(dependency==='@/lib/publication-consent-terms')return require('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule('publication-consent-terms');
  return require(dependency);
 },exports);return exports;
}
async function markup(messages){return renderToStaticMarkup(await load('HomeHero',messages).HomeHero());}
test('marquee exposes a keyboard-operable pause control with an explicit controlled region',async()=>{
 const html=await markup(['Объявления рядом','Вакансии рядом']);
 assert.match(html,/<button[^>]*type="button"/);
 assert.match(html,/aria-label="Приостановить рекламную строку"/);
 const id=/aria-controls="([^"]+)"/.exec(html)?.[1];assert.ok(id);assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/aria-live="off"/);
});
test('marquee text is server-rendered once and remains escaped text',async()=>{
 const html=await markup(['Объявления рядом','<img src=x onerror=attack()>']);
 assert.equal(html.split('Объявления рядом').length-1,1);
 assert.ok(html.includes('&lt;img src=x onerror=attack()&gt;'));
 assert.doesNotMatch(html,/<img|<script/);
});
test('an empty marquee does not leave a moving empty frame or an ineffective control',async()=>{
 assert.equal(await markup([]),'');
});

test('the text strip itself is the control with no separate icon button',async()=>{
 const html=await markup(['Объявления рядом']);
 assert.equal((html.match(/<button\b/g)||[]).length,1);
 assert.match(html,/<button[^>]*class="[^"]*w-full/);
 assert.doesNotMatch(html,/<svg/);
 const description=/aria-describedby="([^"]+)"/.exec(html)?.[1];assert.ok(description);assert.ok(html.includes('id="'+description+'"'));
 assert.match(html,/<button[^>]*>[\s\S]*Объявления рядом[\s\S]*<\/button>/);
});

test('public paid advertising shows the scheduled start and end in Moscow time',async()=>{
 const html=await markup([{text:'ТЕСТ · Щит',publishedAt:'2026-11-23T01:23:45.000001Z',expiresAt:'2026-11-30T01:23:45.000001Z'}]);
 assert.match(html,/ТЕСТ · Щит<\/span>/);
 assert.match(html,/<time dateTime="2026-11-23T01:23:45.000001Z">23 ноября 2026 г. в 04:23<\/time>/i);
 assert.match(html,/<time dateTime="2026-11-30T01:23:45.000001Z">30 ноября 2026 г. в 04:23<\/time>/i);
});

test('terms for a paid marquee entry are available outside the moving control',async()=>{
 const html=await markup([{id:'fixture',text:'Тестовая строка',publishedAt:'2026-11-23T01:23:45Z',expiresAt:'2026-11-30T01:23:45Z',
  publicationTerms:[{category:'text-field:title',terms:'view-only'}]}]);
 const notice=html.indexOf('<details');
 assert.ok(notice>html.indexOf('</button>')&&html.indexOf('</button>')>=0);
 assert.match(html.slice(notice),/Условия распространения данных · Тестовая строка/);
 assert.match(html.slice(notice),/Разрешён только просмотр/);
});
