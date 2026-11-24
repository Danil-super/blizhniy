/** Explicit product rollout; the local payment simulator remains a separate capability. */
export function readPostmoderationEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 if(typeof window!=='undefined')throw Error('Listing workflow configuration is server-only');
 const value=env.BLIZHNIY_LISTING_WORKFLOW;
 if(value===undefined||value==='pre-moderation')return false;
 if(value!=='postmoderation')throw Error('Invalid listing workflow configuration');
 if(env.BLIZHNIY_LOCAL_PRIMARY===undefined){
  if(env.BLIZHNIY_AUTH_MODE!=='postgres'||env.BLIZHNIY_AUTH_ORIGIN!=='https://xn----9sbphbgks4a4a.xn--p1ai')throw Error('Invalid primary workflow deployment');
  return true;
 }
 if(env.BLIZHNIY_LOCAL_PRIMARY!=='enabled')throw Error('Invalid local primary deployment');
 const origin=env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN;
 if(!origin||!/^https:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin))throw Error('Invalid local primary origin');
 const parsed=new URL(origin);
 if(Number(parsed.port)<1024||Number(parsed.port)>65535||parsed.origin!==origin)throw Error('Invalid local primary origin');
 return true;
}

export function readDraftRemovalsEnabled(env:NodeJS.ProcessEnv=process.env):boolean{
 return env.BLIZHNIY_AUTH_MODE==='postgres'&&env.BLIZHNIY_DRAFT_REMOVALS==='enabled';
}
