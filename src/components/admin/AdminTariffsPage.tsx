import {readLocalTariffOperatorConfig} from '@/lib/local-user-access-config';
import {PrimaryAdminTariffsClient} from './PrimaryAdminTariffsClient';
import { AdminTariffsClient } from "@/components/admin/AdminTariffsClient";
import { AdminShell,AdminWorkspaceShell } from "@/components/admin/AdminShell";

export function AdminTariffsPage() {
  if(readLocalTariffOperatorConfig())return <AdminWorkspaceShell activeHref="/admin/tariffs" description="Цены и сроки размещений. Каждое изменение сохраняется в журнале." title="Тарифы"><PrimaryAdminTariffsClient/></AdminWorkspaceShell>;
  return (
    <AdminShell
      activeHref="/admin/tariffs"
      description="Тарифная сетка действий: публикации, вакансии, заказы, отклики, анкеты, ярмарка и реклама."
      title="Тарифы"
    >
      <AdminTariffsClient initialMessage="Загружаем тарифы..." initialTariffs={[]} />
    </AdminShell>
  );
}
