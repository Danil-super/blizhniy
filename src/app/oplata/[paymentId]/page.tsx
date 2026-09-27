import type { Metadata } from "next";
import { PaymentReturnClient } from "@/components/payments/PaymentReturnClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  return <PaymentReturnClient paymentId={paymentId} />;
}
