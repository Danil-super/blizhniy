import { AdminShell } from "@/components/admin/AdminShell";
import { AdminAccountExportApproval } from "@/components/admin/AdminAccountExportApproval";
import { AdminUsersClient } from "@/components/admin/AdminUsersClient";
import {readLocalUserAccessOperatorConfig} from '@/lib/local-user-access-config';
import { approvedAccountExportEnabled } from '@/lib/production-account-export-trial';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <AdminShell activeHref="/admin/users" title="Пользователи" description="Учётные записи, контакты и управление доступом.">
      {approvedAccountExportEnabled() && <AdminAccountExportApproval />}
      <AdminUsersClient accessManagement={readLocalUserAccessOperatorConfig()!==null}/>
    </AdminShell>
  );
}
