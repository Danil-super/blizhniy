import type {Metadata} from 'next';import {notFound} from 'next/navigation';
import {readCheckoutCancellationEnabled} from '@/lib/checkout-cancellation-contract';
import {readHostedMarqueeCheckout,readServiceCheckoutEnabled} from '@/lib/service-checkout-config';
import {parseListingDraftId,parseListingDraftRevision} from '@/lib/listing-draft-contract';
import {ServiceCheckoutClient} from '@/components/payments/ServiceCheckoutClient';
import type {PaidServiceKind} from '@/lib/service-checkout-contract';
export const dynamic='force-dynamic';export const metadata:Metadata={robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,hosted=query.type==='marquee'&&!!readHostedMarqueeCheckout();
 if(!hosted&&!readServiceCheckoutEnabled())notFound();
 let id:string,revision:string;
 try{if(Object.keys(query).some(k=>!['id','revision','type'].includes(k))||!['fair','marquee'].includes(query.type as string))throw Error();id=parseListingDraftId(query.id);revision=parseListingDraftRevision(query.revision);}catch{notFound();}
 return <ServiceCheckoutClient kind={query.type as PaidServiceKind} hosted={hosted} cancellationEnabled={!hosted||readCheckoutCancellationEnabled()} publicationId={id} revision={revision}/>;
}
