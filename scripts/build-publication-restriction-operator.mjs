import {copyFileSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getHostedPublicationRestrictionMigrations,getHostedPublicationRestrictionUpgradeSql} from './publication-test-release-plan.mjs';
import {publicationRestrictionRole} from './publication-restriction-operator-role.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const units=['blizhniy-publication-restriction.socket','blizhniy-publication-restriction.service'];
const scripts=['hosted-publication-restriction-operator.mjs','hosted-operator-socket.mjs','hosted-postgres-location.mjs',
 'publication-restriction-operator-role.mjs','paid-response-schema.mjs','refund-worker-schema.mjs','financial-catalog-privileges.mjs'];
const locationTool='scripts/publication-location-restore.mjs';
const locationMigration='database/candidates/0096-publication-location-withdrawals.sql';

/** Offline package. The destination must be new and the lock comes from the application release. */
export function buildPublicationRestrictionOperator(destination){
 if(typeof destination!=='string'||!isAbsolute(destination)||destination!==join(realpathSync(dirname(destination)),relative(dirname(destination),destination)))
  throw Error('Invalid publication restriction operator destination');
 const migrations=getHostedPublicationRestrictionMigrations(),upgrade=getHostedPublicationRestrictionUpgradeSql();
 const sources=['postgres.ts','identity.ts','admin-user-access-contract.ts','publication-restriction-operator-client.ts'];
 const program=ts.createProgram(sources.map(name=>join(root,'src/lib',name)),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.Node16,
  moduleResolution:ts.ModuleResolutionKind.Node16,strict:true,esModuleInterop:true,skipLibCheck:true,
  noEmitOnError:true,rewriteRelativeImportExtensions:true,rootDir:join(root,'src'),outDir:join(destination,'compiled'),
 });
 if(ts.getPreEmitDiagnostics(program).length)throw Error('Publication restriction operator compilation failed');
 mkdirSync(destination,{mode:0o700});
 for(const folder of ['scripts','database','database/candidates','ops'])mkdirSync(join(destination,folder),{mode:0o700});
 if(program.emit().emitSkipped)throw Error('Publication restriction operator compilation failed');
 const write=(path,bytes)=>writeFileSync(join(destination,path),bytes,{flag:'wx',mode:0o600});
 for(const name of scripts)copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 for(const name of ['local-publication-restriction-operator.mjs','local-user-access-operator.mjs']){
  const source=readFileSync(join(root,'scripts',name),'utf8');
  const compiled=source.replaceAll(/'\.\.\/src\/lib\/([a-z0-9-]+)\.ts'/g,"'../compiled/lib/$1.js'");
  if(compiled===source||compiled.includes('../src/'))throw Error('Invalid publication restriction operator dependency');
  write('scripts/'+name,compiled);
 }
 for(const {name,sql} of migrations)write('database/candidates/'+name,sql);
 write('database/publication-restriction-upgrade.sql',upgrade);
 const withdrawalTool=readFileSync(join(root,locationTool)),withdrawalMigration=readFileSync(join(root,locationMigration));
 write(locationTool,withdrawalTool);
 write(locationMigration,withdrawalMigration);
 for(const name of units)copyFileSync(join(root,'ops/systemd',name),join(destination,'ops',name));
 const {name,version,dependencies,devDependencies,overrides}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 write('package.json',JSON.stringify({name,version,private:true,type:'commonjs',dependencies,devDependencies,overrides})+'\n');
 const lock=readFileSync(join(root,'package-lock.json'));
 write('package-lock.json',lock);
 const manifest={version:1,role:publicationRestrictionRole,typescript:ts.version,
  migrations:migrations.map(({name,sha256})=>({name,sha256})),upgradeSha256:sha(upgrade),dependencyLock:sha(lock),
  locationWithdrawal:{migrationSha256:sha(withdrawalMigration),restoreToolSha256:sha(withdrawalTool)}};
 write('manifest.json',JSON.stringify(manifest)+'\n');
 return manifest;
}
