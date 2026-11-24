import { authJson } from '@/lib/auth-http';
import { createAdminPaymentJournalHandler } from '@/lib/admin-payment-journal-http';
import { readAdminPaymentJournal } from '@/lib/postgres-admin-payment-journal';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';

export const runtime = 'nodejs';

async function handle(request: Request) {
 try {
  const config = readProductionAuthConfig(), shop = process.env.BLIZHNIY_PAYMENT_SHOP_ID;
  if (!config) return authJson({ error: { code: 'NOT_FOUND' } }, 404);
  if (process.env.BLIZHNIY_ADMIN_PAYMENT_JOURNAL !== 'test-v1' ||
      process.env.BLIZHNIY_PAYMENT_MODE !== 'test' || !shop || !/^[a-zA-Z0-9_-]{1,64}$/.test(shop)) {
   return authJson({ error: { code: 'PAYMENT_JOURNAL_UNAVAILABLE' } }, 503);
  }
  return await createAdminPaymentJournalHandler(config, async () => {
   const { db, limiter } = await getProductionAccountDatabase(config);
   return { limiter, read: (token, command) => readAdminPaymentJournal(db, shop, token, command) };
  })(request);
 } catch { return authJson({ error: { code: 'PAYMENT_JOURNAL_UNAVAILABLE' } }, 503); }
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
