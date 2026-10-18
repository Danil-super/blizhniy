import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";
import {WorkModerationPage} from '@/components/work/WorkModerationPage';

export const dynamic = "force-dynamic";

export default function Page() {
  if(process.env.BLIZHNIY_AUTH_MODE==='postgres')return <WorkModerationPage/>;
  return (
    <AdminShell activeHref="/admin/vakansii" title="Вакансии" description="Рабочие публикации компаний и заказчиков в административном виде.">
      <AdminPublicationsTableClient type="vacancies" />
    </AdminShell>
  );
}
