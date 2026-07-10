import { AdminOverviewClient } from "@/components/admin/AdminOverviewClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell activeHref="/admin" title="Админка" description="Рабочий обзор реальных данных: пользователи, публикации, тарифы, платежи и очередь модерации.">
      <AdminOverviewClient />
    </AdminShell>
  );
}
