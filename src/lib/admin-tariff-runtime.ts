import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readLocalTariffOperatorConfig} from './local-user-access-config';
import {callLocalTariffOperator} from './local-user-access-operator-client';
import {createAdminTariffHandler} from './admin-tariff-http';
export async function handleAdminTariffRequest(request:Request){
  try{
    const operator=readLocalTariffOperatorConfig(),config=readProductionAuthConfig();
    if(!operator||!config)return authJson({error:{code:'NOT_FOUND'}},404);
    return await createAdminTariffHandler(config,async()=>{
      const {limiter}=await getProductionAccountDatabase(config);
      return {limiter,execute:(token,command,signal)=>callLocalTariffOperator(operator.socketPath,token,command,signal)};
    })(request);
  }catch{return authJson({error:{code:'TARIFF_UNAVAILABLE'}},503);}
}
