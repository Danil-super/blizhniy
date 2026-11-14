// Explicit, offline compiler. Never reads dotenv or connects to PostgreSQL / a merchant.
import {copyFileSync,mkdirSync,realpathSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function buildPaymentWorker(destination,{schema=54}={}){
 if(![54,55].includes(schema))throw Error('Invalid worker schema');
 if(typeof destination!=='string'||!isAbsolute(destination)||destination!==join(realpathSync(dirname(destination)),relative(dirname(destination),destination)))throw Error('Invalid worker destination');
 const program=ts.createProgram(['payment-reconciliation-worker.ts','account-test-payment-verifier.ts','postgres.ts'].map(name=>join(root,'src/lib',name)),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.CommonJS,
  moduleResolution:ts.ModuleResolutionKind.Node10,strict:true,esModuleInterop:true,skipLibCheck:true,
  noEmitOnError:true,rewriteRelativeImportExtensions:true,rootDir:join(root,'src'),outDir:join(destination,'compiled'),
  paths:{'@/*':[join(root,'src/*')]},
 });
 if(ts.getPreEmitDiagnostics(program).length)throw Error('Worker compilation failed');
 const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile).map(file=>relative(join(root,'src'),file.fileName).replace(/\.ts$/,'.js')).sort();
 if(sources.some(path=>!/^lib\/[a-z0-9-]+\.js$/.test(path)))throw Error('Unexpected worker source');
 const migrations=getRefundWorkerRolePlan('artifact',{schema}).journal.map(({name,sha256})=>{
  const bytes=readFileSync(join(root,'database/migrations',name));
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Worker migration changed during build');
  return{name,bytes};
 });
 // mkdir without recursive/overwrite is the ownership boundary; failures never erase a target.
 mkdirSync(destination,{mode:0o700});
 writeFileSync(join(destination,'package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n',{flag:'wx',mode:0o600});
 const emitted=program.emit();
 if(emitted.emitSkipped||emitted.diagnostics.length)throw Error('Worker compilation failed');
 mkdirSync(join(destination,'scripts'));mkdirSync(join(destination,'database'));mkdirSync(join(destination,'database/migrations'));
 for(const name of ['media-retention-release.mjs','cabinet-release-plan.mjs','financial-catalog-privileges.mjs','payment-reconciliation-role.mjs','payment-reconciliation-service.mjs','postgres-migration-plan.mjs','payment-worker-runtime.mjs','payment-worker.mjs','refund-worker-role.mjs','refund-worker-schema.mjs'])
  copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 copyFileSync(join(root,'database/refund-schema-0054.json'),join(destination,'database/refund-schema-0054.json'));
 if(schema===55)copyFileSync(join(root,'database/refund-schema-0055.json'),join(destination,'database/refund-schema-0055.json'));
 for(const {name,bytes} of migrations)writeFileSync(join(destination,'database/migrations',name),bytes,{flag:'wx',mode:0o600});
 const manifest={version:1,typescript:ts.version,sources};
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try {
  if(process.argv.length!==3)throw Error('Worker build needs one new absolute destination');
  const result=buildPaymentWorker(process.argv[2]);console.log(JSON.stringify({status:'built',modules:result.sources.length}));
 }catch {console.error('Payment worker build failed; destination is never overwritten');process.exitCode=1;}
}
