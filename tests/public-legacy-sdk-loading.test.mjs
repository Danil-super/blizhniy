import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const require=createRequire(import.meta.url),ts=require('typescript');
const root=fileURLToPath(new URL('..',import.meta.url));

// Follow real eager dependencies, including re-exports; import() is a split boundary.
function eagerExternalImports(entry,seen=new Set()){
 const file=path.join(root,entry);
 if(seen.has(file))return [];
 seen.add(file);
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const external=[];
 for(const statement of source.statements){
  if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
  if(statement.importClause?.isTypeOnly||statement.isTypeOnly)continue;
  const specifier=statement.moduleSpecifier;
  if(!specifier||!ts.isStringLiteral(specifier))continue;
  const name=specifier.text;
  if(!name.startsWith('@/')&&!name.startsWith('.')){external.push(name);continue;}
  const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):path.resolve(path.dirname(file),name);
  const resolved=['','.tsx','.ts','/index.tsx','/index.ts'].map(suffix=>base+suffix).find(candidate=>existsSync(candidate)&&/\.tsx?$/.test(candidate));
  if(resolved)external.push(...eagerExternalImports(path.relative(root,resolved),seen));
 }
 return external;
}

for(const entry of ['SiteHeader.tsx','MobileBottomNav.tsx','BookingLegacyStorageCleanup.tsx','auth/LogoutButton.tsx']){
 test(`${entry} does not eagerly import the legacy browser SDK`,()=>{
  assert.equal(eagerExternalImports('src/components/'+entry).some(name=>name.startsWith('@supabase/')),false);
 });
}
