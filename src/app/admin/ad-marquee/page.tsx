import { AdminAdMarqueeClient } from "@/components/admin/AdminAdMarqueeClient";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AdminShell
      activeHref="/admin/ad-marquee"
      title="Бегущая строка"
      description="Модерация рекламных текстов, контроль оплаты и очереди показа на главной странице."
    >
      <AdminAdMarqueeClient initialPlacements={[]} />
    </AdminShell>
  );
}
