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
  if(dependency==='@/lib/ad-marquee-store')return {getActiveAdMarqueeMessages:async()=>messages};
  if(dependency==='./AdMarquee')return load('AdMarquee',messages);
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
