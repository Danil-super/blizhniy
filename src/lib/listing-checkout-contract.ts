export type ListingCheckoutInput={listingId:string;expectedRevision:string;creationKey:string;expectedTariffId:string;expectedAmount:string;expectedDurationDays:number};
export class ListingCheckoutInputError extends Error{constructor(){super('Invalid listing checkout input');this.name='ListingCheckoutInputError';}}
export class ListingCheckoutConflictError extends Error{constructor(){super('Listing checkout conflict');this.name='ListingCheckoutConflictError';}}
export class ListingCheckoutUnavailableError extends Error{constructor(){super('Listing checkout unavailable');this.name='ListingCheckoutUnavailableError';}}
export function parseListingCheckout(input:unknown):ListingCheckoutInput{
 const fail=()=>{throw new ListingCheckoutInputError();};
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
 const row=input as Record<string,unknown>,keys=['listingId','expectedRevision','creationKey','expectedTariffId','expectedAmount','expectedDurationDays'];
 if(Reflect.ownKeys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return fail();
 const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
 if(!uuid(row.listingId)||!uuid(row.creationKey)||typeof row.expectedRevision!=='string'||!/^[1-9]\d{0,18}$/.test(row.expectedRevision)||BigInt(row.expectedRevision)>BigInt('9223372036854775807')||
  typeof row.expectedTariffId!=='string'||row.expectedTariffId.length>100||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.expectedTariffId)||
  typeof row.expectedAmount!=='string'||!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(row.expectedAmount)||
  typeof row.expectedDurationDays!=='number'||!Number.isInteger(row.expectedDurationDays)||row.expectedDurationDays<1||row.expectedDurationDays>3650)return fail();
 return {...row} as ListingCheckoutInput;
}
