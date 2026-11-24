import {copyFileSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getUserAccessRolePlan} from './user-access-role.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
/** Offline source package only; no credentials, role installation or connection. */
export function buildUserAccessOperator(destination,{tariffs=false}={}){
 if(typeof tariffs!=='boolean'||typeof destination!=='string'||!isAbsolute(destination)||destination!==join(realpathSync(dirname(destination)),relative(dirname(destination),destination)))throw Error('Invalid user operator destination');
 const program=ts.createProgram(['postgres-admin-user-access.ts','admin-user-access-contract.ts','postgres-admin-tariffs.ts','admin-operator-contract.ts','postgres.ts'].map(name=>join(root,'src/lib',name)),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,
  strict:true,esModuleInterop:true,skipLibCheck:true,noEmitOnError:true,rewriteRelativeImportExtensions:true,rootDir:join(root,'src'),outDir:join(destination,'compiled'),paths:{'@/*':[join(root,'src/*')]},
 });
 if(ts.getPreEmitDiagnostics(program).length)throw Error('User operator compilation failed');
 const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile).map(file=>({name:relative(root,file.fileName),sha256:createHash('sha256').update(file.text).digest('hex')}));
 const plan=getUserAccessRolePlan('blizhniy_prod',{tariffs}),available=getUserAccessRolePlan('blizhniy_prod',{tariffs:true}),migrations=[...plan.appJournal,...available.journal].map(row=>{
  const folder=/^(0058|0060|0061|0062)-/.test(row.name)?'candidates':'migrations',bytes=readFileSync(join(root,'database',folder,row.name));
  if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('User operator migration drift');return {...row,folder,bytes};
 });
 if(tariffs&&plan.journal.length!==2)throw Error('Tariff guard approval required');
 mkdirSync(destination,{mode:0o700});writeFileSync(join(destination,'package.json'),'{"private":true,"type":"commonjs"}\n',{flag:'wx',mode:0o600});
 if(program.emit().emitSkipped)throw Error('User operator compilation failed');
 for(const folder of ['scripts','database','database/migrations','database/candidates'])mkdirSync(join(destination,folder));
 for(const name of ['admin-user-access-release.mjs','admin-tariff-release.mjs','user-access-role.mjs','local-user-access-runtime.mjs','local-primary-refund-target.mjs','local-primary-config.mjs',
  'financial-catalog-privileges.mjs','refund-worker-schema.mjs','refund-worker-role.mjs','publication-test-release-plan.mjs','paid-response-schema.mjs','postgres-migration-plan.mjs','cabinet-release-plan.mjs','media-retention-release.mjs','specialist-checkout-release.mjs'])
  copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 const server=readFileSync(join(root,'scripts/local-user-access-operator.mjs'),'utf8'),dependency="'../src/lib/admin-user-access-contract.ts'";
 if(server.split(dependency).length!==2)throw Error('User operator server dependency drift');
 writeFileSync(join(destination,'scripts/local-user-access-operator.mjs'),server.replace(dependency,"'../compiled/lib/admin-user-access-contract.js'"),{flag:'wx',mode:0o600});
 const adminServer=readFileSync(join(root,'scripts/local-admin-operator.mjs'),'utf8'),adminDependency="'../src/lib/admin-operator-contract.ts'";
 if(adminServer.split(adminDependency).length!==2)throw Error('Admin operator dependency drift');
 writeFileSync(join(destination,'scripts/local-admin-operator.mjs'),adminServer.replace(adminDependency,"'../compiled/lib/admin-operator-contract.js'"),{flag:'wx',mode:0o600});
 for(const row of migrations){const file=join(destination,'database',row.folder,row.name);writeFileSync(file,row.bytes,{flag:'wx',mode:0o600});
  if(createHash('sha256').update(readFileSync(file)).digest('hex')!==row.sha256)throw Error('User operator copied migration drift');}
 for(const name of ['refund-schema-local-primary-0060.json','admin-user-access-schema-v1.json',...(available.journal.length===2?['admin-user-access-schema-v2.json']:[])])copyFileSync(join(root,'database',name),join(destination,'database',name));
 const manifest={version:1,typescript:ts.version,sources,appJournal:plan.appJournal,adminJournal:available.journal};
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});return manifest;
}
