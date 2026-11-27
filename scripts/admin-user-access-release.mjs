import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
/** Separate admin namespace; the existing app migration journal stays unchanged. */
export function getAdminUserAccessMigration(){
 const name='0061-admin-user-access.sql',source=readFileSync(new URL('../database/candidates/'+name,import.meta.url),'utf8');
 const sha256=createHash('sha256').update(source).digest('hex');
 if(sha256!=='e69fd3681f2a70db9143e027bb1a23e0d0b3435125bfffa03ea7447230fa36a0')throw Error('Invalid user access migration');
 return {name,source,sha256};
}

export function getAdminPasskeyMigrations(){
 return [
  {
   name:'0089-admin-passkeys.sql',
   sha256:'49a50c67993a1289ee9ce1e2092796fdbcdda997ff5e2ccb289ab833d1cab8b4',
  },
  {
   name:'0090-user-access-passkey.sql',
   sha256:'ed38ad529d837939b266dd9c2014b8cbaa2e9216f6e9a27bc56284fab233efa2',
  },
  {
   name:'0091-admin-passkey-enrollment.sql',
   sha256:'63c8bb4272344a554baada02a31d680e40f863b5c1416fdafa51fca256ba15b9',
  },
  {
   name:'0092-admin-passkey-verifier.sql',
   sha256:'ccbb9ba27ece39df863e7a4bb77b84d550e0d70ea3a303a307fdcb7e542a4c11',
  },
 ].map(({name,sha256})=>{
  const bytes=readFileSync(new URL('../database/candidates/'+name,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Invalid passkey migration');
  return {name,sha256,source:bytes.toString('utf8')};
 });
}

// Finance checks the exact app catalog and can observe only the old or the fully upgraded schema.
export function getAdminPasskeyUpgradeSql(){
 const body=getAdminPasskeyMigrations().map(({source})=>{
  if(!/^begin;$/m.test(source)||!/^commit;\s*$/m.test(source))throw Error('Invalid passkey migration transaction');
  return source.replace(/^begin;$/m,'').replace(/\ncommit;\s*$/,'');
 }).join('\n');
 return "begin;\nset local search_path=pg_catalog;\n"+body+"\ncommit;\n";
}
