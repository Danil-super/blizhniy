import { FakePaymentPage } from "@/components/MvpDashboard";
import { tariffs } from "@/lib/data";
import { createPayment, getPayment } from "@/lib/payment-provider";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const payment = getPayment(paymentId);

  if (payment) {
    return <FakePaymentPage paymentId={payment.id} />;
  }

  const tariff = tariffs.find((item) => item.id === paymentId && item.active);

  if (!tariff) {
    notFound();
  }

  const createdPayment = createPayment({ tariffId: tariff.id });

  redirect(`/blizhniy/oplata/${createdPayment.id}`);
}
