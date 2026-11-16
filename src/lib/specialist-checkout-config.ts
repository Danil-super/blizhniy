import {readPostmoderationEnabled} from './listing-workflow-config.ts';
/** Synthetic local admission only; this switch cannot enable a production merchant. */
export function readSpecialistCheckoutEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(env.BLIZHNIY_SPECIALIST_CHECKOUT===undefined||env.BLIZHNIY_SPECIALIST_CHECKOUT==='disabled')return false;
 if(env.BLIZHNIY_SPECIALIST_CHECKOUT!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN!=='https://127.0.0.1:3045'||!readPostmoderationEnabled(env))throw Error('Invalid specialist checkout rollout');
 return true;
}
