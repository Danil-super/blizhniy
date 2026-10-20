import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/payments/PaymentReturnClient";
import { PrimaryPaymentReturnClient } from "@/components/payments/PrimaryPaymentReturnClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  const mode = process.env.BLIZHNIY_AUTH_MODE;
  return mode && mode !== "local" ? <PrimaryPaymentReturnClient paymentId={paymentId} /> : <PaymentReturnClient paymentId={paymentId} />;
}
