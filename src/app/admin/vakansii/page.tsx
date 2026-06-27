import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/vakansii" title="Вакансии" description="Рабочие публикации компаний и заказчиков в административном виде.">
      <AdminPublicationsTableClient type="vacancies" />
    </AdminShell>
  );
}
