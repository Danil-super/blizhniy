import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresWorkPublicationStore} from './postgres-work-publications';
import {createProductionWorkPublicationHandler} from './production-work-publication-http';

export async function handleProductionWorkPublicationRequest(request:Request){
 try{
  const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
  return await createProductionWorkPublicationHandler(config,async()=>{
   const {db,limiter}=await getProductionAccountDatabase(config);
   await db.query('select id,author_id,kind,creation_key,form,revision,status,is_paid,city_id,profession_id,created_at,updated_at,published_at,expires_at,deleted_at from app.work_publications limit 0');
   await db.query('select publication_id,media_id,position from app.work_publication_photos limit 0');
   return{store:new PostgresWorkPublicationStore(db),limiter};
  })(request);
 }catch{return authJson({error:{code:'WORK_PUBLICATIONS_UNAVAILABLE'}},503);}
}
