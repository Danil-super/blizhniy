import {startLocalUserAccessOperator} from './local-user-access-operator.mjs';
import {hashSessionToken} from '../src/lib/identity.ts';
import {
 PublicationRestrictionError,parsePublicationRestrictionEnvelope,parsePublicationRestrictionReceipt,publicationRestrictionErrorStatus,
} from '../src/lib/admin-publication-restriction-contract.ts';

const databaseErrors=Object.freeze({
 PZR01:'ADMIN_REQUIRED',PZR02:'INVALID_INPUT',PZR03:'PUBLICATION_NOT_FOUND',PZR04:'RESTRICTION_CONFLICT','55P03':'ACCESS_BUSY',
});

/** Reuse the owned socket transport with the separate EXECUTE-only operator pool. */
export function startLocalPublicationRestrictionOperator(db,{activation,preflight,close=()=>db.close()}={}){
 let inFlight=0;
 return startLocalUserAccessOperator({
  async execute(token,command,signal){
   signal.throwIfAborted();
   const hash=hashSessionToken(token);
   if(!hash)throw new PublicationRestrictionError('ADMIN_REQUIRED');
   if(inFlight>=3)throw new PublicationRestrictionError('ACCESS_BUSY');
   inFlight++;
   try{
    await preflight?.();
    signal.throwIfAborted();
    const {expectedAdminId,kind,publicationId,expectedRevision,caseId}=command;
    const {rows}=await db.query('select app_publication_restriction.restrict($1,$2,$3,$4,$5,$6) as receipt',
     [hash,expectedAdminId,kind,publicationId,expectedRevision,caseId]);
    if(rows.length!==1)throw Error();
    return rows[0].receipt;
   }catch(error){
    const code=typeof error?.code==='string'&&Object.hasOwn(databaseErrors,error.code)?databaseErrors[error.code]:'ACCESS_UNAVAILABLE';
    throw new PublicationRestrictionError(code);
   }finally{inFlight--;}
  },
  close,
 },{parseEnvelope:parsePublicationRestrictionEnvelope,parseResult:parsePublicationRestrictionReceipt,
  errorStatus:publicationRestrictionErrorStatus,activation});
}
