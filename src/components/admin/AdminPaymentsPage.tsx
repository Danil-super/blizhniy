import { PrimaryAdminPaymentJournal } from './PrimaryAdminPaymentJournal';
import { AdminPaymentsClient } from "@/components/admin/AdminPaymentsClient";
import {PrimaryAdminRefunds} from "@/components/admin/PrimaryAdminRefunds";
import {readLocalRefundAdminEnabled, readLocalRefundJournalConfig} from "@/lib/local-refund-admin-config";
import {AdminWorkspaceShell} from "@/components/admin/AdminShell";
import { AdminShell } from "@/components/admin/AdminShell";

export function AdminPaymentsPage() {
  if(readLocalRefundAdminEnabled())return <AdminWorkspaceShell activeHref="/admin/payments" description="Журнал платежей и решения о возврате." title="Платежи"><PrimaryAdminRefunds/></AdminWorkspaceShell>;
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return (
    <AdminWorkspaceShell activeHref="/admin/payments" description="Заказы TEST-магазина и результаты их обработки." title="Платежи">
      <PrimaryAdminPaymentJournal refundActions={readLocalRefundJournalConfig()!==null}/>
    </AdminWorkspaceShell>
  );
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
