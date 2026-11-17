import {ListingDraftInputError,parseListingDraftCursor,parseListingDraftId,type ListingDraftCursor} from './listing-draft-contract.ts';
import {validPlainText} from './cabinet-field-validation.ts';

export type AdminUserQuery = {expectedAdminId:string;query:string;role:'all'|'admin'|'user';status:'all'|'active'|'blocked'|'pending';cursor:ListingDraftCursor|null};
export type AdminDirectoryUser = {id:string;name:string;email:string;phone:string;role:'admin'|'user';isBlocked:boolean;emailVerified:boolean;createdAt:string};
export type AdminUserPage = {items:AdminDirectoryUser[];nextCursor:ListingDraftCursor|null};
function exact(value:unknown,keys:string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))) throw new ListingDraftInputError();
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string {
  if(typeof value!=='string'||value.length>max||!validPlainText(value))throw new ListingDraftInputError();
  return value;
}
export function parseAdminUserQuery(value:unknown):AdminUserQuery {
  const input=exact(value,['expectedAdminId','query','role','status','cursor']);
  const {role,status}=input;
  if(role!=='all'&&role!=='admin'&&role!=='user'||status!=='all'&&status!=='active'&&status!=='blocked'&&status!=='pending')throw new ListingDraftInputError();
  return {expectedAdminId:parseListingDraftId(input.expectedAdminId),query:text(input.query,120).trim(),role,status,cursor:parseListingDraftCursor(input.cursor)};
}
export function parseAdminUserPage(value:unknown):AdminUserPage {
  const page=exact(value,['items','nextCursor']);
  if(!Array.isArray(page.items)||page.items.length>25)throw new ListingDraftInputError();
  const items:AdminDirectoryUser[]=page.items.map((value):AdminDirectoryUser=>{
    const row=exact(value,['id','name','email','phone','role','isBlocked','emailVerified','createdAt']);
    const {role,isBlocked,emailVerified}=row;
    if(role!=='admin'&&role!=='user'||typeof isBlocked!=='boolean'||typeof emailVerified!=='boolean')throw new ListingDraftInputError();
    const stamp=parseListingDraftCursor({id:row.id,updatedAt:row.createdAt})!;
    return {id:stamp.id,name:text(row.name,120),email:text(row.email,254),phone:text(row.phone,80),role,isBlocked,emailVerified,createdAt:stamp.updatedAt};
  });
  if(new Set(items.map(row=>row.id)).size!==items.length)throw new ListingDraftInputError();
  const nextCursor=parseListingDraftCursor(page.nextCursor),last=items.at(-1);
  if(nextCursor&&(items.length!==25||last?.id!==nextCursor.id||last.createdAt!==nextCursor.updatedAt))throw new ListingDraftInputError();
  return {items,nextCursor};
}
