import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresWorkCabinetStore} from './postgres-work-cabinet';
import {createWorkCabinetHandler} from './work-cabinet-http';

export async function handleWorkCabinetRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createWorkCabinetHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   return{store:new PostgresWorkCabinetStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'WORK_PUBLICATIONS_UNAVAILABLE'}},503);}
}
