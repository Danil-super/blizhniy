import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readLocalUserAccessOperatorConfig} from './local-user-access-config';
import {callLocalUserAccessOperator} from './local-user-access-operator-client';
import {createAdminUserAccessHandler} from './admin-user-access-http';
export async function handleAdminUserAccessRequest(request:Request){
  try{
    const operator=readLocalUserAccessOperatorConfig(),config=readProductionAuthConfig();
    if(!operator||!config)return authJson({error:{code:'NOT_FOUND'}},404);
    return await createAdminUserAccessHandler(config,async()=>{
      const {limiter}=await getProductionAccountDatabase(config);
      return {limiter,execute:(token,command,signal)=>callLocalUserAccessOperator(operator.socketPath,token,command,signal)};
    })(request);
  }catch{return authJson({error:{code:'ACCESS_UNAVAILABLE'}},503);}
}
