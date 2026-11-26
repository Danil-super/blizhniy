import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {readHostedPlacementRenewalOwner,readPlacementRenewalsEnabled} from '@/lib/placement-renewal-config';
import {parseListingDraftId,parseListingDraftRevision} from '@/lib/listing-draft-contract';
import {PlacementRenewalClient,type RenewalKind} from '@/components/payments/PlacementRenewalClient';
export const dynamic='force-dynamic';
export const metadata:Metadata={robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!readPlacementRenewalsEnabled())notFound();
 const query=await searchParams;
 let id:string,revision:string;
 try{if(Object.keys(query).some(key=>!['id','revision','type'].includes(key))||!['listing','vacancy','workRequest'].includes(query.type as string))throw Error();id=parseListingDraftId(query.id);revision=parseListingDraftRevision(query.revision);}
 catch{notFound();}
 return <PlacementRenewalClient id={id} revision={revision} kind={query.type as RenewalKind} hosted={readHostedPlacementRenewalOwner()!==undefined}/>;
}
