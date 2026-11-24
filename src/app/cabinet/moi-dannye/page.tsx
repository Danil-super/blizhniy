import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { AccountExportTrial } from '@/components/cabinet/AccountExportTrial';
import { approvedAccountExportEnabled } from '@/lib/production-account-export-trial';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-10">
        <Link href="/cabinet" className="mb-5 inline-block text-sm font-semibold text-[#0875d1] underline">Вернуться в кабинет</Link>
        <h1 className="text-2xl font-semibold">Мои персональные данные</h1>
        <p className="mt-3 text-sm">{approvedAccountExportEnabled()
          ? 'Архив появится после обработки вашего обращения в поддержку.'
          : 'Тестовый раздел. Здесь скачивается архив с синтетическими данными.'}</p>
        <AccountExportTrial />
      </main>
    </>
  );
}
