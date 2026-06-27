import { AdminAdMarqueeClient } from "@/components/admin/AdminAdMarqueeClient";
import { AdminShell } from "@/components/admin/AdminShell";
import { listAdMarqueePlacementsForAdmin } from "@/lib/ad-marquee-store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const placements = await listAdMarqueePlacementsForAdmin().catch((error) => {
    console.error("Failed to load ad marquee admin page", error);
    return [];
  });

  return (
    <AdminShell
      activeHref="/admin/ad-marquee"
      title="Бегущая строка"
      description="Модерация рекламных текстов, контроль оплаты и очереди показа на главной странице."
    >
      <AdminAdMarqueeClient initialPlacements={placements} />
    </AdminShell>
  );
}
