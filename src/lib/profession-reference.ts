import type {PostgresQueries} from './postgres';
import {parseListingDraftId} from './listing-draft-contract.ts';
type Reference={id:string;name:string;active:boolean};
type Previous={id:string|null;name:string|null};
export class ProfessionReferenceError extends Error{constructor(){super('Profession reference unavailable');}}
/** Caller passes only a locked, owner-authorized persisted reference as previous. */
export async function resolveProfession(tx:PostgresQueries,name:string|null,id?:string,previous?:Previous):Promise<Reference|null>{
 const read=async(value:string)=>{
  const row=(await tx.query<Reference>('select id,name,active from app.specialist_categories where id=$1',[parseListingDraftId(value)])).rows[0];
  if(!row||!row.active&&row.id!==previous?.id)throw new ProfessionReferenceError();return row;
 };
 if(id!==undefined)return read(id);
 if(!name)return null;
 // Preserve identity BEFORE looking up a reused old label in the global catalogue.
 if(previous?.id){
  const row=(await tx.query<Reference>('select id,name,active from app.specialist_categories where id=$1',[previous.id])).rows[0];
  if(row&&(name===previous.name||name===row.name))return row;
 }
 const rows=(await tx.query<Reference>('select id,name,active from app.specialist_categories where name=$1 limit 2',[name])).rows;
 if(rows.length!==1||!rows[0].active)throw new ProfessionReferenceError();return rows[0];
}
/** Literal server aliases only, never request-selected SQL identifiers. */
export function professionFormSql(alias:''|'w'|'s'=''):string{
 if(!['','w','s'].includes(alias))throw Error('Invalid profession SQL alias');
 const p=alias?alias+'.':'';
 return `case when ${p}kind in ('vacancy','workRequest','specialist') and ${p}profession_id is not null
  then ${p}form || jsonb_build_object('professionName',(select profession_name.name from app.specialist_categories profession_name where profession_name.id=${p}profession_id))
  else ${p}form end`;
}
