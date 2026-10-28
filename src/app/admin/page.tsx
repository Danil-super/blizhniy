import { AdminOverviewClient } from "@/components/admin/AdminOverviewClient";
import { AdminShell } from "@/components/admin/AdminShell";
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';

export const dynamic = "force-dynamic";

export default function Page() {
  const postmoderation=readPostmoderationEnabled();
  return (
    <AdminShell activeHref="/admin" title="Админка" description={postmoderation?'Пользователи, публикации, тарифы и платежи. Объявления без предварительной модерации.':'Рабочий обзор реальных данных: пользователи, публикации, тарифы, платежи и очередь модерации.'}>
      <AdminOverviewClient postmoderation={postmoderation}/>
    </AdminShell>
  );
}
