export type DeletionAccess='account'|'data-subject';
export type DeletionResolution='fulfilled'|'partly_retained'|'declined';
export type DeletionCase={id:string;revision:string;status:'requested'|'in_review'|'resolved';requestedAt:string;
 reviewStartedAt:string|null;resolvedAt:string|null;resolution:DeletionResolution|null};
export type DeletionPrincipal={id:string;email:string;isBlocked:boolean};
export type AdminDeletionCase=DeletionCase&{ownerId:string|null;email:string|null;caseReference:string|null};
export class DeletionInputError extends Error{constructor(){super('Invalid deletion request');this.name='DeletionInputError';}}
export class DeletionAccessError extends Error{constructor(){super('Deletion access required');this.name='DeletionAccessError';}}
export class DeletionConflictError extends Error{constructor(){super('Deletion request changed');this.name='DeletionConflictError';}}
export function deletionId(value:unknown):string{
 if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw new DeletionInputError();return value;
}
export function deletionRevision(value:unknown):string{
 if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>BigInt('9223372036854775807'))throw new DeletionInputError();return value;
}
export function deletionObject(input:unknown,keys:string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||
  Reflect.ownKeys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))throw new DeletionInputError();
 return input as Record<string,unknown>;
}
export function deletionAccess(value:unknown):DeletionAccess{if(value!=='account'&&value!=='data-subject')throw new DeletionInputError();return value;}
export function deletionDecision(value:unknown){
 const row=deletionObject(value,['resolution','caseReference','confirmedManualDecision']);
 if(typeof row.resolution!=='string'||!['fulfilled','partly_retained','declined'].includes(row.resolution)||typeof row.caseReference!=='string'||
  !/^[A-Za-z0-9_-]{6,80}$/.test(row.caseReference)||row.confirmedManualDecision!==true)throw new DeletionInputError();
 return {resolution:row.resolution as DeletionResolution,caseReference:row.caseReference};
}
