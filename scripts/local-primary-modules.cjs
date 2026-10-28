// Execute only repository-owned TypeScript for the local stand, using the same
// compiler as the native integration fixtures. This is not an untrusted sandbox.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require('typescript'),root=fs.realpathSync(path.join(__dirname,'..')),cache=new Map();
function load(file){
 file=fs.realpathSync(file);
 if(!file.startsWith(root+'/src/lib/')||!file.endsWith('.ts'))throw Error('Local stand module outside trusted library');
 if(cache.has(file))return cache.get(file).exports;
 const loaded={exports:{}};cache.set(file,loaded);
 const requireHere=Module.createRequire(file);
 const requireSource=specifier=>{
  if(specifier==='server-only')return {};
  if(specifier.startsWith('.')||specifier.startsWith('@/lib/')){
   const target=specifier.startsWith('@/lib/')?path.join(root,'src/lib',specifier.slice(6)):path.resolve(path.dirname(file),specifier);
   return load(target.endsWith('.ts')?target:target+'.ts');
  }
  if(!specifier.startsWith('node:')&&!['pg','sharp','nodemailer'].includes(specifier))throw Error('Unapproved local stand dependency');
  return requireHere(specifier);
 };
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',compiled)(requireSource,loaded,loaded.exports);
 return loaded.exports;
}
module.exports={loadLocalPrimaryModule:name=>{
 if(!/^[a-z][a-z0-9-]+$/.test(name))throw Error('Invalid local stand module name');
 return load(path.join(root,'src/lib',name+'.ts'));
}};
