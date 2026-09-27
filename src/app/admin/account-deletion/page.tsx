import { AdminAccountDeletionRequestsClient } from '@/components/admin/AdminAccountDeletionRequestsClient';
import { AdminShell } from '@/components/admin/AdminShell';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <AdminShell
      activeHref="/admin/account-deletion"
      title="Удаление аккаунтов"
      description="Заявления пользователей для ручной проверки и принятия решения."
    >
      <AdminAccountDeletionRequestsClient />
    </AdminShell>
  );
}
