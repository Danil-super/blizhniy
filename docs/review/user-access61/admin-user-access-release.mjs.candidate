import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
/** Separate admin namespace; the existing app migration journal stays unchanged. */
export function getAdminUserAccessMigration(){
 const name='0061-admin-user-access.sql',source=readFileSync(new URL('../database/candidates/'+name,import.meta.url),'utf8');
 const sha256=createHash('sha256').update(source).digest('hex');
 if(sha256!=='e69fd3681f2a70db9143e027bb1a23e0d0b3435125bfffa03ea7447230fa36a0')throw Error('Invalid user access migration');
 return {name,source,sha256};
}
