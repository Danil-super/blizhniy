import { AdminTariffsClient } from "@/components/admin/AdminTariffsClient";
import { AdminShell } from "@/components/admin/AdminShell";
import { getStoredTariffs, getTariffs } from "@/lib/tariff-store";

async function loadTariffPageData() {
  try {
    const tariffs = await getStoredTariffs();

    return { initialMessage: "Данные загружены из базы.", tariffs };
  } catch (error) {
    console.error("Failed to load tariff admin data", error);
    return {
      initialMessage: "База временно недоступна, показаны локальные тарифы. Нажмите «Обновить», когда соединение восстановится.",
      tariffs: getTariffs(),
    };
  }
}

export async function AdminTariffsPage() {
  const { initialMessage, tariffs } = await loadTariffPageData();

  return (
    <AdminShell
      activeHref="/admin/tariffs"
      description="Тарифная сетка действий: публикации, вакансии, заказы, отклики, анкеты, ярмарка и реклама."
      title="Тарифы"
    >
      <AdminTariffsClient initialMessage={initialMessage} initialTariffs={tariffs} />
    </AdminShell>
  );
}
