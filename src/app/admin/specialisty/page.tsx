import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/specialisty" title="Специалисты" description="Анкеты исполнителей, профессии, города и статусы публикации.">
      <AdminPublicationsTableClient type="specialists" />
    </AdminShell>
  );
}
