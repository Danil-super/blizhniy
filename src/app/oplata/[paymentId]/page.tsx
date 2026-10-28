import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/payments/PaymentReturnClient";
import { PrimaryPaymentReturnClient } from "@/components/payments/PrimaryPaymentReturnClient";
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';
import {ApplicationPaymentReturnClient} from '@/components/payments/ApplicationPaymentReturnClient';

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params,searchParams }: { params: Promise<{ paymentId: string }>;searchParams?:Promise<{type?:string}> }) {
  const { paymentId } = await params;
  const type=readPostmoderationEnabled()?(await searchParams)?.type:undefined,vacancy=type==='vacancy',workRequest=type==='workRequest';
  if(type==='application')return <ApplicationPaymentReturnClient paymentId={paymentId}/>;

  const mode = process.env.BLIZHNIY_AUTH_MODE;
  return mode && mode !== "local" ? <PrimaryPaymentReturnClient paymentId={paymentId} vacancy={vacancy} workRequest={workRequest} testCheckout={process.env.BLIZHNIY_LISTING_PAYMENT==='account-test'&&(!vacancy&&!workRequest)||readPostmoderationEnabled()&&process.env.BLIZHNIY_LOCAL_PRIMARY==='enabled'} /> : <PaymentReturnClient paymentId={paymentId} />;
}
