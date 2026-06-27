import { AdminShell } from "@/components/admin/AdminShell";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/users" title="Пользователи" description="Учетные записи, роли, контакты, активность и модерационные действия.">
      <AdminUsersClient />
    </AdminShell>
  );
}
