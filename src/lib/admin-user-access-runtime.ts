import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readUserAccessOperatorConfig} from './hosted-user-access-config';
import {callHostedUserAccessOperator,callLocalUserAccessOperator} from './local-user-access-operator-client';
import {createAdminUserAccessHandler} from './admin-user-access-http';
export async function handleAdminUserAccessRequest(request:Request){
  try{
    const operator=readUserAccessOperatorConfig(),config=readProductionAuthConfig();
    if(!operator||!config)return authJson({error:{code:'NOT_FOUND'}},404);
    return await createAdminUserAccessHandler(config,async()=>{
      const {limiter}=await getProductionAccountDatabase(config);
      return {limiter,execute:(token,command,signal)=>operator.mode==='hosted'
        ? callHostedUserAccessOperator(token,command,signal,operator.socketPath)
        : callLocalUserAccessOperator(operator.socketPath,token,command,signal)};
    })(request);
  }catch{return authJson({error:{code:'ACCESS_UNAVAILABLE'}},503);}
}
