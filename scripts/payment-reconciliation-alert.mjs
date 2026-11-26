import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { alertStateFile, deliverOperationalAlert } from './site-health-alert.mjs';

const reasons = {
  'reconciliation-blocked': 'В очереди сверки TEST-платежей есть заблокированные задания. Откройте отчёт оператора финансовой службы.',
};
const validShop = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

export async function runPaymentReconciliationAlert({ db, shop, directory, recipient, mailer }) {
  if (!validShop(shop) || typeof directory !== 'string' || !isAbsolute(directory) || directory.includes(':')) {
    throw Error('Invalid reconciliation alert configuration');
  }
  const blocked = await db.readTransaction(async tx => {
    const result = (await tx.query('select app.payment_reconciliation_alert_needed($1) as blocked', [shop])).rows[0];
    if (typeof result?.blocked !== 'boolean') throw Error('Invalid reconciliation alert observation');
    return result.blocked;
  }, { timeoutMs: 5000 });
  const result = blocked ? 'reconciliation-blocked' : 'healthy';
  const delivery = await deliverOperationalAlert(result, {
    ...alertStateFile(join(directory, 'payment-reconciliation.json'), reasons),
    send(id, reason) {
      return mailer.send({
        id,
        to: recipient,
        subject: 'БЛИЖНИЙ — заблокирована сверка TEST-платежей',
        text: reasons[reason],
      });
    },
  }, reasons);
  return { result, delivery };
}

async function main() {
  const env = process.env, shop = env.BLIZHNIY_PAYMENT_SHOP_ID, directory = env.STATE_DIRECTORY;
  if (process.argv.length !== 2 || env.NODE_ENV !== 'production' || process.getuid?.() === 0 ||
      env.BLIZHNIY_RECONCILIATION_ALERT !== 'test-v1' || env.BLIZHNIY_PAYMENT_MODE !== 'test' ||
      env.BLIZHNIY_DB_USER !== 'blizhniy_reconciliation_monitor' || env.BLIZHNIY_DB_SSL_MODE !== 'verify-full' ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || !validShop(shop) || !directory || !isAbsolute(directory) || directory.includes(':')) {
    throw Error('Invalid reconciliation alert configuration');
  }
  const { createTimewebMailer, normalizeMailAddress } = await import('../src/lib/timeweb-mail.ts');
  const { createPostgresDatabase } = await import('../src/lib/postgres.ts');
  const recipient = normalizeMailAddress(env.BLIZHNIY_RECONCILIATION_ALERT_EMAIL), mailer = createTimewebMailer(env);
  if (!recipient || !mailer) throw Error('Invalid reconciliation alert mail configuration');
  const db = createPostgresDatabase(env);
  try {
    return await runPaymentReconciliationAlert({ db, shop, directory, recipient, mailer });
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audit = { event: 'payment_reconciliation_alert', runId: randomUUID(), entryPoint: 'oneshot' };
  try {
    const result = await main();
    console.log(JSON.stringify({ ...audit, ...result }));
    if (!['healthy', 'accepted'].includes(result.delivery)) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ ...audit, delivery: 'unavailable' }));
    process.exitCode = 1;
  }
}
