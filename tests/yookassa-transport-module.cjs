const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const filename=path.join(__dirname,'../src/lib/yookassa-transport.ts');
const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports',js)(name=>{
 if(name!=='./yookassa-payment-contract.ts')throw Error('Unexpected transport dependency');
 return require('./yookassa-contract-module.cjs');
},module.exports);
