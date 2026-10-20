import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";
import {WorkModerationPage} from '@/components/work/WorkModerationPage';

export const dynamic = "force-dynamic";

export default function Page() {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <WorkModerationPage activeHref="/admin/zakazy"/>;
  return (
    <AdminShell activeHref="/admin/zakazy" title="Заказы" description="Заявки заказчиков для специалистов и исполнителей с управлением видимостью.">
      <AdminPublicationsTableClient type="workRequests" />
    </AdminShell>
  );
}
