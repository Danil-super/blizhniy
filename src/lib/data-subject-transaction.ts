import {hashSessionToken} from './identity';
import {DeletionAccessError} from './account-deletion-contract.ts';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {DeletionPrincipal} from './account-deletion-contract.ts';
type Principal=DeletionPrincipal&{authVersion:string};
/** Dedicated rights-request boundary. Never use this for ordinary account/admin resources. */
export async function withDataSubjectTransaction<T>(db:Pick<PostgresDatabase,'transaction'>,token:string,
 work:(tx:PostgresQueries,user:Principal)=>Promise<T>):Promise<T>{
 if(typeof window!=='undefined')throw new DeletionAccessError();
 const hash=hashSessionToken(token);if(!hash)throw new DeletionAccessError();
 return db.transaction(async tx=>{
  const user=(await tx.query<Principal>(`select u.id,u.email,u.is_blocked as "isBlocked",u.auth_version::text as "authVersion"
   from app.users u where u.id=(select user_id from app.sessions where token_hash=$1) and u.email_verified_at is not null for update of u`,[hash])).rows[0];
  if(!user)throw new DeletionAccessError();const values=[hash,user.id,user.authVersion];
  const live=`token_hash=$1 and user_id=$2 and auth_version=$3 and scope in ('app','data-subject')
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes'`;
  if((await tx.query(`select token_hash from app.sessions where ${live} for update`,values)).rowCount!==1)throw new DeletionAccessError();
  const result=await work(tx,user);
  if((await tx.query(`update app.sessions set last_seen_at=least(clock_timestamp(),expires_at) where ${live}`,values)).rowCount!==1)throw new DeletionAccessError();
  return result;
 });
}
