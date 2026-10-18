import { AdminAdMarqueeClient } from "@/components/admin/AdminAdMarqueeClient";
import { AdminShell } from "@/components/admin/AdminShell";
import { ServiceModerationPage } from '@/components/services/ServiceModerationPage';

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.BLIZHNIY_AUTH_MODE === 'postgres') return <ServiceModerationPage kind="marquee"/>;
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
