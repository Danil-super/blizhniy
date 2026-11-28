import type {PostgresQueries} from './postgres';
import type {ServicePublicationKind} from './service-publication-contract';
import type {WorkPublicationKind} from './work-publication-contract';
import {isPublicationWithdrawn} from './publication-location-withdrawal';

export async function hasPublicationRestrictionSchema(db:PostgresQueries,purpose?:'checkout'):Promise<boolean>{
 // Keep enforcing once the schema exists, including if its table is missing or unreadable.
 const isolation=purpose==='checkout'?", pg_catalog.current_setting('transaction_isolation') as isolation":'';
 const row=(await db.query<{installed:boolean;isolation?:string}>(
  `select pg_catalog.to_regnamespace('app_publication_restriction') is not null as installed${isolation}`,[], 'bounded-read',
 )).rows[0];
 if(typeof row?.installed!=='boolean')throw Error('Publication restriction capability unavailable');
 // A transaction that waited for the target must see the moderator's committed decision.
 if(purpose==='checkout'&&row.isolation!=='read committed')throw Error('Publication checkout requires read committed');
 return row.installed;
}

export function publicationRestrictionEligibility(alias:'w'|'s',installed?:boolean):string{
 return installed?` and not exists(select 1 from app_publication_restriction.restrictions hold
  where hold.kind=${alias}.kind and hold.publication_id=${alias}.id)`:'';
}

export async function isPublicationRestricted(tx:PostgresQueries,kind:WorkPublicationKind|ServicePublicationKind,id:string):Promise<boolean>{
 if(await isPublicationWithdrawn(tx,kind,id))return true;
 if(!await hasPublicationRestrictionSchema(tx,'checkout'))return false;
 const result=await tx.query('select 1 from app_publication_restriction.restrictions where kind=$1 and publication_id=$2',[kind,id]);
 return result.rows.length!==0;
}
