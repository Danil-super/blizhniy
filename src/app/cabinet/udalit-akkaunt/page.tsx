import Link from 'next/link';
import { AccountDeletionRequestClient } from '@/components/cabinet/AccountDeletionRequestClient';
import { SiteHeader } from '@/components/SiteHeader';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="page-container py-8 sm:py-10">
        <Link href="/cabinet" className="mb-5 inline-block text-sm font-semibold text-[#0875d1] underline">← Вернуться в кабинет</Link>
        <AccountDeletionRequestClient />
      </main>
    </>
  );
}
