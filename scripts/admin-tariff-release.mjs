import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
/** Separate admin namespace; no application journal upgrade. */
export function getAdminTariffMigration(){
 const name='0062-admin-tariffs.sql',source=readFileSync(new URL('../database/candidates/'+name,import.meta.url),'utf8');
 const sha256=createHash('sha256').update(source).digest('hex');
 if(sha256!=='5bc16545770869c9c22fbe48b5d1986ee76fcb027723900b3720b1a330796537')throw Error('Invalid tariff migration');return {name,source,sha256};
}
