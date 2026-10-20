// Actual pure module, not a replacement validator. Provider I/O clocks remain in each harness.
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const filename=path.join(__dirname,'../src/lib/yookassa-payment-contract.ts');
const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('exports',js)(module.exports);
