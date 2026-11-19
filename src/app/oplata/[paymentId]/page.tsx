import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/payments/PaymentReturnClient";
import { PrimaryPaymentReturnClient } from "@/components/payments/PrimaryPaymentReturnClient";
import {readCheckoutCancellationEnabled} from '@/lib/checkout-cancellation-contract';
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {readSpecialistCheckoutEnabled} from '@/lib/specialist-checkout-config';
import {ApplicationPaymentReturnClient} from '@/components/payments/ApplicationPaymentReturnClient';

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params,searchParams }: { params: Promise<{ paymentId: string }>;searchParams?:Promise<{type?:string}> }) {
  const { paymentId } = await params;
  const requestedType=(await searchParams)?.type,postmoderation=readPostmoderationEnabled();
  const mode = process.env.BLIZHNIY_AUTH_MODE;
  const workPlacement=requestedType==='vacancy'||requestedType==='workRequest';
  const responsePayment=requestedType==='application';
  if(mode==='postgres'&&((workPlacement&&!postmoderation)||(responsePayment&&(!postmoderation||process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled')))){
    const {PrimaryPaymentHistory}=await import('@/components/cabinet/PrimaryPaymentHistory');
    return <main className="page-container max-w-3xl py-8"><h1 className="mb-4 text-2xl font-bold">Статус оплаты</h1>
      <PrimaryPaymentHistory receipt={{id:paymentId,targetType:requestedType}}/>
    </main>;
  }
  const type=postmoderation?requestedType:undefined,vacancy=type==='vacancy',workRequest=type==='workRequest',specialist=requestedType==='specialist';
  if(type==='application')return <ApplicationPaymentReturnClient paymentId={paymentId} cancellationEnabled={readCheckoutCancellationEnabled()}/>;

  return mode && mode !== "local" ? <PrimaryPaymentReturnClient cancellationEnabled={!specialist&&readCheckoutCancellationEnabled()} paymentId={paymentId} vacancy={vacancy} workRequest={workRequest} specialist={specialist} testCheckout={(!specialist||postmoderation&&readSpecialistCheckoutEnabled())&&(process.env.BLIZHNIY_LISTING_PAYMENT==='account-publication-test'||process.env.BLIZHNIY_LISTING_PAYMENT==='account-test'&&(!vacancy&&!workRequest)||postmoderation&&process.env.BLIZHNIY_LOCAL_PRIMARY==='enabled')} /> : <PaymentReturnClient paymentId={paymentId} />;
}
