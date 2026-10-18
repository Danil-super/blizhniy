import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresApplicationStore} from './postgres-applications';
import {createProductionApplicationHandler} from './production-application-http';
export async function handleProductionApplicationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionApplicationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,message,revision,status,is_paid,sent_at,created_at,updated_at from app.applications limit 0');
   return{store:new PostgresApplicationStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'APPLICATIONS_UNAVAILABLE'}},503);}
}
