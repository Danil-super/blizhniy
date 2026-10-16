import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell } from "@/components/admin/AdminShell";
import Link from 'next/link';
import {SiteHeader} from '@/components/SiteHeader';
import {PostgresListingModeration} from '@/components/admin/PostgresListingModeration';

export const dynamic = "force-dynamic";

export default function Page() {
  if(process.env.BLIZHNIY_AUTH_MODE&&process.env.BLIZHNIY_AUTH_MODE!=='local')return <><SiteHeader/><main className="page-container dashboard-shell pb-8 pt-6">
    <nav aria-label="Навигация модератора" className="flex flex-wrap gap-4"><Link href="/admin" className="min-h-11 py-2 font-semibold underline">Разделы админки</Link><Link href="/cabinet" className="min-h-11 py-2 font-semibold underline">Личный кабинет</Link></nav>
    <h1 className="mt-4 text-2xl font-bold">Объявления на модерации</h1><PostgresListingModeration/>
  </main></>;
  return (
    <AdminShell activeHref="/admin/obyavleniya" title="Объявления" description="Модерация пользовательских объявлений и перевод между статусами публикации.">
      <AdminPublicationsTableClient type="listings" />
    </AdminShell>
  );
}
