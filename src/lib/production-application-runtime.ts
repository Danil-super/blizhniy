import {authJson} from './auth-http';import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';import {PostgresApplicationStore} from './postgres-applications';
import {createProductionApplicationHandler} from './production-application-http';
import {readPostmoderationEnabled} from './listing-workflow-config';
export function readApplicationContactViewsMode(env:NodeJS.ProcessEnv=process.env):boolean{
 const value=env.BLIZHNIY_APPLICATION_CONTACT_VIEWS;
 if(value!==undefined&&value!=='enabled'&&value!=='disabled')throw Error('Invalid application contact view policy');
 return value==='enabled';
}
export async function handleProductionApplicationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  const contactViews=readApplicationContactViewsMode();
  return await createProductionApplicationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,applicant_id,work_publication_id,specialist_publication_id,creation_key,target_revision,specialist_revision,snapshot,message,revision,status,is_paid,sent_at,created_at,updated_at from app.applications limit 0');
   return{store:new PostgresApplicationStore(db,{vacancyPostmoderation:readPostmoderationEnabled(),specialistApplicationReady:true,localActions:readPostmoderationEnabled(),contactViews}),limiter};
  })(request);
 }catch{return authJson({error:{code:'APPLICATIONS_UNAVAILABLE'}},503);}
}
