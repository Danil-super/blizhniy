import type {PostgresQueries} from './postgres';
import {parseProfessionCatalog,maxPublicProfessions} from './profession-catalog-contract.ts';
export class PostgresProfessionRepository{
 constructor(private readonly db:PostgresQueries){if(typeof window!=='undefined')throw Error('Profession catalog is server-only');}
 async listActive(){
  const rows=(await this.db.query(`select id,slug,name,parent_name as parent,active from app.specialist_categories
   where active order by parent_name,name,id limit $1`,[maxPublicProfessions+1])).rows;
  return parseProfessionCatalog(rows);
 }
}
