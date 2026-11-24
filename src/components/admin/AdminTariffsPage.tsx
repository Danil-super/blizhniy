import {readLocalTariffOperatorConfig} from '@/lib/local-user-access-config';
import {PrimaryAdminTariffsClient} from './PrimaryAdminTariffsClient';
import { AdminTariffsClient } from "@/components/admin/AdminTariffsClient";
import { AdminShell,AdminWorkspaceShell } from "@/components/admin/AdminShell";
import { readProductionAuthConfig } from '@/lib/production-auth-config';

export function AdminTariffsPage() {
  const editable=readLocalTariffOperatorConfig()!==null;
  if(editable || readProductionAuthConfig())return (
    <AdminWorkspaceShell activeHref="/admin/tariffs" description="Цены, сроки и доступность размещений." title="Тарифы">
      <PrimaryAdminTariffsClient editable={editable}/>
    </AdminWorkspaceShell>
  );
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
