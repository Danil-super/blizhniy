export class WorkModerationInputError extends Error{constructor(){super('Invalid work moderation');}}
export function parseWorkReviewDecision(state:unknown,note:unknown):{state:'approved'|'rejected';note:string|null}{
 if((state!=='approved'&&state!=='rejected')||(state==='approved'?note!==null:typeof note!=='string'||!note.isWellFormed()||note!==note.trim()||note.length<1||note.length>1000||/[\x00-\x1f\x7f]/.test(note)))throw new WorkModerationInputError();
 return{state,note:note as string|null};
}
