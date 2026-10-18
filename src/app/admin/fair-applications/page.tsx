import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";
import { ServiceModerationPage } from '@/components/services/ServiceModerationPage';

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === 'postgres') return <ServiceModerationPage kind="fair"/>;
  return (
    <AdminShell activeHref="/admin/fair-applications" title="Заявки на ярмарку" description="Административный список заявок участников Ярмарки мастеров.">
      <AdminPublicationsTableClient type="fairApplications" />
    </AdminShell>
  );
}
