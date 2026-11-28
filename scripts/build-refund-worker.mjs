// Explicit offline build only; no credentials, database connection or service activation.
import {copyFileSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getRefundWorkerRolePlan} from './refund-worker-role.mjs';
import {paymentMigrationDirectory} from './publication-test-release-plan.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const lastMigration=new Map([
 [54,'0054-refund-worker-locks.sql'],
 [55,'0055-refund-operator-locks.sql'],
 [56,'0056-placement-renewals.sql'],
 [57,'0057-service-payment-terms.sql'],
 [58,'0058-media-reference-journal.sql'],
 [60,'0060-local-specialist-checkout.sql'],
 [75,'0075-hosted-refund-compatibility.sql'],
 [76,'0076-undelivered-response-compensation.sql'],
 [78,'0078-hosted-marquee-refund-recovery.sql'],
 [79,'0079-hosted-placement-refund-proof.sql'],
 [80,'0080-hosted-specialist-refunds.sql'],
 [81,'0081-hosted-specialist-repeat.sql'],
 [82,'0082-hosted-placement-renewals.sql'],
 [83,'0083-hosted-marquee-admission.sql'],
 [84,'0084-hosted-marquee-queue.sql'],
 [87,'0087-push-delivery.sql'],
 [95,'0095-restricted-response-delivery.sql'],
]);
export function buildRefundWorker(destination,{schema=54,localPrimary=false}={}){
 if(typeof localPrimary!=='boolean'||([58,60].includes(schema)&&!localPrimary)||(schema>=75&&localPrimary)||!lastMigration.has(schema))throw Error('Invalid refund worker schema');
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
 const migrations=getRefundWorkerRolePlan('artifact',{schema,localPrimary}).journal.map(({name,sha256})=>{
  const directory=name.startsWith('0058-')?'candidates':paymentMigrationDirectory(name);
  const bytes=readFileSync(join(root,'database',directory,name));
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Refund migration changed during build');
  return{name,directory,bytes};
 });
 const expectedCount=({60:59,75:67,76:68,78:69,79:70,80:71,81:72,82:73,83:74,84:75,87:78,95:81})[schema]??schema;
 if(migrations.length!==expectedCount||migrations.at(-1)?.name!==lastMigration.get(schema))throw Error('Unexpected refund migration boundary');
 // A new private directory is the ownership boundary. Existing destinations are never reused.
 mkdirSync(destination,{mode:0o700});
 writeFileSync(join(destination,'package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n',{flag:'wx',mode:0o600});
 const emitted=program.emit();
 if(emitted.emitSkipped||emitted.diagnostics.length)throw Error('Refund worker compilation failed');
 mkdirSync(join(destination,'scripts'));mkdirSync(join(destination,'database'));mkdirSync(join(destination,'database/migrations'));
 for(const name of ['publication-test-release-plan.mjs','paid-response-schema.mjs','specialist-checkout-release.mjs','media-retention-release.mjs','cabinet-release-plan.mjs','postgres-migration-plan.mjs','financial-catalog-privileges.mjs','refund-worker-role.mjs','refund-worker-schema.mjs','local-refund-worker-runtime.mjs','hosted-refund-target.mjs','hosted-postgres-location.mjs','refund-worker-service.mjs','local-primary-refund-target.mjs','local-primary-config.mjs','local-refund-services.mjs'])
  copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 if(schema>=87)copyFileSync(join(root,'scripts/hosted-refund-worker.mjs'),join(destination,'scripts/hosted-refund-worker.mjs'));
 copyFileSync(join(root,'database/refund-schema-0054.json'),join(destination,'database/refund-schema-0054.json'));
 if(schema>=55)for(const name of ['refund-schema-0055.json','refund-schema-local-primary-0055.json',...(schema>=56?['refund-schema-0056.json','refund-schema-local-primary-0056.json']:[]),...(schema>=57?['refund-schema-0057.json','refund-schema-local-primary-0057.json']:[]),...(schema>=58?['refund-schema-local-primary-0058.json']:[]),...(schema===60?['refund-schema-local-primary-0060.json']:[])])copyFileSync(join(root,'database',name),join(destination,'database',name));
 if(schema>=58)mkdirSync(join(destination,'database/candidates'));
 for(const {name,directory,bytes} of migrations)writeFileSync(join(destination,'database',directory,name),bytes,{flag:'wx',mode:0o600});
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
