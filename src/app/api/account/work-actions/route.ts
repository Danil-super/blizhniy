import {authJson} from '@/lib/auth-http';import {readWorkOwnerActionsEnabled} from '@/lib/work-owner-actions-contract';
import {readProductionAuthConfig} from '@/lib/production-auth-config';import {getProductionAccountDatabase} from '@/lib/production-auth-runtime';
import {PostgresWorkOwnerActions} from '@/lib/postgres-work-owner-actions';import {createWorkOwnerActionsHandler} from '@/lib/work-owner-actions-http';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config||!readWorkOwnerActionsEnabled())return authJson({error:{code:'NOT_FOUND'}},404);
  return await createWorkOwnerActionsHandler(config,async()=>{const {db,limiter}=await getProductionAccountDatabase(config);return{store:new PostgresWorkOwnerActions(db),limiter};})(request);
 }catch{return authJson({error:{code:'ACTION_UNAVAILABLE'}},503);}
}
