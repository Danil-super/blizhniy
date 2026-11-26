import { productionAuthOrigin } from './production-auth-config.ts';

export const hostedRefundOperatorSocket = '/run/blizhniy-refund-operator/operator.sock';

/** The journal opts into IPC. The operator independently authorizes every action. */
function readMode(env:NodeJS.ProcessEnv){
 if(typeof window!=='undefined')throw Error('Refund configuration is server-only');
 const mode=env.BLIZHNIY_REFUND_ADMIN;
 if(mode===undefined)return null;
 if(mode==='hosted-test-v1'){
  if(env.NODE_ENV!=='production'||env.BLIZHNIY_AUTH_ORIGIN!==productionAuthOrigin||
   env.BLIZHNIY_LOCAL_PRIMARY!==undefined||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!==undefined||
   env.BLIZHNIY_REFUND_OPERATOR_SOCKET!==undefined)throw Error('Invalid hosted refund configuration');
  return mode;
 }
 const origin=env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
 if(env.NODE_ENV!=='production'||(mode!=='local-test'&&mode!=='journal-test')||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
  !origin||!/^https:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin)||new URL(origin).origin!==origin||Number(new URL(origin).port)<1024||Number(new URL(origin).port)>65535)throw Error('Invalid local refund configuration');
 return mode;
}

export function readLocalRefundAdminEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 return readMode(env)==='local-test';
}

export function readLocalRefundJournalConfig(env:NodeJS.ProcessEnv=process.env){
 const mode=readMode(env),hosted=mode==='hosted-test-v1';
 if(mode!=='journal-test'&&!hosted)return null;
 const socketPath=hosted?hostedRefundOperatorSocket:env.BLIZHNIY_REFUND_OPERATOR_SOCKET,shopId=env.BLIZHNIY_PAYMENT_SHOP_ID;
 if(env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_ADMIN_PAYMENT_JOURNAL!=='test-v1'||
  env.BLIZHNIY_PAYMENT_MODE!=='test'||!socketPath||!shopId||!/^[a-zA-Z0-9_-]{1,64}$/.test(shopId)){
  throw Error('Invalid local refund journal configuration');
 }
 return {socketPath,shopId,...(hosted?{hosted:true as const}:{})};
}
