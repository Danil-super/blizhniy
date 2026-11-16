const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function render(available){
 const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/phone/PhoneVerificationButton.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
  if(name==='react')return{...React,useEffect(){},useState:initial=>[initial===null?{available,required:true,verified:false,phone:null,verifiedPhone:null}:initial,()=>{}]};
  if(name==='react/jsx-runtime')return require(name);
  if(name==='@/lib/client-phone-verification')return{phoneVerification:{},PhoneClientError:class extends Error{}};
  if(name==='@/lib/phone-verification-window')return{};
  if(name==='@/lib/phone-verification-contract')return{};
  throw Error('Unexpected availability dependency '+name);
 },exports);
 return renderToStaticMarkup(React.createElement(React.Fragment,null,...[false,true].map(compact=>React.createElement(exports.PhoneVerificationButton,{key:String(compact),owner:'10000000-0000-4000-8000-000000000001',compact}))));
}
test('unconfigured Telegram controls describe their disabled state using unique visible notices',()=>{
 const html=render(false),ids=[...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);
 for(const id of ids)assert.ok(html.includes(`<p id="${id}" role="status"`));
 assert.equal((html.match(/disabled=""/g)||[]).length,2);
});
test('configured controls do not refer to a missing unavailability notice',()=>{
 const html=render(true);assert.doesNotMatch(html,/aria-describedby=|disabled=""|пока не настроено/);
});
