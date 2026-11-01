import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function getLocalCheckoutEditMigrations(){
 const name='0034-checkout-edit-fence.sql',source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');
 return [{name,source,sha256:createHash('sha256').update(source).digest('hex')}];
}
