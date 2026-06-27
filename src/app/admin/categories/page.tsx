import { AdminCategoriesClient } from "@/components/admin/AdminCategoriesClient";
import { AdminShell } from "@/components/admin/AdminShell";

export default function Page() {
  return (
    <AdminShell activeHref="/admin/categories" title="Категории" description="Рубрикатор объявлений с дочерними разделами для модерации каталога.">
      <AdminCategoriesClient />
    </AdminShell>
  );
}
