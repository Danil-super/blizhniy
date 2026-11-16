import { AdminPaymentsClient } from "@/components/admin/AdminPaymentsClient";
import {PrimaryAdminRefunds} from "@/components/admin/PrimaryAdminRefunds";
import {readLocalRefundAdminEnabled} from "@/lib/local-refund-admin-config";
import {AdminWorkspaceShell} from "@/components/admin/AdminShell";
import { AdminShell } from "@/components/admin/AdminShell";

export function AdminPaymentsPage() {
  if(readLocalRefundAdminEnabled())return <AdminWorkspaceShell activeHref="/admin/payments" description="Журнал платежей и решения о возврате." title="Платежи"><PrimaryAdminRefunds/></AdminWorkspaceShell>;
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
