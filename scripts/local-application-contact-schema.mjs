import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function getLocalApplicationContactMigrations(){
 const name='0035-application-contact-views.sql',source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');
 return [{name,source,sha256:createHash('sha256').update(source).digest('hex')}];
}
