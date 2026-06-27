import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/fair-applications" title="Заявки на ярмарку" description="Административный список заявок участников Ярмарки мастеров.">
      <AdminPublicationsTableClient type="fairApplications" />
    </AdminShell>
  );
}
