import { AdminPaymentsClient } from "@/components/admin/AdminPaymentsClient";
import { AdminShell } from "@/components/admin/AdminShell";

export function AdminPaymentsPage() {
  return (
    <AdminShell
      activeHref="/admin/payments"
      description="Финансовый журнал оплат, статусы у провайдера и правила обработки возвратов."
      title="Платежи"
    >
      <AdminPaymentsClient />
    </AdminShell>
  );
}
