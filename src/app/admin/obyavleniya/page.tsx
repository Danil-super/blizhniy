import { AdminPublicationsTableClient } from "@/components/admin/AdminPublicationsTableClient";
import { AdminShell,AdminWorkspaceShell } from "@/components/admin/AdminShell";
import {PostgresListingModeration} from '@/components/admin/PostgresListingModeration';

export const dynamic = "force-dynamic";

export default function Page() {
  if(process.env.BLIZHNIY_AUTH_MODE&&process.env.BLIZHNIY_AUTH_MODE!=='local')return <AdminWorkspaceShell activeHref="/admin/obyavleniya" title="Объявления на модерации" description="Проверяйте сохранённые объявления, фотографии и контакты. После одобрения автор сможет перейти к оплате."><PostgresListingModeration/></AdminWorkspaceShell>;
  return (
    <AdminShell activeHref="/admin/obyavleniya" title="Объявления" description="Модерация пользовательских объявлений и перевод между статусами публикации.">
      <AdminPublicationsTableClient type="listings" />
    </AdminShell>
  );
}
