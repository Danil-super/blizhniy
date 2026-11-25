import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readTariffOperatorConfig} from './hosted-user-access-config';
import {callHostedTariffOperator,callLocalTariffOperator} from './local-user-access-operator-client';
import {createAdminTariffHandler} from './admin-tariff-http';
import {readAdminTariffs} from './postgres-admin-tariff-read';
export async function handleAdminTariffRequest(request:Request){
  try{
    const operator=readTariffOperatorConfig(),config=readProductionAuthConfig();
    if(!config)return authJson({error:{code:'NOT_FOUND'}},404);
    return await createAdminTariffHandler(config,async()=>{
      const {db,limiter}=await getProductionAccountDatabase(config);
      return {limiter,execute:(token,command,signal)=>{
        if(operator?.mode==='hosted')return callHostedTariffOperator(token,command,signal);
        if(operator)return callLocalTariffOperator(operator.socketPath,token,command,signal);
        return readAdminTariffs(db,token,command);
      }};
    })(request);
  }catch{return authJson({error:{code:'TARIFF_UNAVAILABLE'}},503);}
}
