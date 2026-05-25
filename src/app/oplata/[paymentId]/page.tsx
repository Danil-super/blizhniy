import { FakePaymentPage } from "@/components/MvpDashboard";
import { tariffs } from "@/lib/data";

export function generateStaticParams() {
  return tariffs.map((tariff) => ({ paymentId: tariff.id }));
}

export default async function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;

  return <FakePaymentPage paymentId={paymentId} />;
}
