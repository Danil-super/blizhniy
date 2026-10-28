import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function getLocalTelegramMigrations(){
 return Promise.all(['0031-telegram-phone.sql','0032-phone-publication-wait.sql'].map(async name=>{
  const source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');
  return{name,source,sha256:createHash('sha256').update(source).digest('hex')};
 }));
}
export const withoutTransaction=source=>source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,'');
