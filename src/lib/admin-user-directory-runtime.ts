import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresAdminUserDirectory} from './postgres-admin-user-directory';
import {createAdminUserDirectoryHandler} from './admin-user-directory-http';

export async function handleAdminUserDirectoryRequest(request:Request) {
  try {
    const config=readProductionAuthConfig();if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
    return await createAdminUserDirectoryHandler(config,async()=>{
      const {db,limiter}=await getProductionAccountDatabase(config);
      return {store:new PostgresAdminUserDirectory(db),limiter};
    })(request);
  } catch {return authJson({error:{code:'DIRECTORY_UNAVAILABLE'}},503);}
}
