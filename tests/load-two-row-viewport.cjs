// Use the actual presentation component in SSR/tree harnesses; browser tests measure DOM geometry.
const fs=require('node:fs'),ts=require('typescript');
module.exports=function loadTwoRowViewport(runtime){
 const exports={};
 const compiled=ts.transpileModule(fs.readFileSync('src/components/cabinet/TwoRowCardViewport.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',compiled)(exports,name=>{
  if(name==='react')return {useRef:value=>({current:value}),useState:()=>[undefined,()=>{}],useEffect(){}};
  if(name==='react/jsx-runtime')return runtime;
  throw Error('Unexpected viewport dependency '+name);
 });return exports;
};
