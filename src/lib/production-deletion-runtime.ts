import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {createAccountDeletionHandler} from './account-deletion-http';
import {PostgresAccountDeletionStore} from './postgres-account-deletion';
import {IdentityStore} from './identity';
import {verifyTurnstileToken} from './turnstile';

export async function handleProductionDeletion(request:Request,action:string,admin=false):Promise<Response>{
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createAccountDeletionHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   return {store:new PostgresAccountDeletionStore(db),identity:new IdentityStore(db),limiter,verifyCaptcha:verifyTurnstileToken};
  })(request,action,admin);
 }catch{return authJson({error:{code:'DELETION_UNAVAILABLE'}},503);}
}
