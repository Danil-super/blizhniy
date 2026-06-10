import { PaymentReturnClient } from "@/components/payments/PaymentReturnClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  return <PaymentReturnClient paymentId={paymentId} />;
}
