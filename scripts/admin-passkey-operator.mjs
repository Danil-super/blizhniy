import {startLocalUserAccessOperator} from './local-user-access-operator.mjs';
import {AdminPasskeyError} from '../src/lib/admin-passkey.ts';
import {AuthRequestError} from '../src/lib/auth-http.ts';
import {executeAdminPasskeyRequest} from '../src/lib/admin-passkey-http.ts';
import {parseAdminPasskeyEnvelope,parseAdminPasskeyResult,passkeyOperatorErrorStatus,passkeyOperatorRequestLimit} from '../src/lib/admin-passkey-contract.ts';

/** The verifier receives only the supported passkey commands and never the role mutation itself. */
export function startAdminPasskeyOperator(services,close,activation,admit){
 let inFlight=0;
 return startLocalUserAccessOperator({close,async execute(token,command,signal){
  signal.throwIfAborted();
  if(inFlight>=4)throw new Error('Passkey verifier busy');
  // Closing a socket does not cancel a database transaction already in progress.
  inFlight++;
  try{
   if(admit)await admit();
   signal.throwIfAborted();
   return await executeAdminPasskeyRequest(services,token,command);
  }
  catch(error){
   if(error instanceof AdminPasskeyError)throw new AuthRequestError(403,'PASSKEY_REQUIRED');
   throw error;
  }finally{inFlight--;}
 }},{
  parseEnvelope:parseAdminPasskeyEnvelope,parseResult:parseAdminPasskeyResult,
  errorStatus:passkeyOperatorErrorStatus,requestLimit:passkeyOperatorRequestLimit,activation,
 });
}
