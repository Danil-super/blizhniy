// Explicit offline build only; no credentials, database connection or service activation.
import {copyFileSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function buildRefundWorker(destination,{schema=54}={}){
 if(![54,55,56].includes(schema))throw Error('Invalid refund worker schema');
 if(typeof destination!=='string'||!isAbsolute(destination)||destination!==join(realpathSync(dirname(destination)),relative(dirname(destination),destination)))throw Error('Invalid refund worker destination');
 const program=ts.createProgram(['placement-refund-worker.ts','application-compensation-worker.ts','postgres.ts','refund-merchant-preflight.ts'].map(name=>join(root,'src/lib',name)),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.CommonJS,
  moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,esModuleInterop:true,skipLibCheck:true,
  noEmitOnError:true,rewriteRelativeImportExtensions:true,rootDir:join(root,'src'),outDir:join(destination,'compiled'),
  paths:{'@/*':[join(root,'src/*')]},
 });
 if(ts.getPreEmitDiagnostics(program).length)throw Error('Refund worker compilation failed');
 const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile).map(file=>relative(join(root,'src'),file.fileName).replace(/\.ts$/,'.js')).sort();
 if(sources.some(path=>!/^lib\/[a-z0-9-]+\.js$/.test(path)))throw Error('Unexpected refund worker source');
 const migrations=getRefundWorkerRolePlan('artifact',{schema}).journal.map(({name,sha256})=>{
  const bytes=readFileSync(join(root,'database/migrations',name));
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Refund migration changed during build');
  return{name,bytes};
 });
 if(migrations.length!==schema||migrations.at(-1).name!==(schema===54?'0054-refund-worker-locks.sql':schema===55?'0055-refund-operator-locks.sql':'0056-placement-renewals.sql'))throw Error('Unexpected refund migration boundary');
 // A new private directory is the ownership boundary. Existing destinations are never reused.
 mkdirSync(destination,{mode:0o700});
 writeFileSync(join(destination,'package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n',{flag:'wx',mode:0o600});
 const emitted=program.emit();
 if(emitted.emitSkipped||emitted.diagnostics.length)throw Error('Refund worker compilation failed');
 mkdirSync(join(destination,'scripts'));mkdirSync(join(destination,'database'));mkdirSync(join(destination,'database/migrations'));
 for(const name of ['cabinet-release-plan.mjs','postgres-migration-plan.mjs','financial-catalog-privileges.mjs','refund-worker-role.mjs','refund-worker-schema.mjs','local-refund-worker-runtime.mjs','refund-worker-service.mjs','local-primary-refund-target.mjs','local-primary-config.mjs','local-refund-services.mjs'])
  copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 copyFileSync(join(root,'database/refund-schema-0054.json'),join(destination,'database/refund-schema-0054.json'));
 if(schema>=55)for(const name of ['refund-schema-0055.json','refund-schema-local-primary-0055.json',...(schema===56?['refund-schema-0056.json','refund-schema-local-primary-0056.json']:[])])copyFileSync(join(root,'database',name),join(destination,'database',name));
 for(const {name,bytes} of migrations)writeFileSync(join(destination,'database/migrations',name),bytes,{flag:'wx',mode:0o600});
 const manifest={version:1,schema,typescript:ts.version,sources};
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}

if(import.meta.main){
 try{
  if(process.argv.length!==3)throw Error('Refund worker build needs one new absolute destination');
  const result=buildRefundWorker(process.argv[2]);console.log(JSON.stringify({status:'built',modules:result.sources.length}));
 }catch{console.error('Refund worker build failed; destination is never overwritten');process.exitCode=1;}
}
