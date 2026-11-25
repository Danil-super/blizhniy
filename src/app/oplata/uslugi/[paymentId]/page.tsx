import type {Metadata} from 'next';import {notFound} from 'next/navigation';
import {readCheckoutCancellationEnabled} from '@/lib/checkout-cancellation-contract';
import {readHostedMarqueeCheckout,readServiceCheckoutEnabled} from '@/lib/service-checkout-config';import {parseListingDraftId} from '@/lib/listing-draft-contract';
import {ServiceCheckoutClient} from '@/components/payments/ServiceCheckoutClient';import type {PaidServiceKind} from '@/lib/service-checkout-contract';
export const dynamic='force-dynamic';export const metadata:Metadata={robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{paymentId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,hosted=query.type==='marquee'&&!!readHostedMarqueeCheckout();
 if(!hosted&&!readServiceCheckoutEnabled())notFound();
 let id:string;
 try{if(Object.keys(query).length!==1||!['fair','marquee'].includes(query.type as string))throw Error();id=parseListingDraftId((await params).paymentId);}catch{notFound();}
 return <ServiceCheckoutClient kind={query.type as PaidServiceKind} hosted={hosted} cancellationEnabled={!hosted||readCheckoutCancellationEnabled()} paymentId={id}/>;
}
