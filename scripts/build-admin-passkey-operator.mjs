import {copyFileSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const scripts=['hosted-admin-passkey.mjs','hosted-operator-socket.mjs','hosted-postgres-location.mjs',
 'admin-passkey-verifier-role.mjs','financial-catalog-privileges.mjs','refund-worker-schema.mjs','issue-admin-passkey.mjs'];
const sources=['admin-passkey-http.ts','postgres-admin-passkey.ts','postgres-admin-passkey-enrollment.ts',
 'admin-user-access-passkey.ts','admin-archive-passkey.ts','admin-refund-passkey.ts','postgres.ts','production-auth-config.ts'];
const migrations=['0089-admin-passkeys.sql','0090-user-access-passkey.sql','0090-user-access-passkey.down.sql',
 '0091-admin-passkey-enrollment.sql','0092-admin-passkey-verifier.sql','0092-admin-passkey-verifier.down.sql'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Offline package with a pinned dependency lock. The destination must be new. */
export function buildAdminPasskeyOperator(destination){
 if(typeof destination!=='string'||!isAbsolute(destination)||destination!==join(realpathSync(dirname(destination)),relative(dirname(destination),destination)))
  throw Error('Invalid passkey operator destination');
 const program=ts.createProgram(sources.map(name=>join(root,'src/lib',name)),{
  target:ts.ScriptTarget.ES2022,lib:['lib.esnext.d.ts','lib.dom.d.ts'],module:ts.ModuleKind.Node16,moduleResolution:ts.ModuleResolutionKind.Node16,
  strict:true,esModuleInterop:true,skipLibCheck:true,noEmitOnError:true,rewriteRelativeImportExtensions:true,
  rootDir:join(root,'src'),outDir:join(destination,'compiled'),
 });
 if(ts.getPreEmitDiagnostics(program).length)throw Error('Passkey operator compilation failed');
 mkdirSync(destination,{mode:0o700});
 for(const folder of ['scripts','database','ops'])mkdirSync(join(destination,folder),{mode:0o700});
 if(program.emit().emitSkipped)throw Error('Passkey operator compilation failed');
 for(const name of scripts)copyFileSync(join(root,'scripts',name),join(destination,'scripts',name));
 for(const name of ['admin-passkey-operator.mjs','local-user-access-operator.mjs']){
  const source=readFileSync(join(root,'scripts',name),'utf8');
  const compiled=source.replaceAll(/'\.\.\/src\/lib\/([a-z0-9-]+)\.ts'/g,"'../compiled/lib/$1.js'");
  if(compiled===source||compiled.includes('../src/'))throw Error('Invalid passkey operator dependency');
  writeFileSync(join(destination,'scripts',name),compiled,{flag:'wx',mode:0o600});
 }
 for(const name of migrations)copyFileSync(join(root,'database/candidates',name),join(destination,'database',name));
 for(const name of ['blizhniy-admin-passkey.service','blizhniy-admin-passkey.socket'])
  copyFileSync(join(root,'ops/systemd',name),join(destination,'ops',name));
 const {name,version,dependencies,devDependencies,overrides}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 writeFileSync(join(destination,'package.json'),JSON.stringify({name,version,private:true,type:'commonjs',dependencies,devDependencies,overrides})+'\n',{flag:'wx',mode:0o600});
 copyFileSync(join(root,'package-lock.json'),join(destination,'package-lock.json'));
 const manifest={version:1,role:'blizhniy_passkey_verifier',typescript:ts.version,
  sources:program.getSourceFiles().filter(file=>!file.isDeclarationFile).map(file=>({name:relative(root,file.fileName),sha256:sha(file.text)})),
  migrations:migrations.map(name=>({name,sha256:sha(readFileSync(join(destination,'database',name)))})),
  dependencyLock:sha(readFileSync(join(destination,'package-lock.json'))),
 };
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}
