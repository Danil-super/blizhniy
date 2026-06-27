import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/obyavleniya" title="Объявления" description="Модерация пользовательских объявлений и перевод между статусами публикации.">
      <AdminPublicationsTableClient type="listings" />
    </AdminShell>
  );
}
