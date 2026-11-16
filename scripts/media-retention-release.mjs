import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const mediaRetentionMigrationName='0058-media-reference-journal.sql';
/** Review candidate stays outside automatic bootstrap and active migrations. */
export function getMediaRetentionMigration(){
 const source=readFileSync(new URL('../database/candidates/'+mediaRetentionMigrationName,import.meta.url),'utf8');
 return{name:mediaRetentionMigrationName,source,sha256:createHash('sha256').update(source).digest('hex')};
}
