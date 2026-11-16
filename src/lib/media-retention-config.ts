import {readServiceCheckoutEnabled} from './service-checkout-config.ts';
/** Local candidate only. The flag grants no schema, credentials or deletion authority. */
export function readMediaRetentionEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_MEDIA_RETENTION===undefined||env.BLIZHNIY_MEDIA_RETENTION==='disabled')return false;
 if(typeof window!=='undefined'||env.BLIZHNIY_MEDIA_RETENTION!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||
  env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045'||!readServiceCheckoutEnabled(env))throw Error('Invalid media retention rollout');
 return true;
}
