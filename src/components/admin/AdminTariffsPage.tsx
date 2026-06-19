import { AdminTariffsClient } from "@/components/admin/AdminTariffsClient";
import { SiteHeader } from "@/components/SiteHeader";
import { listPayments } from "@/lib/payment-provider";
import { getStoredTariffs, getTariffs } from "@/lib/tariff-store";
import type { Payment } from "@/lib/types";

async function loadTariffPageData() {
  try {
    const [tariffs, payments] = await Promise.all([getStoredTariffs(), listPayments()]);

    return { initialMessage: "Данные загружены из базы.", payments, tariffs };
  } catch (error) {
    console.error("Failed to load tariff admin data", error);
    return {
      initialMessage: "База временно недоступна, показаны локальные тарифы. Нажмите «Обновить», когда соединение восстановится.",
      payments: [] as Payment[],
      tariffs: getTariffs(),
    };
  }
}

export async function AdminTariffsPage() {
  const { initialMessage, payments, tariffs } = await loadTariffPageData();

  return (
    <>
      <SiteHeader />
      <main className="page-container dashboard-shell pt-6 sm:pt-10 pb-6 sm:pb-10">
        <p className="text-xs font-bold uppercase tracking-wide text-[#0aa337] sm:text-sm">Администрирование</p>
        <div className="mt-2 flex flex-col gap-4 sm:mt-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-black leading-tight text-[#060b27] sm:text-5xl">Тарифы</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-lg sm:leading-7">
              Тарифная сетка действий, платежи и цены. Данные берутся из Supabase, если база настроена.
            </p>
          </div>
        </div>
        <div className="mt-5 sm:mt-7">
          <AdminTariffsClient initialMessage={initialMessage} initialPayments={payments} initialTariffs={tariffs} />
        </div>
      </main>
    </>
  );
}
