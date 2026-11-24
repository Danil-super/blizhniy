import assert from 'node:assert/strict';
import { copyFileSync, cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const scripts=['account-export-snapshot.mjs','local-account-export-delivery.mjs','local-account-export-report.mjs',
 'prepare-approved-account-export.mjs','stage-approved-account-export.mjs'];
const entrypoints=['account-deletion-contract','identity','listing-view-history','media-files','media-runtime-policy',
 'postgres','postgres-profile','service-publication-contract','work-publication-contract','auth-http','trusted-proxy-ip',
 'account-cookie','data-subject-cookie'];
const json=path=>JSON.parse(readFileSync(path,'utf8'));

export function buildApprovedAccountExportOperator(destination,browserCache){
 assert.ok(process.platform==='linux'&&process.arch==='x64');
 assert.ok(isAbsolute(destination)&&destination===join(realpathSync(dirname(destination)),relative(dirname(destination),destination)));
 assert.ok(isAbsolute(browserCache)&&realpathSync(browserCache)===browserCache);
 const lock=json(join(root,'package-lock.json')).packages;
 const {browsers}=json(join(root,'node_modules/playwright-core/browsers.json'));
 const browser=browsers.find(item=>item.name==='chromium-headless-shell');
 assert.match(browser?.revision,/^[0-9]+$/);
 const browserName='chromium_headless_shell-'+browser.revision;
 const browserSource=join(browserCache,browserName);
 assert.ok(lstatSync(join(browserSource,'INSTALLATION_COMPLETE')).isFile());
 assert.ok(lstatSync(join(browserSource,'chrome-headless-shell-linux64','chrome-headless-shell')).isFile());

 const lib=join(root,'src/lib');
 const program=ts.createProgram(entrypoints.map(name=>join(lib,name+'.ts')),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.CommonJS,
  moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,esModuleInterop:true,skipLibCheck:true,
  noEmitOnError:true,rewriteRelativeImportExtensions:true,rootDir:join(root,'src'),outDir:join(destination,'compiled'),
 });
 assert.equal(ts.getPreEmitDiagnostics(program).length,0);
 const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile)
  .map(file=>relative(join(root,'src'),file.fileName).replace(/\.ts$/,'.js')).sort();
 assert.ok(sources.every(source=>/^lib\/[a-z0-9-]+\.js$/.test(source)));

 const dependencies=new Map();
 function add(name){
  if(dependencies.has(name))return;
  assert.match(name,/^[a-z0-9-]+$/);
  const entry=lock['node_modules/'+name];
  const installed=json(join(root,'node_modules',name,'package.json'));
  assert.ok(entry?.integrity&&entry.version===installed.version&&installed.name===name);
  dependencies.set(name,entry.version);
  for(const dependency of Object.keys(entry.dependencies??{}))add(dependency);
 }
 for(const name of ['pg','nodemailer','playwright'])add(name);

 mkdirSync(destination,{mode:0o700});
 try{
  writeFileSync(join(destination,'package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n',{flag:'wx'});
  const emitted=program.emit();
  assert.ok(!emitted.emitSkipped&&emitted.diagnostics.length===0);
  mkdirSync(join(destination,'scripts'));
  for(const name of scripts)copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
  writeFileSync(join(destination,'scripts/local-primary-modules.cjs'),
   `const approved=new Set(${JSON.stringify(entrypoints)});
module.exports.loadLocalPrimaryModule=name=>{
 if(!approved.has(name))throw Error('Unknown compiled module');
 return require('../compiled/lib/'+name+'.js');
};
`,{flag:'wx'});
  const copyTree=(source,target)=>cpSync(source,target,{recursive:true,force:false,errorOnExist:true,
   filter:path=>{assert.equal(lstatSync(path).isSymbolicLink(),false);return true;}});
  mkdirSync(join(destination,'node_modules'));
  for(const name of dependencies.keys())copyTree(join(root,'node_modules',name),join(destination,'node_modules',name));
  mkdirSync(join(destination,'browser'));
  copyTree(browserSource,join(destination,'browser',browserName));
  const manifest={version:1,sources,dependencies:Object.fromEntries(dependencies),browserRevision:browser.revision};
  writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx'});
  return manifest;
 }catch(error){
  rmSync(destination,{recursive:true,force:true});
  throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assert.equal(process.argv.length,4);
  const manifest=buildApprovedAccountExportOperator(process.argv[2],process.argv[3]);
  console.log(JSON.stringify({status:'built',modules:manifest.sources.length,browser:manifest.browserRevision}));
 }catch{
  console.error('Approved account export operator build failed.');
  process.exitCode=1;
 }
}
