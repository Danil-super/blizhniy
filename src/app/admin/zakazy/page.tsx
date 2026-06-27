import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/zakazy" title="Заказы" description="Заявки заказчиков для специалистов и исполнителей с управлением видимостью.">
      <AdminPublicationsTableClient type="workRequests" />
    </AdminShell>
  );
}
