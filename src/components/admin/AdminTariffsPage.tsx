import { AdminTariffsClient } from "@/components/admin/AdminTariffsClient";
import { AdminShell } from "@/components/admin/AdminShell";

export function AdminTariffsPage() {
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
