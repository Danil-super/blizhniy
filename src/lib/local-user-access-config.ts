import {basename,dirname,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
/** Local view/transport opt-in only; never grants database authority or starts an operator. */
export function readLocalUserAccessOperatorConfig(env:NodeJS.ProcessEnv=process.env):{socketPath:string}|null{
  if(typeof window!=='undefined')throw Error('User access configuration is server-only');
  if(env.BLIZHNIY_USER_ACCESS_OPERATOR===undefined)return null;
  const socketPath=env.BLIZHNIY_USER_ACCESS_SOCKET;
  if(env.BLIZHNIY_USER_ACCESS_OPERATOR!=='local-v1'||env.NODE_ENV!=='production'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
    env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045'||env.BLIZHNIY_AUTH_MODE!=='postgres'||!socketPath||!isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100||
    basename(socketPath)!=='operator.sock'||!/^blizhniy-user-operator-[a-zA-Z0-9]+$/.test(basename(dirname(socketPath)))||
    dirname(dirname(socketPath))!==tmpdir()||socketPath!==join(dirname(socketPath),'operator.sock'))throw Error('Invalid local user access configuration');
  return {socketPath};
}

export function readLocalTariffOperatorConfig(env:NodeJS.ProcessEnv=process.env){
 if(env.BLIZHNIY_ADMIN_TARIFFS===undefined)return null;
 if(env.BLIZHNIY_ADMIN_TARIFFS!=='local-v1')throw Error('Invalid local tariff configuration');
 const config=readLocalUserAccessOperatorConfig(env);if(!config)throw Error('Local tariff operator unavailable');return config;
}
