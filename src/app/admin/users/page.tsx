import { AdminShell } from "@/components/admin/AdminShell";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";
import {readLocalUserAccessOperatorConfig} from '@/lib/local-user-access-config';

export default function Page() {
  return (
    <AdminShell activeHref="/admin/users" title="Пользователи" description="Учётные записи, контакты и управление доступом.">
      <AdminUsersClient accessManagement={readLocalUserAccessOperatorConfig()!==null}/>
    </AdminShell>
  );
}
