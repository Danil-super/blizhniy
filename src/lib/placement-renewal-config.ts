import {readPostmoderationEnabled} from './listing-workflow-config.ts';

/** Local synthetic rollout only; neither schema installation nor provider activation. */
export function readPlacementRenewalsEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  const value=env.BLIZHNIY_PLACEMENT_RENEWALS;
  if(value===undefined||value==='disabled')return false;
  if(value!=='local-v1'||env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!readPostmoderationEnabled(env))throw Error('Invalid placement renewal rollout');
  return true;
}
