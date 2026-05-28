import { FakePaymentPage } from "@/components/MvpDashboard";
import { createPayment, getPayment } from "@/lib/payment-provider";
import { getActiveTariffById } from "@/lib/tariff-store";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const payment = getPayment(paymentId);

  if (payment) {
    return <FakePaymentPage paymentId={payment.id} />;
  }

  const tariff = getActiveTariffById(paymentId);

  if (!tariff) {
    notFound();
  }

  const createdPayment = createPayment({ tariffId: tariff.id });

  redirect(`/blizhniy/oplata/${createdPayment.id}`);
}
