import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";
import { ServiceModerationPage } from '@/components/services/ServiceModerationPage';

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === 'postgres') return <ServiceModerationPage kind="specialist"/>;
  return (
    <AdminShell activeHref="/admin/specialisty" title="Специалисты" description="Анкеты исполнителей, профессии, города и статусы публикации.">
      <AdminPublicationsTableClient type="specialists" />
    </AdminShell>
  );
}
